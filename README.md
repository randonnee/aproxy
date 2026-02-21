# aproxy

Local HTTP/HTTPS proxy built with Bun. Intercepts traffic on macOS, displays requests in a web UI, and supports rule-based response mocking.

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

## Architecture

The proxy runs a single raw TCP listener (`Bun.listen`) on port 8080 that handles both HTTP proxy requests and HTTPS CONNECT tunneling.

- **HTTP requests** are parsed and dispatched through an Effect-based route handler (control routes and upstream proxy).
- **CONNECT requests** establish a bidirectional TCP tunnel to the target host, allowing HTTPS traffic to pass through without decryption.

Key source files:

- `src/index.ts` — entry point, wires dependencies
- `src/tcpProxy.ts` — raw TCP listener, HTTP parsing, CONNECT detection
- `src/tunnel.ts` — CONNECT tunnel handler (bidirectional TCP pipe via `Bun.connect`)
- `src/server.ts` — route definitions (control API + proxy dispatch)
- `src/proxy.ts` — HTTP proxy forwarding with rule evaluation
- `src/http.ts` — SSE stream creation, header utilities
- `src/simulators.ts` — iOS simulator listing, cert install, host proxy config via `networksetup`
- `src/eventBus.ts` — generic pub/sub for SSE events
- `src/models.ts` — TypeScript event/model types
- `src/rules.ts` — rule type definitions
- `src/rulesLoader.ts` — rule file loading and hot-reload watching
- `src/ui.html` — single-page web UI

## Web UI

Open `http://localhost:8080` in a browser to see proxied requests in real time.

## Events (SSE)

The proxy exposes Server-Sent Events at `GET /events`.

Event types (in the JSON `data` payload):

- `request` — an HTTP or CONNECT request was received
- `response` — upstream response (or tunnel established)
- `error` — proxy or tunnel error
- `rules_list` — current rules and active rule IDs
- `simulators_list` — available iOS simulators
- `simulator_configured` — simulator cert installed
- `simulator_error` — simulator operation failed

## System proxy control (REST)

The proxy configures the host macOS network stack via `networksetup`. This is a global setting — it applies to all traffic on the active network interface, not just a single simulator.

Endpoints:

- `POST /proxy/enable` — enable HTTP+HTTPS proxy on the active network interface
- `POST /proxy/disable` — disable the proxy
- `GET /proxy/status` — read current proxy settings

## Rule control (REST)

Scenarios are loaded from `rules/*.ts`. Only the active scenario's rules are evaluated, in order. The first matching rule wins.

Endpoints:

- `GET /scenarios` — list scenarios and the active scenario
- `PUT /scenarios/active` — set the active scenario id
- `GET /rules` — list rules for the active scenario
- `POST /rules/reload` — reload scenario files from disk

## Simulator control (REST)

Endpoints:

- `GET /simulators` — list available iOS simulators
- `POST /simulators/certs` — install a root cert in a booted simulator's keychain

### Examples

Enable system proxy:

```bash
curl -s -X POST http://localhost:8080/proxy/enable \
  -H "Content-Type: application/json" \
  -d '{"proxyHost":"10.0.0.224","proxyPort":8080}'
```

Check proxy status:

```bash
curl -s http://localhost:8080/proxy/status | jq
```

Disable system proxy:

```bash
curl -s -X POST http://localhost:8080/proxy/disable
```

List simulators:

```bash
curl -s http://localhost:8080/simulators | jq
```

Install a root cert in a simulator:

```bash
curl -s -X POST http://localhost:8080/simulators/certs \
  -H "Content-Type: application/json" \
  -d '{"udid":"SIMULATOR_UDID","certPath":"/absolute/path/to/ca.pem"}'
```

Stream events:

```bash
curl -N http://localhost:8080/events
```

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

Test HTTPS tunneling:

```bash
curl -x http://localhost:8080 https://httpbin.org/get
```

## Rules

Rules are TypeScript modules under `rules/`. Each file exports `scenarios: ScenarioFactory[]`.

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

- HTTP proxy and HTTPS CONNECT tunneling are fully supported.
- CONNECT tunneling is a blind TCP pipe — traffic is not decrypted (no MITM). MITM interception with certificate generation is planned next.
