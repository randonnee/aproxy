import type { LoadedScenario, ScenarioFactory, LoadedView, ViewFactory } from "./rules";
import { Effect } from "effect";
import { watch, existsSync } from "node:fs";
import { RulesLoadError } from "./errors";

export function loadScenarios(
  rulesDirUrl: URL,
  setLoadedScenarios: (scenarios: LoadedScenario[]) => void,
  setActiveScenarioId: (id: string | null) => void,
  setLoadedViews: (views: LoadedView[]) => void
) {
  return Effect.gen(function* (_) {
    const ruleFiles = yield* _(
      Effect.try(() => Bun.fileURLToPath(rulesDirUrl)).pipe(
        Effect.mapError((cause) => new RulesLoadError({ cause }))
      )
    );
    const dir = existsSync(ruleFiles);
    if (!dir) {
      setLoadedScenarios([]);
      setActiveScenarioId(null);
      setLoadedViews([]);
      return;
    }

    const entries = yield* _(
      Effect.tryPromise(() => Array.fromAsync(new Bun.Glob("*.{ts,js}").scan(ruleFiles))).pipe(
        Effect.mapError((cause) => new RulesLoadError({ cause }))
      )
    );
    const scenarios: LoadedScenario[] = [];
    const views: LoadedView[] = [];

    for (const entry of entries) {
      const filePath = `${ruleFiles}/${entry}`;
      const module = yield* _(
        Effect.tryPromise(() => import(`${filePath}?t=${Date.now()}`)).pipe(
          Effect.mapError((cause) => new RulesLoadError({ cause }))
        )
      );
      const exportedScenarios = (module.scenarios ?? []) as ScenarioFactory[];
      for (const factory of exportedScenarios) {
        const scenario = factory();
        scenarios.push({ ...scenario, filePath });
      }
      const exportedViews = (module.views ?? []) as ViewFactory[];
      for (const factory of exportedViews) {
        const view = factory();
        views.push({ ...view, filePath });
      }
    }

    setLoadedScenarios(scenarios);
    setLoadedViews(views);
  }).pipe(
    Effect.catchAll(() =>
      Effect.sync(() => {
        setLoadedScenarios([]);
        setActiveScenarioId(null);
        setLoadedViews([]);
      })
    )
  );
}

export function watchRules(
  rulesDirUrl: URL,
  onReload: () => void
) {
  return Effect.gen(function* (_) {
    const rulesDir = yield* _(
      Effect.try(() => Bun.fileURLToPath(rulesDirUrl)).pipe(
        Effect.mapError((cause) => new RulesLoadError({ cause }))
      )
    );
    const exists = existsSync(rulesDir);
    if (!exists) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    watch(rulesDir, { recursive: false }, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        onReload();
      }, 50);
    });
  });
}
