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
- `simulators_list`
- `simulator_configured`
- `simulator_error`

## Rule control (REST)

Scenarios are loaded from `rules/*.ts`. Only the active scenario's rules are evaluated, in order. The first matching rule wins.

Endpoints:

- `GET /scenarios` list scenarios and the active scenario
- `PUT /scenarios/active` set the active scenario id
- `GET /rules` list rules for the active scenario
- `POST /rules/reload` reload scenario files from disk

## Simulator control (REST)

Endpoints:

- `GET /simulators` list available simulators
- `POST /simulators/configure` set HTTP/HTTPS proxy for a booted simulator
- `POST /simulators/certs` add a root cert to a booted simulator keychain

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

List simulators:

```bash
curl -s http://localhost:8080/simulators | jq
```

Configure a simulator proxy:

```bash
curl -s -X POST http://localhost:8080/simulators/configure \
  -H "Content-Type: application/json" \
  -d '{"udid":"SIMULATOR_UDID","proxyHost":"127.0.0.1","proxyPort":8080}'
```

Install a root cert in a simulator:

```bash
curl -s -X POST http://localhost:8080/simulators/certs \
  -H "Content-Type: application/json" \
  -d '{"udid":"SIMULATOR_UDID","certPath":"/absolute/path/to/ca.pem"}'
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
- HTTPS tunneling via `CONNECT` and certificate generation are planned next.
