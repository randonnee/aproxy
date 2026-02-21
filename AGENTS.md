# AI Agent Guide

This file describes how AI agents should work in this repository.

## Project goal

Build a macOS proxying tool (like Proxyman/Charles) with a Bun-based core that can:

- Proxy HTTP traffic
- Intercept HTTPS via CONNECT with MITM SSL decryption
- Emit structured events for a web UI (both HTTP and decrypted HTTPS)
- Configure the host macOS proxy via `networksetup`
- Manage CA certificate trust on macOS and iOS simulators

## Repo layout

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
- `src/rules.ts` — rule type definitions
- `src/rulesLoader.ts` — rule file loading and hot-reload watching
- `src/errors.ts` — tagged error types (Effect-TS): `CommandError`, `RequestError`, `ProxyError`, `CertError`, `RulesLoadError`
- `src/ui.html` — single-page web UI
- `rules/` — user-defined scenario/rule files
- `~/.aproxy/` — runtime directory for CA cert (`ca.pem`), key (`ca-key.pem`), and temp files

## Development constraints

- Prefer minimal, focused changes per step.
- Do not add UI frameworks yet; keep UI work to a simple event listener when requested.
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
- Custom views are implemented. Views are client-side filter predicates defined in rule files that narrow the request list in the web UI. They do not affect proxy behavior.

## Custom views

Views are named filter functions exported from rule files (`rules/*.ts`) that control which requests appear in the web UI. They are purely a display concern — they do not affect proxy behavior, rule evaluation, or traffic interception.

### Data flow

1. Rule files export `views: ViewFactory[]` alongside `scenarios`. Each factory returns a `ViewInstance` with `id`, `name`, optional `description`, and a `filter: (ctx: ViewContext) => boolean` predicate.
2. `src/rulesLoader.ts` loads views from all rule files, producing `LoadedView[]` (view + `filePath`).
3. `src/index.ts` stores loaded views and `activeViewId` in module-level state, and constructs `views_list` events for the event bus.
4. `src/server.ts` exposes `GET /views` and `PUT /views/active` endpoints.
5. `src/http.ts` sends the initial `views_list` event when a new SSE client connects.
6. The web UI (`src/ui.html`) renders views in the sidebar, compiles the filter source string via `new Function`, and applies it client-side to filter the request list.

### Key types (`src/rules.ts`)

- `ViewContext` — the data available to a filter: `id`, `url`, `method`, `headers`, `status?`, `responseHeaders?`, `durationMs?`, `mocked?`
- `ViewFilter` — `(context: ViewContext) => boolean`
- `ViewInstance` — `{ id, name, description?, filter }`
- `ViewFactory` — `() => ViewInstance`
- `LoadedView` — `ViewInstance & { filePath: string }`

### API endpoints

- `GET /views` — returns `{ views, activeViewId }`
- `PUT /views/active` — body `{ "viewId": "..." | null }`, returns updated state and broadcasts `views_list` via SSE

### Hot-reload

Views are reloaded alongside scenarios when rule files change. The `watchRules` watcher re-runs the loader and emits both `rules_list` and `views_list` events.

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
