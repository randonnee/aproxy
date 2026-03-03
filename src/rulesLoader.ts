import type { LoadedScenario, LoadedView, ViewFactory } from "../shared/rules";
import { Effect } from "effect";
import { watch, existsSync, mkdirSync } from "node:fs";
import { RulesLoadError } from "./errors";
import { RuleSandbox } from "./ruleSandbox";

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

/** Scan a directory for *.{ts,js} files and load them in a sandbox worker. */
function importSandboxedModules(dir: string, sandbox: RuleSandbox) {
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
      const result = yield* _(
        Effect.tryPromise(async () => {
          const output = await (Bun.build as any)({
            entrypoints: [filePath],
            format: "cjs",
            target: "bun",
            write: false,
          });
          if (!output.success) {
            const message = output.logs.map((log: { message?: string }) => log.message ?? "").join("\n");
            throw new Error(message || "Failed to compile scenario module");
          }
          const code = await output.outputs[0].text();
          const loadResult = await sandbox.loadScenarioModule(filePath, code);
          if (loadResult.error) {
            throw new Error(loadResult.error);
          }
          return loadResult;
        }).pipe(Effect.mapError((cause) => new RulesLoadError({ cause })))
      );
      modules.push({ module: result, filePath });
    }
    return modules;
  });
}

export function loadScenarios(
  scenariosDir: string,
  setLoadedScenarios: (scenarios: LoadedScenario[]) => void,
  getActiveScenarioIds: () => string[],
  setActiveScenarioIds: (ids: string[]) => void,
  sandbox: RuleSandbox
) {
  return Effect.gen(function* (_) {
    yield* _(
      Effect.tryPromise(() => sandbox.reset()).pipe(
        Effect.mapError((cause) => new RulesLoadError({ cause }))
      )
    );
    const modules = yield* _(importSandboxedModules(scenariosDir, sandbox));
    const scenarios: LoadedScenario[] = [];

    // Rules are loaded inside the sandbox worker; expose metadata from the worker.
    for (const { module, filePath } of modules) {
      for (const meta of module.scenarios ?? []) {
        scenarios.push({
          id: meta.id,
          name: meta.name,
          description: meta.description,
          rules: meta.rules.map((rule: { id: string; name?: string; description?: string }) => ({
            id: rule.id,
            name: rule.name,
            description: rule.description,
            handle: () => null,
          })),
          filePath,
        });
      }
    }

    setLoadedScenarios(scenarios);
    const active = getActiveScenarioIds();
    const activeSet = new Set(active);
    const validIds = new Set(scenarios.map((scenario) => scenario.id));
    const nextActive = Array.from(activeSet).filter((id) => validIds.has(id));
    if (nextActive.length !== active.length) {
      setActiveScenarioIds(nextActive);
    }
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
