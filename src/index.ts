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
} from "./simulators";
import { loadScenarios, watchRules } from "./rulesLoader";
import { handleHttpProxy } from "./proxy";
import { type RuleHandler } from "./rules";
import { ensureCa } from "./ca";

const proxyPort = Number(process.env.PROXY_PORT ?? 8080);
const eventBus = new EventBus<ProxyEvent | RulesListEvent | ViewsListEvent | SimulatorEvent>();
let loadedScenarios: LoadedScenario[] = [];
let activeScenarioId: string | null = null;
let loadedViews: LoadedView[] = [];
let activeViewId: string | null = null;
const rulesDirUrl = new URL("../rules", import.meta.url);

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
  activeViewId,
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

const setActiveViewId = (id: string | null) => {
  activeViewId = id;
};

const applyRules = (context: { id: string; url: string; method: string; headers: Record<string, string> }) =>
  Effect.gen(function* (_) {
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
  // Initialize the CA for MITM SSL interception
  const ca: CaCert = yield* _(ensureCa());

  const loadRulesEffect = loadScenarios(rulesDirUrl, setLoadedScenarios, setActiveScenarioId, setLoadedViews);
  const routes = createRoutes({
    listRulesEvent,
    listViewsEvent,
    loadRules: () => loadRulesEffect,
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
    getActiveViewId: () => activeViewId,
    setActiveViewId,
    enableProxy: (input) => configureHostProxy(input),
    disableProxy: () => disableHostProxy(),
    proxyStatus: () => readHostProxySettings(),
    listSimulators: () =>
      listSimulators().pipe(
        Effect.tap((simulators) =>
          Effect.sync(() => eventBus.emit({ type: "simulators_list", simulators }))
        ),
      ),
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
  yield* _(loadRulesEffect);
  yield* _(
    watchRules(rulesDirUrl, () => {
      void Effect.runPromise(
        loadRulesEffect.pipe(Effect.tap(() => Effect.sync(() => {
          eventBus.emit(listRulesEvent());
          eventBus.emit(listViewsEvent());
        })))
      );
    })
  );
  console.log(`Proxy listening on :${proxyPort} (MITM enabled)`);
});

await Effect.runPromise(main);
