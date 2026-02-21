# AI Agent Guide

This file describes how AI agents should work in this repository.

## Project goal

Build a macOS proxying tool (like Proxyman/Charles) with a Bun-based core that can:

- Proxy HTTP traffic
- Intercept HTTPS via CONNECT with MITM SSL decryption
- Emit structured events for a React web UI (both HTTP and decrypted HTTPS)
- Configure the host macOS proxy via `networksetup`
- Manage CA certificate trust on macOS and iOS simulators

## Repo layout

### Backend (`src/`)

- `src/index.ts` — entry point, wires dependencies together
- `src/tcpProxy.ts` — raw TCP listener (`Bun.listen`), HTTP request parsing, CONNECT detection and dispatch
- `src/tunnel.ts` — CONNECT tunnel handler, bidirectional TCP piping via `Bun.connect` (blind fallback)
- `src/mitm.ts` — MITM tunnel handler, TLS termination via ephemeral `Bun.listen` TLS server, decrypted HTTP parsing, proxy pipeline reuse
- `src/ca.ts` — CA key/cert generation, per-host leaf cert signing with SAN extensions, in-memory caching
- `src/server.ts` — route definitions (control API + proxy dispatch), `createServer` wraps `createTcpProxy`
- `src/proxy.ts` — HTTP proxy forwarding logic with rule evaluation
- `src/http.ts` — SSE stream creation, hop-by-hop header stripping, header utilities
- `src/simulators.ts` — iOS simulator listing, cert install, host proxy config (`networksetup`), CA trust on host. All functions return `Effect<T, CommandError>`
- `src/eventBus.ts` — generic pub/sub for SSE events
- `src/models.ts` — TypeScript event and model types
- `src/rules.ts` — rule and view type definitions (`ScenarioFactory`, `ViewFactory`, etc.)
- `src/rulesLoader.ts` — scenario and view file loading from separate directories, hot-reload watching
- `src/errors.ts` — tagged error types (Effect-TS): `CommandError`, `RequestError`, `ProxyError`, `CertError`, `RulesLoadError`
- `src/config.ts` — user config (`~/.aproxy/config.json`) load/save, stores `defaultViewId` and `theme`
- `src/ui.html` — legacy single-page web UI (fallback if React build is missing)

### Web UI (`ui/`)

The web UI is a React + TypeScript app built with Vite, served from `ui/dist/` by the backend.

- `ui/src/App.tsx` — root component, layout shell
- `ui/src/main.tsx` — React entry point
- `ui/src/stores/appStore.ts` — Zustand store for app state (scenarios, views, requests, etc.)
- `ui/src/hooks/useSSE.ts` — SSE connection hook, processes server events
- `ui/src/hooks/useInitialData.ts` — fetches initial data on mount (proxy status, scenarios, views, simulators, CA trust, theme)
- `ui/src/lib/api.ts` — API client functions for all backend endpoints
- `ui/src/lib/types.ts` — TypeScript types for UI models
- `ui/src/lib/helpers.ts` — utility functions
- `ui/src/styles/global.css` — all styles (CSS variables, dark/light themes, layout, components)
- `ui/src/components/TopBar.tsx` — app header with title, connection dot, theme toggle
- `ui/src/components/Toolbar.tsx` — filter bar (search, method chips)
- `ui/src/components/Sidebar/Sidebar.tsx` — sidebar container
- `ui/src/components/Sidebar/ProxyToggle.tsx` — proxy enable/disable toggle
- `ui/src/components/Sidebar/ScenarioList.tsx` — scenario list with + button to import files via file picker
- `ui/src/components/Sidebar/ViewList.tsx` — view list with + button to import files via file picker, default view management
- `ui/src/components/Sidebar/SimulatorList.tsx` — iOS simulator list with CA trust buttons
- `ui/src/components/Sidebar/CaCertificate.tsx` — CA certificate status and trust management
- `ui/src/components/RequestTable/RequestTable.tsx` — request list table with resizable columns
- `ui/src/components/DetailPanel/DetailPanel.tsx` — request detail panel container
- `ui/src/components/DetailPanel/OverviewTab.tsx` — request overview tab
- `ui/src/components/DetailPanel/HeadersTab.tsx` — request/response headers tab
- `ui/src/components/DetailPanel/BodyTab.tsx` — request/response body tab
- `ui/src/components/DetailPanel/ResizeHandle.tsx` — draggable resize handle

### Examples

- `examples/scenarios/` — bundled example scenario files (mock-api.ts, mock-uuid.ts)
- `examples/views/` — bundled example view files (errors-only.ts)

### Runtime directory (`~/.aproxy/`)

- `~/.aproxy/ca.pem` — auto-generated CA certificate
- `~/.aproxy/ca-key.pem` — CA private key
- `~/.aproxy/config.json` — user config (defaultViewId, theme)
- `~/.aproxy/scenarios/` — user scenario files (loaded at runtime)
- `~/.aproxy/views/` — user view files (loaded at runtime)

## Development constraints

- Prefer minimal, focused changes per step.
- The web UI is a React app in `ui/`. After UI changes, run `npm run build` in `ui/` to update the dist served by the backend. The Vite dev server on port 3000 (via `ui/vite.config.ts` proxy) shows changes immediately during development.
- Avoid adding dependencies unless they are clearly necessary.
- The project uses Effect-TS for error handling and composition; keep that pattern.

## Event stream contract

SSE endpoint: `GET /events` on the control server (port 8080 by default).

Events are sent as unnamed SSE messages with a JSON `data:` payload. The `type` field inside the JSON identifies the event kind.

Current event types:

- `request` — HTTP or CONNECT request received
- `response` — upstream response or tunnel established
- `error` — proxy or tunnel error
- `rules_list` — current rules and active rule IDs
- `simulators_list` — available iOS simulators
- `simulator_configured` — simulator cert installed
- `simulator_error` — simulator operation failed
- `views_list` — available views and active view ID

Keep this contract stable unless the user explicitly asks to change it.

## Server architecture

The server uses a **raw TCP listener** (`Bun.listen` in `src/tcpProxy.ts`) on a single port. Incoming connections go through a state machine:

1. **Parsing** — accumulate bytes until full HTTP headers arrive
2. **CONNECT** — if a CA is configured, dispatch to `handleMitm` (MITM SSL interception); otherwise fall back to blind tunnel via `src/tunnel.ts`
3. **HTTP** — construct a `Request` object, pass to the Effect-based route handler, serialize the `Response` back as raw HTTP

This design was chosen because `Bun.serve` does not expose raw sockets, which are required for CONNECT tunneling.

## MITM SSL interception

When a CA certificate is available (auto-generated on first run at `~/.aproxy/`), CONNECT tunnels are intercepted:

1. An ephemeral TLS server (`Bun.listen` with TLS) is started on a random port using a dynamically-generated per-host leaf certificate signed by the CA
2. The client socket is bridged to this TLS server via `Bun.connect`
3. Decrypted HTTP requests are parsed and passed through the same `handleHttpProxy` / `applyRules` pipeline as plain HTTP
4. Events are emitted to the SSE stream so HTTPS traffic appears in the web UI
5. HTTP/1.1 keep-alive is supported on the decrypted connection

The blind tunnel (`src/tunnel.ts`) is preserved as a fallback when no CA is configured.

### Known Bun caveats

- **`socket.data` timing**: In `Bun.listen` TLS handlers, the `data` callback can fire before `open` sets `socket.data`. The MITM implementation uses closure-captured context instead.
- **Concurrent cert generation**: Multiple CONNECT requests to the same host use in-flight promise deduplication and UUID-suffixed temp files to avoid collisions.

## Proxy configuration

Proxy settings are applied to the **host macOS machine** via `networksetup` (not inside the iOS simulator). The proxy is a global system setting that affects all traffic on the active network interface.

API endpoints: `POST /proxy/enable`, `POST /proxy/disable`, `GET /proxy/status`.

## CA certificate management

The CA is auto-generated on first run and stored at `~/.aproxy/`. API endpoints for certificate trust:

- `GET /ca/cert` — download the CA certificate PEM file
- `GET /ca/status` — check if CA is initialized, get cert path and trust command
- `POST /ca/trust` — trust the CA in the macOS system keychain (requires sudo)
- `GET /ca/trust/status` — check if the CA is already trusted on the host
- `POST /simulators/trust-ca` — install the CA cert on a booted iOS simulator (body: `{ "udid": "..." }`)

## When adding features

- MITM SSL interception is implemented. Decrypted HTTPS traffic flows through the same rule pipeline as HTTP.
- CA certificate generation and trust management are implemented for both macOS host and iOS simulators.
- For simulator proxy config: proxy is already host-level via `networksetup`; no per-simulator config needed.
- Custom views are implemented. Views are client-side filter predicates defined in view files (`~/.aproxy/views/`) that narrow the request list in the web UI. They do not affect proxy behavior.

## Scenarios and views

Scenarios and views are separate concepts stored in separate directories:

- **Scenarios** (`~/.aproxy/scenarios/`) — files export `scenarios: ScenarioFactory[]`. Each scenario contains rules that can intercept and mock HTTP responses.
- **Views** (`~/.aproxy/views/`) — files export `views: ViewFactory[]`. Each view defines a client-side filter predicate that controls which requests appear in the web UI.

Both can be imported from the web UI sidebar via a `+` icon button that opens the native file picker. Scenario and view files are `.ts` or `.js` files.

Directories are auto-created on first run if they don't exist (`rulesLoader.ts` `ensureDir()`).

### Import endpoints

- `POST /scenarios/import` — body `{ "filename": "...", "content": "..." }`, writes file to `~/.aproxy/scenarios/` and reloads
- `POST /views/import` — body `{ "filename": "...", "content": "..." }`, writes file to `~/.aproxy/views/` and reloads
- `GET /examples/scenarios` — lists bundled example scenario files
- `GET /examples/views` — lists bundled example view files
- `POST /examples/scenarios/import` — body `{ "filename": "..." }`, copies bundled example to `~/.aproxy/scenarios/` and reloads
- `POST /examples/views/import` — body `{ "filename": "..." }`, copies bundled example to `~/.aproxy/views/` and reloads

## Custom views

Views are named filter functions exported from view files (`~/.aproxy/views/*.ts`) that control which requests appear in the web UI. They are purely a display concern — they do not affect proxy behavior, rule evaluation, or traffic interception.

### Data flow

1. View files export `views: ViewFactory[]`. Each factory returns a `ViewInstance` with `id`, `name`, optional `description`, and a `filter: (ctx: ViewContext) => boolean` predicate.
2. `src/rulesLoader.ts` loads views from all view files in `~/.aproxy/views/`, producing `LoadedView[]` (view + `filePath`).
3. `src/index.ts` stores loaded views in module-level state and constructs `views_list` events for the event bus. If a `defaultViewId` is configured, it is included in the event so the client can apply it.
4. `src/server.ts` exposes `GET /views` and `PUT /views/default` endpoints.
5. `src/http.ts` sends the initial `views_list` event when a new SSE client connects.
6. The web UI renders views in the sidebar, compiles the filter source string via `new Function`, and applies it client-side to filter the request list.

### Key types (`src/rules.ts`)

- `ViewContext` — the data available to a filter: `id`, `url`, `method`, `headers`, `status?`, `responseHeaders?`, `durationMs?`, `mocked?`
- `ViewFilter` — `(context: ViewContext) => boolean`
- `ViewInstance` — `{ id, name, description?, filter }`
- `ViewFactory` — `() => ViewInstance`
- `LoadedView` — `ViewInstance & { filePath: string }`

### API endpoints

- `GET /views` — returns `{ views, defaultViewId }`
- `PUT /views/default` — body `{ "viewId": "..." | null }`, persists `defaultViewId` to `~/.aproxy/config.json` and returns updated state

### Default view

The default view is stored in `~/.aproxy/config.json` (managed by `src/config.ts`), not in the view definition. This keeps view definitions and user preferences decoupled. The active view is purely client-side state — the server does not track it. When the UI loads, if no view is active and a default is configured, the default is automatically applied. Users can set the default from the web UI sidebar (select a view, then click "set default") or via the `PUT /views/default` endpoint.

### Hot-reload

Views are reloaded alongside scenarios when rule files change. The `watchDir` watcher re-runs the loader and emits both `rules_list` and `views_list` events.

### Client-side filter compilation

The filter function is serialized via `.toString()` and sent to the client as a string. The UI compiles it with `new Function("return (" + view.filter + ")")()`. If compilation or execution fails, the filter is skipped and the request is included.

## Error handling

All shell command operations (`openssl`, `networksetup`, `xcrun simctl`, `osascript`) use a typed `CommandError` from `src/errors.ts`. This error carries `command`, `args`, `stderr`, and `exitCode` fields with a computed `message` getter, so failures surface descriptive JSON error responses to the client instead of generic "Request error" strings.

The error type hierarchy:

- `CommandError` — shell command failures (subprocess exit code != 0), used by `src/simulators.ts` and `src/ca.ts`
- `RequestError` — wraps other errors at the route handler level in `src/server.ts`
- `ProxyError` — proxy forwarding errors
- `CertError` — certificate-related errors
- `RulesLoadError` — rule file loading errors

The route-level `catchAll` in `src/server.ts` extracts the error message from `CommandError` or `RequestError` and returns it as `{ "error": "..." }` JSON with a 400 status.

Key patterns:

- `src/simulators.ts`: all exported functions return `Effect<T, CommandError>`. The internal `runCommand` helper spawns a subprocess and yields `CommandError` on non-zero exit.
- `src/ca.ts`: `ensureCa()` and `generateCa()` return `Effect<CaCert, CommandError>`. The MITM hot path uses `runOpensslAsync` (Promise-based, throws `CommandError`) because `getHostCert`/`generateHostCert` are called from `Bun.listen` callbacks which cannot be Effect generators.
- `src/server.ts`: deps type signatures use `CommandError` for simulator/proxy/CA operations. The `catchAll` handler logs and returns descriptive error messages.

## Testing

- There are no tests yet; if adding, prefer lightweight smoke tests.
- Quick manual smoke test: `curl -x http://localhost:8080 https://httpbin.org/get`
- HTTPS MITM smoke test: `curl --cacert ~/.aproxy/ca.pem -x http://localhost:8080 https://httpbin.org/get`

## Pull request / commit guidance

- Do not create git commits unless the user asks.
- Do not run destructive git commands.
