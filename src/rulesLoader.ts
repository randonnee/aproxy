import type { LoadedScenario, ScenarioFactory, LoadedView, ViewFactory } from "../shared/rules";
import { Effect } from "effect";
import { watch, existsSync, mkdirSync } from "node:fs";
import { RulesLoadError } from "./errors";

/** Ensure a directory exists, creating it if necessary. */
function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Scan a directory for *.{ts,js} files and dynamically import them. */
function importModules(dir: string) {
  return Effect.gen(function* (_) {
    ensureDir(dir);
    const entries = yield* _(
      Effect.tryPromise(() => Array.fromAsync(new Bun.Glob("*.{ts,js}").scan(dir))).pipe(
        Effect.mapError((cause) => new RulesLoadError({ cause }))
      )
    );
    const modules: Array<{ module: any; filePath: string }> = [];
    for (const entry of entries) {
      const filePath = `${dir}/${entry}`;
      const module = yield* _(
        Effect.tryPromise(() => import(`${filePath}?t=${Date.now()}`)).pipe(
          Effect.mapError((cause) => new RulesLoadError({ cause }))
        )
      );
      modules.push({ module, filePath });
    }
    return modules;
  });
}

export function loadScenarios(
  scenariosDir: string,
  setLoadedScenarios: (scenarios: LoadedScenario[]) => void,
  setActiveScenarioIds: (ids: string[]) => void
) {
  return Effect.gen(function* (_) {
    const modules = yield* _(importModules(scenariosDir));
    const scenarios: LoadedScenario[] = [];

    for (const { module, filePath } of modules) {
      const exportedScenarios = (module.scenarios ?? []) as ScenarioFactory[];
      for (const factory of exportedScenarios) {
        const scenario = factory();
        scenarios.push({ ...scenario, filePath });
      }
    }

    setLoadedScenarios(scenarios);
  }).pipe(
    Effect.catchAll(() =>
      Effect.sync(() => {
        setLoadedScenarios([]);
        setActiveScenarioIds([]);
      })
    )
  );
}

export function loadViews(
  viewsDir: string,
  setLoadedViews: (views: LoadedView[]) => void
) {
  return Effect.gen(function* (_) {
    const modules = yield* _(importModules(viewsDir));
    const views: LoadedView[] = [];

    for (const { module, filePath } of modules) {
      const exportedViews = (module.views ?? []) as ViewFactory[];
      for (const factory of exportedViews) {
        const view = factory();
        views.push({ ...view, filePath });
      }
    }

    setLoadedViews(views);
  }).pipe(
    Effect.catchAll(() =>
      Effect.sync(() => {
        setLoadedViews([]);
      })
    )
  );
}

export function watchDir(
  dir: string,
  onReload: () => void
) {
  return Effect.gen(function* (_) {
    ensureDir(dir);
    let debounce: ReturnType<typeof setTimeout> | null = null;
    watch(dir, { recursive: false }, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        onReload();
      }, 50);
    });
  });
}
