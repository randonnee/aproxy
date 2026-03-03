import type { ScenarioFactory } from "../../shared/rules";

export const scenarios: ScenarioFactory[] = [
  () => ({
    id: "sandbox-probe",
    name: "Sandbox Probe",
    description: "Checks that sandboxed rules cannot access network or filesystem",
    rules: [
      {
        id: "sandbox-probe-rule",
        name: "Sandbox probe",
        description: "Attempts fetch and require to verify sandbox restrictions",
        handle: () => {
          const results: string[] = [];
          const fetchFn = (globalThis as { fetch?: (input: string) => unknown }).fetch;
          if (!fetchFn) {
            results.push("fetch: blocked (not available)");
          } else {
            try {
              fetchFn("https://example.com");
              results.push("fetch: allowed (unexpected)");
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              results.push(`fetch: blocked (${message})`);
            }
          }

          const requireFn = (globalThis as { require?: (id: string) => unknown }).require;
          if (!requireFn) {
            results.push("require: blocked (not available)");
          } else {
            try {
              requireFn("fs");
              results.push("require: allowed (unexpected)");
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              results.push(`require: blocked (${message})`);
            }
          }

          return new Response(results.join("\n"), {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        },
      },
    ],
  }),
];
