# aproxy

Local HTTP/HTTPS proxy built with Bun. Intercepts traffic on macOS with MITM SSL decryption, displays requests in a web UI, and supports rule-based response mocking.

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

The proxy runs a single raw TCP listener (`Bun.listen`) on port 8080 that handles both HTTP proxy requests and HTTPS CONNECT tunneling with MITM SSL decryption.

- **HTTP requests** are parsed and dispatched through an Effect-based route handler (control routes and upstream proxy).
- **CONNECT requests** are intercepted via MITM: an ephemeral TLS server is started with a per-host certificate signed by the auto-generated CA. Decrypted traffic flows through the same proxy/rules pipeline as HTTP and appears in the web UI. A blind tunnel fallback is used when no CA is configured.

Key source files:

- `src/index.ts` — entry point, wires dependencies
- `src/tcpProxy.ts` — raw TCP listener, HTTP parsing, CONNECT detection
- `src/tunnel.ts` — CONNECT tunnel handler (blind TCP pipe fallback via `Bun.connect`)
- `src/mitm.ts` — MITM tunnel handler (TLS termination, decrypted HTTP parsing, proxy pipeline reuse)
- `src/ca.ts` — CA key/cert generation, per-host leaf cert signing with SAN extensions
- `src/server.ts` — route definitions (control API + proxy dispatch)
- `src/proxy.ts` — HTTP proxy forwarding with rule evaluation
- `src/http.ts` — SSE stream creation, header utilities
- `src/simulators.ts` — iOS simulator listing, cert install, host proxy config, CA trust. All functions return `Effect<T, CommandError>`
- `src/eventBus.ts` — generic pub/sub for SSE events
- `src/models.ts` — TypeScript event/model types
- `src/rules.ts` — rule type definitions
- `src/rulesLoader.ts` — rule file loading and hot-reload watching
- `src/errors.ts` — tagged error types (Effect-TS): `CommandError`, `RequestError`, `ProxyError`, `CertError`, `RulesLoadError`
- `src/config.ts` — user config (`~/.aproxy/config.json`) load/save
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
- `views_list` — available views and active view ID

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
- `POST /simulators/trust-ca` — install the aproxy CA cert on a booted simulator (body: `{ "udid": "..." }`)

## CA certificate management (REST)

A root CA is auto-generated on first run and stored at `~/.aproxy/`. Per-host leaf certificates are generated on-the-fly for MITM interception. To avoid TLS errors, the CA must be trusted on the host (and on any iOS simulators).

Endpoints:

- `GET /ca/cert` — download the CA certificate PEM file
- `GET /ca/status` — check if CA is initialized, get cert path and trust command
- `POST /ca/trust` — trust the CA in the macOS system keychain (requires sudo, will prompt for password)
- `GET /ca/trust/status` — check if the CA is already trusted on the host

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

Check CA status:

```bash
curl -s http://localhost:8080/ca/status | jq
```

Check if CA is trusted on host:

```bash
curl -s http://localhost:8080/ca/trust/status | jq
```

Trust the CA on macOS (will prompt for sudo password):

```bash
curl -s -X POST http://localhost:8080/ca/trust
```

Download the CA certificate:

```bash
curl -s http://localhost:8080/ca/cert -o aproxy-ca.pem
```

Install CA on an iOS simulator:

```bash
curl -s -X POST http://localhost:8080/simulators/trust-ca \
  -H "Content-Type: application/json" \
  -d '{"udid":"SIMULATOR_UDID"}'
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

Test HTTPS interception (MITM):

```bash
curl -x http://localhost:8080 --cacert ~/.aproxy/ca.pem https://httpbin.org/get
```

## Custom Views

Views are named filter predicates that narrow which requests are displayed in the web UI. They are defined in rule files alongside scenarios and applied client-side — they do not affect proxy behavior or rule evaluation.

### Defining views

Export a `views` array of `ViewFactory` functions from any file in `rules/`:

```ts
import type { ViewFactory } from "../src/rules";

export const views: ViewFactory[] = [
  () => ({
    id: "errors-only",
    name: "Errors Only",
    description: "Show only requests with 4xx/5xx status codes",
    filter: (ctx) => (ctx.status ?? 0) >= 400,
  }),
  () => ({
    id: "api-calls",
    name: "API Calls",
    description: "Show only requests containing /api/ in the URL",
    filter: (ctx) => /\/api\//.test(ctx.url),
  }),
];
```

The filter function receives a `ViewContext`:

```ts
type ViewContext = {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  status?: number;
  responseHeaders?: Record<string, string>;
  durationMs?: number;
  mocked?: boolean;
};
```

Return `true` to include the request in the view, `false` to hide it.

### How it works

1. Views are loaded from `rules/*.ts` files at startup (alongside scenarios) and hot-reloaded on file changes.
2. The web UI sidebar shows a "Views" section listing all loaded views plus an "All requests" option.
3. Selecting a view sends `PUT /views/active` to the server, which broadcasts a `views_list` SSE event to all connected clients.
4. The filter function source is serialized as a string and compiled client-side via `new Function`, then applied to the request list.

### Endpoints

- `GET /views` — list all views and the default view ID
- `PUT /views/default` — set the default view (body: `{ "viewId": "errors-only" }` or `{ "viewId": null }` to clear). The default view is persisted to `~/.aproxy/config.json` and automatically activated when the UI loads.

### Default view

You can mark a view as the default so it is automatically activated when the UI loads. The default is stored in `~/.aproxy/config.json` and can be set from the web UI (select a view, then click "set default") or via the REST API.

The active view is purely client-side state. Manually selecting a different view takes precedence over the default for the current session.

### SSE event

A `views_list` event is emitted when a new SSE client connects and whenever rule files are reloaded:

```json
{
  "type": "views_list",
  "views": [
    { "id": "errors-only", "name": "Errors Only", "description": "...", "filter": "(ctx) => (ctx.status ?? 0) >= 400" }
  ],
  "defaultViewId": "errors-only"
}
```

### Examples

List views:

```bash
curl -s http://localhost:8080/views | jq
```

Set default view:

```bash
curl -s -X PUT http://localhost:8080/views/default \
  -H "Content-Type: application/json" \
  -d '{"viewId":"errors-only"}'
```

Clear default view:

```bash
curl -s -X PUT http://localhost:8080/views/default \
  -H "Content-Type: application/json" \
  -d '{"viewId":null}'
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

## Error handling

All shell command operations (`openssl`, `networksetup`, `xcrun simctl`, `osascript`) are typed with `CommandError` from `src/errors.ts`. When a command fails, the API returns a descriptive JSON error with `command`, `args`, `stderr`, and `exitCode` instead of a generic "Request error" string.

Example error response:

```json
{
  "error": "networksetup -setwebproxy Wi-Fi 10.0.0.1 8080 exited with 1: ** Error: ..."
}
```

Error types:

- `CommandError` — shell command failures (subprocess exit code != 0)
- `RequestError` — wraps errors at the route handler level
- `ProxyError` — proxy forwarding errors
- `CertError` — certificate-related errors
- `RulesLoadError` — rule file loading errors

All simulator, proxy, and CA operations in `src/simulators.ts` and `src/ca.ts` return Effect-TS effects with typed `CommandError` channels, ensuring errors propagate through the pipeline with full context.

## Notes

- HTTP proxy and HTTPS MITM interception are fully supported.
- HTTPS traffic is decrypted via per-host certificates signed by an auto-generated CA. Decrypted requests flow through the same rule pipeline as HTTP and appear in the web UI.
- The CA must be trusted on the host (`POST /ca/trust`) and on any iOS simulators (`POST /simulators/trust-ca`) for TLS to succeed without errors.
- The blind tunnel (`src/tunnel.ts`) is used as a fallback when no CA is configured.
