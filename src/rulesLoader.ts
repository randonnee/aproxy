import type { LoadedScenario, ScenarioFactory } from "./rules";
import { Effect } from "effect";
import { watch } from "node:fs";
import { RulesLoadError } from "./errors";

export function loadScenarios(
  rulesDirUrl: URL,
  setLoadedScenarios: (scenarios: LoadedScenario[]) => void,
  setActiveScenarioId: (id: string | null) => void
) {
  return Effect.gen(function* (_) {
    const ruleFiles = yield* _(
      Effect.try(() => Bun.fileURLToPath(rulesDirUrl)).pipe(
        Effect.mapError((cause) => new RulesLoadError({ cause }))
      )
    );
    const dir = yield* _(
      Effect.tryPromise(() => Bun.file(ruleFiles).exists()).pipe(
        Effect.mapError((cause) => new RulesLoadError({ cause }))
      )
    );
    if (!dir) {
      setLoadedScenarios([]);
      setActiveScenarioId(null);
      return;
    }

    const entries = yield* _(
      Effect.tryPromise(() => Array.fromAsync(new Bun.Glob("*.{ts,js}").scan(ruleFiles))).pipe(
        Effect.mapError((cause) => new RulesLoadError({ cause }))
      )
    );
    const scenarios: LoadedScenario[] = [];

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
    }

    setLoadedScenarios(scenarios);
    if (scenarios.length > 0) setActiveScenarioId(scenarios[0].id);
  }).pipe(
    Effect.catchAll(() =>
      Effect.sync(() => {
        setLoadedScenarios([]);
        setActiveScenarioId(null);
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
    const exists = yield* _(
      Effect.tryPromise(() => Bun.file(rulesDir).exists()).pipe(
        Effect.mapError((cause) => new RulesLoadError({ cause }))
      )
    );
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
