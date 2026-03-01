import type { ScenarioFactory } from "../../shared/rules";

export const scenarios: ScenarioFactory[] = [
  () => {
    let calls = 0;
    return {
      id: "mock-uuid",
      name: "Postbin Mock",
      description: "Example mocks for postbin",
      rules: [
        {
          id: "mock-httpbin-uuid",
          name: "Mock httpbin UUID",
          description: "Return an incrementing test UUID for POST /uuid on httpbin.org",
          handle: (context) => {
            if (!/httpbin\.org\/uuid/.test(context.url)) return null;
            calls += 1;
            return new Response(
              JSON.stringify({ uuid: `test-uuid-${calls}` }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          },
        },
        {
          id: "mock-httpbin-post",
          name: "Mock httpbin post",
          description: "Parse JSON body for POST /post on httpbin.org with 2s simulated latency",
          handle: async (context) => {
            if (context.method !== "POST") return null;
            if (!/httpbin\.org\/post/.test(context.url)) return null;
            await new Promise((resolve) => setTimeout(resolve, 2000));
            let parsed: unknown = null;
            if (context.body) {
              try { parsed = JSON.parse(context.body); } catch {}
            }
            return new Response(
              JSON.stringify({
                json: {
                  mock: true,
                  message: "This is mock data from aproxy",
                  timestamp: Date.now(),
                  parsed,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          },
        },
      ],
    };
  },
];
