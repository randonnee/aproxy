# aproxy

Local HTTP/HTTPS proxy built with Bun. Intercepts traffic on macOS with MITM SSL
decryption, displays requests in a React web UI, and supports rule-based response
mocking.

Traffic is proxied by [mitmproxy](https://mitmproxy.org/); aproxy supervises it,
bridges its flows into a React UI, and layers on scenarios, views and macOS
certificate/proxy management.

## Quick start

mitmproxy is a required dependency:

```bash
brew install mitmproxy      # or: pipx install mitmproxy
bun install
bun run dev
```

Default ports:

- Control server (UI, API, SSE): `8080`
- Proxy (mitmdump): `9090`

Override with env vars:

```bash
PROXY_PORT=8888 APROXY_MITM_PORT=9999 bun run dev
```

If `mitmdump` is missing, aproxy still starts: the UI loads and reports the
problem, CA and simulator management keep working, and enabling the system proxy
is blocked so macOS is never pointed at a dead port.

## Proxy engine

Traffic is handled by a supervised `mitmdump` subprocess. aproxy owns the
control plane — UI, API, SSE, scenarios, views and the rule sandbox — and talks
to mitmproxy through `python/aproxy_addon.py`.

Relevant env vars:

| Variable | Default | Meaning |
|---|---|---|
| `PROXY_PORT` | `8080` | control server port (UI, API, SSE) |
| `APROXY_MITM_PORT` | `9090` | port mitmproxy listens on |
| `APROXY_MITMDUMP` | auto-discovered | explicit path to the `mitmdump` binary |
| `APROXY_MITM_ADDON` | `python/aproxy_addon.py` | explicit path to the bridge addon |
| `APROXY_SSL_INSECURE` | unset | `1` skips upstream TLS verification (self-signed dev servers, benchmarks) |

The UI never hardcodes the proxy port — it reads `GET /host`, which reports
`{ host, proxyPort, engineAvailable, engineError }`.

`mitmdump` is discovered via `APROXY_MITMDUMP`, then `PATH`, then a list of
known Homebrew locations. The fallback list matters: a GUI-launched macOS app
inherits launchd's `PATH`, which excludes Homebrew.

### Why the proxy port is 9090

The obvious default of `PROXY_PORT + 1` (8081) is React Native Metro's port.
Binding it steals the port from Metro, and every RN app on the machine —
including inside the iOS simulators aproxy targets — polls
`localhost:8081/inspector/device` about once a second, flooding the UI. Requests
addressed to the proxy's own host:port are answered with `421 Misdirected
Request` and never reported as traffic; other localhost ports proxy normally.

### How it works

```
client ──▶ mitmdump :9090 (aproxy_addon.py)
                │  POST /_mitm/request   emits the request event, returns the rule decision
                │  POST /_mitm/response  emits the response event
                │  POST /_mitm/error | /_mitm/ws
                ▼
           Bun control server :8080 ──▶ SSE /events ──▶ React UI
                                    └─▶ RuleSandbox (unchanged TS rules)
```

- Only `/_mitm/request` blocks the flow; all other events are queued onto a
  background thread in the addon so mitmproxy's event loop is never stalled.
- The addon posts `/_mitm/ready` from mitmproxy's `running` hook. That is the
  readiness signal aproxy waits for — probing the port cannot tell our listener
  apart from an unrelated process already squatting on it.
- The bridge endpoints are loopback-only and gated on a per-run token
  (`X-Aproxy-Token`) generated at startup.
- mitmproxy reuses the **existing aproxy CA**: `mitmBackend.ts` writes the
  combined key+cert into `~/.aproxy/mitmproxy/mitmproxy-ca.pem`, so a CA already
  trusted on the host or an iOS simulator keeps working.
- If the control server is unreachable, the addon logs once and passes traffic
  through untouched instead of breaking the connection.

## Architecture

`Bun.serve` on port 8080 runs the control plane only — it never forwards
traffic. `mitmdump` owns port 9090 and does all the proxying, including CONNECT
tunnelling and TLS interception using aproxy's CA.

### Backend (`src/`)

- `src/index.ts` — entry point, wires dependencies, supervises the engine
- `src/mitmBackend.ts` — `mitmdump` discovery, CA export, subprocess supervision, readiness
- `python/aproxy_addon.py` — mitmproxy addon bridging flows to the control server
- `src/ca.ts` — root CA key/cert generation (mitmproxy derives leaf certs from it)
- `src/server.ts` — route definitions, the control-only `Bun.serve` server, `/_mitm/*` bridge endpoints, CORS headers for cross-origin desktop requests
- `src/http.ts` — SSE stream creation, JSON body parsing
- `src/simulators.ts` — iOS simulator listing, cert install, host proxy config, CA trust. All functions return `Effect<T, CommandError>`
- `src/eventBus.ts` — generic pub/sub for SSE events
- `src/models.ts` — TypeScript event/model types
- `src/rules.ts` — rule and view type definitions (`ScenarioFactory`, `ViewFactory`, etc.)
- `src/rulesLoader.ts` — scenario and view file loading from separate directories, hot-reload watching
- `src/errors.ts` — tagged error types (Effect-TS): `CommandError`, `RequestError`, `ProxyError`, `CertError`, `RulesLoadError`, `MitmBackendError`
- `src/config.ts` — user config (`~/.aproxy/config.json`) load/save, stores `defaultViewId`, `theme` and `maxRequests`
- `src/ui.html` — legacy single-page web UI (fallback if React build is missing)

### Web UI (`ui/`)

The web UI is a React + TypeScript app built with Vite. In standalone mode it is served from `ui/dist/` by the backend at `http://localhost:8080`. In the desktop app it is loaded via Electrobun's `views://` protocol with API calls routed to the backend via `VITE_API_BASE`.

During development, run `bun run dev:ui` for the Vite dev server on port 3000 with hot-reload. After changes, run `bun run build:ui` to update the dist served by the backend.

Key files:

- `ui/src/App.tsx` — root component, layout shell
- `ui/src/stores/appStore.ts` — Zustand store for app state
- `ui/src/hooks/useSSE.ts` — SSE connection hook, uses `API_BASE` for cross-origin support
- `ui/src/hooks/useInitialData.ts` — fetches initial data on mount
- `ui/src/lib/api.ts` — API client functions, exports `API_BASE` (set via `VITE_API_BASE` env var at build time)
- `ui/src/styles/global.css` — all styles (CSS variables, dark/light themes)
- `ui/src/components/Sidebar/` — sidebar sections (proxy toggle, scenarios, views, simulators, CA cert)
- `ui/src/components/RequestTable/` — request list table with resizable columns
- `ui/src/components/DetailPanel/` — request detail panel (overview, headers, body tabs)

### Runtime directory (`~/.aproxy/`)

- `~/.aproxy/ca.pem` — auto-generated CA certificate
- `~/.aproxy/ca-key.pem` — CA private key
- `~/.aproxy/config.json` — user config (defaultViewId, theme)
- `~/.aproxy/scenarios/` — user scenario files (loaded at runtime)
- `~/.aproxy/views/` — user view files (loaded at runtime)
- `~/.aproxy/mitmproxy/` — mitmproxy confdir, seeded with the aproxy CA

## Events (SSE)

The proxy exposes Server-Sent Events at `GET /events`.

Event types (in the JSON `data` payload):

- `request` — an HTTP request was received (HTTPS after MITM decryption)
- `response` — upstream response
- `error` — proxy error
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

## Scenarios

Scenarios are loaded from `~/.aproxy/scenarios/*.ts` (or `.js`). Each file exports `scenarios: ScenarioFactory[]`. Only the active scenario's rules are evaluated, in order. The first matching rule wins.

Scenarios can be imported from the web UI sidebar by clicking the `+` button next to the "Scenarios" header, which opens a native file picker.

Bundled examples are available in `examples/scenarios/` and can be imported via the API.

Endpoints:

- `GET /scenarios` — list scenarios and the active scenario
- `PUT /scenarios/active` — set the active scenario id
- `GET /rules` — list rules for the active scenario
- `POST /rules/reload` — reload scenario files from disk
- `POST /scenarios/import` — upload a scenario file (body: `{ "filename": "...", "content": "..." }`)
- `GET /examples/scenarios` — list bundled example scenario files
- `POST /examples/scenarios/import` — import a bundled example (body: `{ "filename": "..." }`)

Example scenario file:

```ts
import type { ScenarioFactory } from "../../src/rules";

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

## Custom Views

Views are named filter predicates that narrow which requests are displayed in the web UI. They are defined in view files (`~/.aproxy/views/*.ts`) separate from scenarios, and applied client-side — they do not affect proxy behavior or rule evaluation.

Views can be imported from the web UI sidebar by clicking the `+` button next to the "Views" header, which opens a native file picker.

Bundled examples are available in `examples/views/` and can be imported via the API.

### Defining views

Export a `views` array of `ViewFactory` functions:

```ts
import type { ViewFactory } from "../../src/rules";

export const views: ViewFactory[] = [
  () => ({
    id: "errors-only",
    name: "Errors Only",
    description: "Show only requests with 4xx/5xx status codes",
    filter: (ctx) => (ctx.status ?? 0) >= 400,
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

1. Views are loaded from `~/.aproxy/views/*.ts` files at startup and hot-reloaded on file changes.
2. The web UI sidebar shows a "Views" section listing all loaded views plus an "All requests" option.
3. The filter function source is serialized as a string and compiled client-side via `new Function`, then applied to the request list.

### Endpoints

- `GET /views` — list all views and the default view ID
- `PUT /views/default` — set the default view (body: `{ "viewId": "errors-only" }` or `{ "viewId": null }` to clear)
- `POST /views/import` — upload a view file (body: `{ "filename": "...", "content": "..." }`)
- `GET /examples/views` — list bundled example view files
- `POST /examples/views/import` — import a bundled example (body: `{ "filename": "..." }`)

### Default view

You can mark a view as the default so it is automatically activated when the UI loads. The default is stored in `~/.aproxy/config.json` and can be set from the web UI (select a view, then click "set default") or via the REST API.

The active view is purely client-side state. Manually selecting a different view takes precedence over the default for the current session.

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
- `POST /ca/trust` — trust the CA in the macOS login keychain (no admin required)
- `GET /ca/trust/status` — check if the CA is already trusted on the host

### Examples

Enable system proxy:

```bash
curl -s -X POST http://localhost:8080/proxy/enable \
  -H "Content-Type: application/json" \
  -d '{"proxyHost":"10.0.0.224"}'
```

The server picks the port (mitmproxy's, not the control server's) and refuses
with `503` when the engine is not running.

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

Install CA on an iOS simulator:

```bash
curl -s -X POST http://localhost:8080/simulators/trust-ca \
  -H "Content-Type: application/json" \
  -d '{"udid":"SIMULATOR_UDID"}'
```

Check CA status:

```bash
curl -s http://localhost:8080/ca/status | jq
```

Trust the CA on macOS (no admin required, uses login keychain):

```bash
curl -s -X POST http://localhost:8080/ca/trust
```

Download the CA certificate:

```bash
curl -s http://localhost:8080/ca/cert -o aproxy-ca.pem
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

Test HTTPS interception (MITM) — note the proxy port, not the control port:

```bash
curl -x http://localhost:9090 http://httpbin.org/get
curl -x http://localhost:9090 --cacert ~/.aproxy/ca.pem https://httpbin.org/get
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

## Desktop app (Electrobun)

The project uses [Electrobun](https://electrobun.dev) for the native macOS desktop build. Electrobun uses Bun as its runtime, so all existing networking code runs unchanged.

```bash
# Dev mode (with HMR if Vite dev server is running)
bun run desktop

# Production build (outputs DMG to artifacts/)
bun run desktop:build
```

The desktop app loads the UI via `views://mainview/index.html` (Electrobun's built-in protocol for bundled views) instead of from the backend HTTP server. API calls use absolute URLs (`http://127.0.0.1:8080/...`) baked in at build time via `VITE_API_BASE`. The backend includes CORS headers on all control responses to support this cross-origin setup.

Builds are **unsigned unless signing credentials are present in the
environment** — `bun run desktop:build` always produces a working DMG. Set
`ELECTROBUN_DEVELOPER_ID` to sign, plus `ELECTROBUN_APPLEID`,
`ELECTROBUN_APPLEIDPASS` and `ELECTROBUN_TEAMID` to notarize.

For an unsigned build, clear the Gatekeeper quarantine after copying to
`/Applications`:

```bash
xattr -cr /Applications/Aproxy.app
```

## Notes

- HTTP proxy and HTTPS MITM interception are fully supported.
- HTTPS traffic is decrypted by mitmproxy using per-host certificates derived from aproxy's CA. Decrypted requests flow through the same rule pipeline as HTTP and appear in the web UI.
- The CA must be trusted on the host (`POST /ca/trust`) and on any iOS simulators (`POST /simulators/trust-ca`) for TLS to succeed without errors.
- `mitmdump` never outlives aproxy: the supervisor stops it on shutdown, and the addon runs a watchdog thread that exits when it is reparented, covering `SIGKILL` and host runtimes that swallow signals.
