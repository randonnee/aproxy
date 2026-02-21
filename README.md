# aproxy

Early-stage local HTTP proxy core built with Bun.

## Quick start

```bash
bun install
bun run dev
```

Default port:

- Proxy + control server: `8080`

Override with env vars:

```bash
PROXY_PORT=8888 bun run dev
```

## Events (SSE)

The proxy server exposes Server-Sent Events at `http://localhost:8080/events`.

Events:

- `request`
- `response`
- `error`
- `rules_list`

## Rule control (REST)

Scenarios are loaded from `rules/*.ts`. Only the active scenario's rules are evaluated, in order. The first matching rule wins.

Endpoints:

- `GET /scenarios` list scenarios and the active scenario
- `PUT /scenarios/active` set the active scenario id
- `GET /rules` list rules for the active scenario
- `POST /rules/reload` reload scenario files from disk

### Examples

List scenarios:

```bash
curl -s http://localhost:8080/scenarios | jq
```

Set active scenario:

```bash
curl -s -X PUT http://localhost:8080/scenarios/active \
  -H "Content-Type: application/json" \
  -d '{"scenarioId":"mock-api"}'
```

List rules:

```bash
curl -s http://localhost:8080/rules | jq
```

Stream events:

```bash
curl -N http://localhost:8080/events
```

## Rules

Rules are TypeScript modules under `rules/`. Each file exports `rules: Rule[]`.

Example:

```ts
import type { ScenarioFactory } from "../src/rules";

export const scenarios: ScenarioFactory[] = [
  () => {
    let calls = 0;
    return {
      id: "mock-api",
      name: "Mock API",
      description: "Serve mock user responses",
      rules: [
        {
          id: "mock-users",
          handle: (context) => {
            calls += 1;
            if (context.method !== "GET") return null;
            if (!/\/api\/users/.test(context.url)) return null;
            return new Response(JSON.stringify({ calls, users: [{ id: 1, name: "Ava" }] }), {
              status: 200,
              headers: { "content-type": "application/json" }
            });
          }
        }
      ]
    };
  }
];
```

## Notes

- This initial core only supports HTTP proxying (absolute-form and origin-form requests).
- HTTPS tunneling via `CONNECT`, certificate generation, and simulator configuration are planned next.
