import { Effect } from "effect";
import type { ProxyEvent, RulesListEvent, ViewsListEvent, SimulatorEvent } from "./models";
import type { LoadedScenario, LoadedView } from "../shared/rules";
import type { CaCert } from "./ca";
import type { SerializedRuleResponse } from "./ruleSandboxTypes";
import { EventBus } from "./eventBus";
import { ProxyError } from "./errors";
import { createRoutes, createServer, createControlServer, createSse, type MitmBridge } from "./server";
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
import { ensureCa } from "./ca";
import { loadConfig, saveConfig, resolveProxyBackend, type AproxyConfig } from "./config";
import { existsSync } from "node:fs";
import {
  MitmProxyBackend,
  MITMPROXY_INSTALL_HINT,
  LEGACY_MITM_PORTS,
  resolveAddonPath,
  resolveMitmdumpPath,
  resolveMitmPort,
} from "./mitmBackend";
import { join } from "node:path";
import { homedir } from "node:os";
import { RuleSandbox } from "./ruleSandbox";

/**
 * Control server port: serves the UI, control API and SSE stream.  With the
 * built-in backend this is also the proxy port; with the mitmproxy backend the
 * proxy lives on `mitmPort` instead.
 */
const controlPort = Number(process.env.PROXY_PORT ?? 8080);
const mitmPort = resolveMitmPort();
const bindHost = process.env.HOST ?? "127.0.0.1";
const eventBus = new EventBus<ProxyEvent | RulesListEvent | ViewsListEvent | SimulatorEvent>();
let loadedScenarios: LoadedScenario[] = [];
let activeScenarioIds: string[] = [];
let loadedViews: LoadedView[] = [];
let proxyEnabled = false;
let config: AproxyConfig = loadConfig();
let backend = resolveProxyBackend(config);
/** Port clients must point their proxy settings at for the active backend. */
let proxyPort = backend === "mitmproxy" ? mitmPort : controlPort;
const aproxyDir = join(homedir(), ".aproxy");
const scenariosDir = join(aproxyDir, "scenarios");
const viewsDir = join(aproxyDir, "views");
const ruleSandbox = new RuleSandbox();
let mitmBackend: MitmProxyBackend | null = null;

/**
 * Synchronously disable the host proxy settings.
 * Used during process shutdown when we cannot rely on async Effect execution.
 */
function disableProxySync(): void {
  mitmBackend?.stop();
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
  // Bun does not run signal handlers for a plain process.exit(), so make sure
  // the mitmdump child never outlives us and keeps port 8081 bound.
  process.on("exit", () => mitmBackend?.stop());
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
      // Either backend's port counts — the user may have switched backends
      // between runs, leaving the system pointed at the other one. Ports used
      // by older versions are included so an upgrade never strands the system
      // proxy on a port nothing listens to any more.
      const ours = [controlPort, mitmPort, ...LEGACY_MITM_PORTS];
      if (port && ours.includes(Number(port))) {
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
  activeRuleIds: loadedScenarios
    .filter((scenario) => activeScenarioIds.includes(scenario.id))
    .flatMap((scenario) => scenario.rules.map((rule) => rule.id)),
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

const setActiveScenarioIds = (ids: string[]) => {
  activeScenarioIds = ids;
};

const setLoadedViews = (views: LoadedView[]) => {
  loadedViews = views;
};

const getConfig = () => config;

const updateConfig = (patch: Partial<AproxyConfig>) => {
  config = { ...config, ...patch };
  saveConfig(config);
};

/**
 * Evaluate the active scenario rules against a request and return the first
 * matching mock, still in its serialized (transport) form.
 */
const applyRulesSerialized = (context: {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}) =>
  Effect.gen(function* (_) {
    if (!proxyEnabled) return null;
    const activeScenarios = loadedScenarios.filter((scenario) => activeScenarioIds.includes(scenario.id));
    for (const scenario of activeScenarios) {
      for (const rule of scenario.rules) {
        const result = yield* _(
          Effect.tryPromise(async () => {
            const outcome = await ruleSandbox.runRule(scenario.id, rule.id, context);
            if (outcome.error) throw new Error(outcome.error);
            return outcome.response;
          }).pipe(Effect.mapError((cause) => new ProxyError({ cause })))
        );
        if (result) return result as SerializedRuleResponse;
      }
    }
    return null;
  });

const applyRules = (context: { id: string; url: string; method: string; headers: Record<string, string>; body?: string }) =>
  applyRulesSerialized(context).pipe(
    Effect.map((serialized) => (serialized ? ruleSandbox.deserializeResponse(serialized) : null))
  );

const handleProxy = (req: Request) => handleHttpProxy(req, (event) => eventBus.emit(event), applyRules);

const main = Effect.gen(function* (_) {
  installShutdownHandlers();

  // Clean up stale proxy settings from a previous crash — if the system proxy
  // is pointing at our host:port but we just started, it's leftover config.
  yield* _(cleanupStaleProxy());

  // Initialize the CA for MITM SSL interception
  const ca: CaCert = yield* _(ensureCa());

  // Pre-flight: mitmproxy needs both an external binary and the bundled Python
  // bridge addon. If either is missing, say why and fall back to the built-in
  // engine — a packaging mistake must not stop the app from starting.
  if (backend === "mitmproxy") {
    const missing =
      resolveMitmdumpPath() === null
        ? `mitmdump was not found. ${MITMPROXY_INSTALL_HINT}`
        : !existsSync(resolveAddonPath())
          ? `bridge addon missing at ${resolveAddonPath()}. Set APROXY_MITM_ADDON to its location.`
          : null;

    if (missing !== null) {
      console.error(`[mitmproxy] ${missing}`);
      console.error("[mitmproxy] Falling back to the built-in proxy backend.");
      backend = "builtin";
      proxyPort = controlPort;
    }
  }

  const useMitmproxy = backend === "mitmproxy";
  const bridge: MitmBridge | undefined = useMitmproxy
    ? {
        token: crypto.randomUUID(),
        emitEvent: (event) => eventBus.emit(event),
        applyRuleMock: applyRulesSerialized,
      }
    : undefined;

  const loadScenariosEffect = loadScenarios(
    scenariosDir,
    setLoadedScenarios,
    () => activeScenarioIds,
    setActiveScenarioIds,
    ruleSandbox
  );
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
    getActiveScenarioIds: () => activeScenarioIds,
    setActiveScenarioIds,
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
    getProxyPort: () => proxyPort,
    getBackend: () => backend,
    bridge,
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

  if (useMitmproxy) {
    // Control plane only — mitmdump owns the proxy port.
    yield* _(createControlServer(routes, { hostname: bindHost, port: controlPort }));
    mitmBackend = new MitmProxyBackend({
      host: bindHost,
      port: mitmPort,
      controlUrl: `http://127.0.0.1:${controlPort}`,
      bridgeToken: bridge!.token,
      ca,
    });
    yield* _(mitmBackend.start());
  } else {
    yield* _(createServer(routes, (event) => eventBus.emit(event), ca));
  }

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

  if (useMitmproxy) {
    console.log(`Control API on :${controlPort} — proxy on :${proxyPort} (mitmproxy backend)`);
  } else {
    console.log(`Proxy listening on :${proxyPort} (built-in backend, MITM enabled)`);
  }
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
