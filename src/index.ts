import { Effect } from "effect";
import type { ProxyEvent, RulesListEvent, SimulatorEvent } from "./models";
import type { LoadedScenario } from "./rules";
import { EventBus } from "./eventBus";
import { ProxyError } from "./errors";
import { createRoutes, createServer, createSse } from "./server";
import { configureSimulatorProxy, installSimulatorCertificate, listSimulators } from "./simulators";
import { loadScenarios, watchRules } from "./rulesLoader";
import { handleHttpProxy } from "./proxy";
import { type RuleHandler } from "./rules";

const proxyPort = Number(process.env.PROXY_PORT ?? 8080);
const eventBus = new EventBus<ProxyEvent | RulesListEvent | SimulatorEvent>();
let loadedScenarios: LoadedScenario[] = [];
let activeScenarioId: string | null = null;
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


const setLoadedScenarios = (scenarios: LoadedScenario[]) => {
  loadedScenarios = scenarios;
};

const setActiveScenarioId = (id: string | null) => {
  activeScenarioId = id;
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
  const loadRulesEffect = loadScenarios(rulesDirUrl, setLoadedScenarios, setActiveScenarioId);
  const routes = createRoutes({
    listRulesEvent,
    loadRules: () => loadRulesEffect,
    handleProxy,
    createSse: (signal) => createSse(eventBus, listRulesEvent, signal),
    getActiveScenarioId: () => activeScenarioId,
    setActiveScenarioId,
    getScenarios: () => loadedScenarios.map(({ id, name, description }) => ({ id, name, description })),
    listSimulators: () =>
      Effect.tryPromise(() => listSimulators()).pipe(
        Effect.tap((simulators) =>
          Effect.sync(() => eventBus.emit({ type: "simulators_list", simulators }))
        ),
        Effect.mapError((cause) => new ProxyError({ cause }))
      ),
    configureSimulator: (input: { udid: string; proxyHost: string; proxyPort: number }) =>
      Effect.tryPromise(() => configureSimulatorProxy(input)).pipe(
        Effect.tap((simulator) =>
          Effect.sync(() =>
            eventBus.emit({
              type: "simulator_configured",
              simulator,
              proxyHost: input.proxyHost,
              proxyPort: input.proxyPort
            })
          )
        ),
        Effect.mapError((cause) => new ProxyError({ cause }))
      ),
    installSimulatorCert: (input: { udid: string; certPath: string }) =>
      Effect.tryPromise(() => installSimulatorCertificate(input)).pipe(
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
        Effect.mapError((cause) => new ProxyError({ cause }))
      )
  });

  yield* _(createServer(routes));
  yield* _(loadRulesEffect);
  yield* _(
    watchRules(rulesDirUrl, () => {
      void Effect.runPromise(
        loadRulesEffect.pipe(Effect.tap(() => Effect.sync(() => eventBus.emit(listRulesEvent()))))
      );
    })
  );
  console.log(`Proxy listening on :${proxyPort}`);
});

await Effect.runPromise(main);
