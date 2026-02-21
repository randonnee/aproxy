import { Effect } from "effect";
import type { ProxyEvent, RulesListEvent } from "./models";
import type { LoadedScenario } from "./rules";
import { EventBus } from "./eventBus";
import { ProxyError } from "./errors";
import { createRoutes, createServer, createSse } from "./server";
import { loadScenarios, watchRules } from "./rulesLoader";
import { handleHttpProxy } from "./proxy";
import { type RuleHandler } from "./rules";

const proxyPort = Number(process.env.PROXY_PORT ?? 8080);
const eventBus = new EventBus<ProxyEvent | RulesListEvent>();
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
    getScenarios: () => loadedScenarios.map(({ id, name, description }) => ({ id, name, description }))
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
