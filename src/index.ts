import { Effect } from "effect";
import type { ProxyEvent, RulesListEvent, ViewsListEvent, SimulatorEvent } from "./models";
import type { LoadedScenario, LoadedView } from "./rules";
import type { CaCert } from "./ca";
import { EventBus } from "./eventBus";
import { ProxyError } from "./errors";
import { createRoutes, createServer, createSse } from "./server";
import {
  configureHostProxy,
  disableHostProxy,
  readHostProxySettings,
  installSimulatorCertificate,
  listSimulators,
  trustCaCertOnHost,
  isCaTrustedOnHost,
  getCertSha256,
  isCaInstalledOnSimulator,
} from "./simulators";
import { loadScenarios, loadViews, watchDir } from "./rulesLoader";
import { handleHttpProxy } from "./proxy";
import { type RuleHandler } from "./rules";
import { ensureCa } from "./ca";
import { loadConfig, saveConfig, type AproxyConfig } from "./config";
import { join } from "node:path";
import { homedir } from "node:os";

const proxyPort = Number(process.env.PROXY_PORT ?? 8080);
const eventBus = new EventBus<ProxyEvent | RulesListEvent | ViewsListEvent | SimulatorEvent>();
let loadedScenarios: LoadedScenario[] = [];
let activeScenarioId: string | null = null;
let loadedViews: LoadedView[] = [];
let proxyEnabled = false;
let config: AproxyConfig = loadConfig();
const aproxyDir = join(homedir(), ".aproxy");
const scenariosDir = join(aproxyDir, "scenarios");
const viewsDir = join(aproxyDir, "views");

/**
 * Synchronously disable the host proxy settings.
 * Used during process shutdown when we cannot rely on async Effect execution.
 */
function disableProxySync(): void {
  if (!proxyEnabled) return;
  try {
    const result = Bun.spawnSync(["route", "-n", "get", "default"], { stdout: "pipe", stderr: "pipe" });
    const routeOutput = new TextDecoder().decode(result.stdout);
    const ifaceMatch = routeOutput.match(/interface:\s*(\S+)/);
    if (!ifaceMatch) return;

    const portsOutput = Bun.spawnSync(["networksetup", "-listallhardwareports"], { stdout: "pipe", stderr: "pipe" });
    const portsText = new TextDecoder().decode(portsOutput.stdout);
    const blocks = portsText.split(/\n\n/);
    let service: string | null = null;
    for (const block of blocks) {
      const deviceMatch = block.match(/Device:\s*(\S+)/);
      const nameMatch = block.match(/Hardware Port:\s*(.+)/);
      if (deviceMatch && nameMatch && deviceMatch[1] === ifaceMatch[1]) {
        service = nameMatch[1].trim();
        break;
      }
    }
    if (!service) return;

    Bun.spawnSync(["networksetup", "-setwebproxystate", service, "off"], { stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["networksetup", "-setsecurewebproxystate", service, "off"], { stdout: "pipe", stderr: "pipe" });
    proxyEnabled = false;
    console.log("Proxy settings cleaned up on exit");
  } catch {
    // Best effort — nothing we can do if cleanup fails during shutdown
  }
}

/** Install process signal handlers to clean up proxy settings on exit. */
function installShutdownHandlers(): void {
  const onSignal = (signal: string) => {
    console.log(`\nReceived ${signal}, cleaning up...`);
    disableProxySync();
    process.exit(0);
  };

  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGHUP", () => onSignal("SIGHUP"));
}

/**
 * On startup, check if the system proxy is still pointing at our port from a
 * previous session that crashed or was killed. If so, disable it.
 */
function cleanupStaleProxy(): Effect.Effect<void, never> {
  return readHostProxySettings().pipe(
    Effect.flatMap((result) => {
      if (!result.enabled) return Effect.void;
      const port = result.settings["HTTPPort"] || result.settings["HTTPSPort"];
      if (port && Number(port) === proxyPort) {
        console.log("Detected stale proxy settings from a previous session, disabling...");
        return disableHostProxy().pipe(Effect.asVoid);
      }
      return Effect.void;
    }),
    Effect.catchAll(() => Effect.void),
  );
}

const listRulesEvent = (): RulesListEvent => ({
  type: "rules_list",
  rules: loadedScenarios.flatMap((scenario) =>
    scenario.rules.map(({ id, name, description }) => ({ id, name, description }))
  ),
  activeRuleIds: activeScenarioId
    ? loadedScenarios
        .find((scenario) => scenario.id === activeScenarioId)
        ?.rules.map((rule) => rule.id) ?? []
    : []
});

const listViewsEvent = (): ViewsListEvent => ({
  type: "views_list",
  views: loadedViews.map(({ id, name, description, filter }) => ({
    id, name, description,
    filter: filter.toString(),
  })),
  defaultViewId: config.defaultViewId,
});


const setLoadedScenarios = (scenarios: LoadedScenario[]) => {
  loadedScenarios = scenarios;
};

const setActiveScenarioId = (id: string | null) => {
  activeScenarioId = id;
};

const setLoadedViews = (views: LoadedView[]) => {
  loadedViews = views;
};

const getConfig = () => config;

const updateConfig = (patch: Partial<AproxyConfig>) => {
  config = { ...config, ...patch };
  saveConfig(config);
};

const applyRules = (context: { id: string; url: string; method: string; headers: Record<string, string> }) =>
  Effect.gen(function* (_) {
    if (!proxyEnabled) return null;
    const activeScenario = loadedScenarios.find((scenario) => scenario.id === activeScenarioId);
    const rules = activeScenario?.rules ?? [];
    for (const rule of rules) {
      const result = yield* _(
        Effect.tryPromise(() => Promise.resolve(rule.handle(context))).pipe(
          Effect.mapError((cause) => new ProxyError({ cause }))
        )
      );
      if (result) return result;
    }
    return null;
  });

const handleProxy = (req: Request) => handleHttpProxy(req, (event) => eventBus.emit(event), applyRules);

const main = Effect.gen(function* (_) {
  installShutdownHandlers();

  // Clean up stale proxy settings from a previous crash — if the system proxy
  // is pointing at our host:port but we just started, it's leftover config.
  yield* _(cleanupStaleProxy());

  // Initialize the CA for MITM SSL interception
  const ca: CaCert = yield* _(ensureCa());

  const loadScenariosEffect = loadScenarios(scenariosDir, setLoadedScenarios, setActiveScenarioId);
  const loadViewsEffect = loadViews(viewsDir, setLoadedViews);
  const loadAllRules = Effect.all([loadScenariosEffect, loadViewsEffect], { concurrency: "unbounded" }).pipe(Effect.asVoid);
  const routes = createRoutes({
    listRulesEvent,
    listViewsEvent,
    loadRules: () => loadAllRules,
    scenariosDir,
    viewsDir,
    handleProxy,
    createSse: (signal) => createSse(eventBus, listRulesEvent, listViewsEvent, signal),
    getActiveScenarioId: () => activeScenarioId,
    setActiveScenarioId,
    getScenarios: () => loadedScenarios.map(({ id, name, description, rules }) => ({
      id, name, description,
      rules: rules.map(({ id, name, description }) => ({ id, name, description })),
    })),
    getViews: () => loadedViews.map(({ id, name, description, filter }) => ({
      id, name, description,
      filter: filter.toString(),
    })),
    getConfig,
    updateConfig,
    enableProxy: (input) => configureHostProxy(input).pipe(
      Effect.tap(() => Effect.sync(() => { proxyEnabled = true; }))
    ),
    disableProxy: () => disableHostProxy().pipe(
      Effect.tap(() => Effect.sync(() => { proxyEnabled = false; }))
    ),
    proxyStatus: () => readHostProxySettings().pipe(
      Effect.tap((result) => Effect.sync(() => { proxyEnabled = result.enabled; }))
    ),
    listSimulators: () =>
      Effect.gen(function* (_) {
        const simulators = yield* _(listSimulators());
        const sha256 = yield* _(getCertSha256(ca.certPath).pipe(Effect.catchAll(() => Effect.succeed(""))));
        if (sha256) {
          const booted = simulators.filter((s) => s.isBooted);
          const trustChecks = yield* _(
            Effect.all(
              booted.map((s) => isCaInstalledOnSimulator(s.udid, sha256)),
              { concurrency: "unbounded" }
            )
          );
          booted.forEach((s, i) => { s.caTrusted = trustChecks[i]; });
        }
        eventBus.emit({ type: "simulators_list", simulators });
        return simulators;
      }),
    installSimulatorCert: (input) =>
      installSimulatorCertificate(input).pipe(
        Effect.tap((simulator) =>
          Effect.sync(() =>
            eventBus.emit({
              type: "simulator_configured",
              simulator,
              proxyHost: "",
              proxyPort: 0,
              certPath: input.certPath
            })
          )
        ),
      ),
    getCaCertPem: () => ca.certPem,
    getCaCertPath: () => ca.certPath,
    trustCaOnHost: () => trustCaCertOnHost(ca.certPath),
    isCaTrusted: () => isCaTrustedOnHost("aproxy CA"),
    installCaOnSimulator: (udid) =>
      installSimulatorCertificate({ udid, certPath: ca.certPath }).pipe(
        Effect.tap((simulator) =>
          Effect.sync(() =>
            eventBus.emit({
              type: "simulator_configured",
              simulator,
              proxyHost: "",
              proxyPort: 0,
              certPath: ca.certPath,
            })
          )
        ),
      ),
  });

  yield* _(createServer(routes, (event) => eventBus.emit(event), ca));

  // Load rules and set up file watchers (non-blocking for proxy operation)
  yield* _(loadAllRules);

  const emitReload = () => {
    void Effect.runPromise(
      loadAllRules.pipe(Effect.tap(() => Effect.sync(() => {
        eventBus.emit(listRulesEvent());
        eventBus.emit(listViewsEvent());
      })))
    );
  };

  yield* _(watchDir(scenariosDir, emitReload));
  yield* _(watchDir(viewsDir, emitReload));
  console.log(`Proxy listening on :${proxyPort} (MITM enabled)`);
});

/** Start the proxy server (CA + TCP listener + rules + watchers). */
export function startProxy() {
  return Effect.runPromise(main);
}

/** Exported for use by Electrobun entry to clean up on window close. */
export { disableProxySync };

if (import.meta.main) {
  await Effect.runPromise(main);
}
