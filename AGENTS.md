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
- `src/tunnel.ts` — CONNECT tunnel handler, bidirectional TCP piping via `Bun.connect` (blind fallback, no events emitted)
- `src/mitm.ts` — MITM tunnel handler, TLS termination via ephemeral `Bun.listen` TLS server, decrypted HTTP parsing, proxy pipeline reuse
- `src/ca.ts` — CA key/cert generation, per-host leaf cert signing with SAN extensions, in-memory caching
- `src/server.ts` — route definitions (control API + proxy dispatch), CORS headers for cross-origin desktop requests, `createServer` wraps `createTcpProxy`
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
- `ui/src/hooks/useSSE.ts` — SSE connection hook, processes server events, uses `API_BASE` for cross-origin support
- `ui/src/hooks/useInitialData.ts` — fetches initial data on mount (proxy status, scenarios, views, simulators, CA trust, theme)
- `ui/src/lib/api.ts` — API client functions for all backend endpoints, exports `API_BASE` (set via `VITE_API_BASE` env var at build time)
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

- `request` — HTTP request received (HTTPS requests appear after MITM decryption)
- `response` — upstream response
- `error` — proxy error
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

### MITM data flow

The MITM pipeline has three socket layers:

```
Client  <--TCP-->  tcpProxy (raw TCP listener, port 8080)
                       |
                   clientSocket.data.peer = bridgeSocket
                       |
Bridge  <--TCP-->  Bun.connect to 127.0.0.1:ephemeralPort
                       |
TLS     <--TLS-->  Bun.listen TLS server (ephemeral port, per-host cert)
                       |
                   handleDecryptedData() -> processNext() -> dispatchRequest()
                       |
                   fetch() to upstream server
```

**Request path** (client -> upstream):
1. Client sends TLS ClientHello through the raw TCP tunnel
2. `tcpProxy.ts` forwards bytes to `bridgeSocket` (peer)
3. Bridge socket forwards to the ephemeral TLS listener
4. TLS listener decrypts and delivers plaintext HTTP to `handleDecryptedData()`
5. `dispatchRequest()` sends `fetch()` to the real upstream server

**Response path** (upstream -> client):
1. `dispatchRequest()` reads the full response body from upstream
2. Writes HTTP/1.1 response to the TLS socket via `socketWrite()` (with backpressure)
3. TLS socket encrypts the data
4. Encrypted bytes arrive at bridge socket's `data` handler
5. Bridge's `writeToClient()` forwards to the client socket (with overflow buffering)
6. If client socket buffer is full, overflow is queued and flushed via `drain` handler in `tcpProxy.ts`

### Decrypted HTTP parser

The MITM HTTP parser (`src/mitm.ts`) uses a state machine with three functions:

- **`handleDecryptedData()`** — synchronous entry point called by Bun's `data` handler. Accumulates bytes into `ctx.buffer` and calls `processNext()` if not already processing a request.
- **`processNext()`** — state machine that transitions between `"headers"` (looking for `\r\n\r\n`) and `"body"` (accumulating `Content-Length` bytes). Once a complete request is parsed, calls `dispatchRequest()`.
- **`dispatchRequest()`** — extracts the request body from the buffer, constructs a `Request`, runs it through the Effect-based fetch handler, reads the full response, and writes it back as raw HTTP/1.1. Uses `ctx.processing` flag to serialize requests (one at a time per connection). After completing, checks for buffered pipelined data and re-enters `processNext()`.

### Backpressure handling

Large responses (e.g. YouTube at ~687KB) require proper backpressure at two levels:

1. **TLS socket writes** (`socketWrite()`): Writes decrypted response data to the TLS socket. If `socket.write()` returns fewer bytes than provided (buffer full), waits for the `drain` event via a Promise resolved by `ctx.drainResolve`. Handles partial writes by looping until all bytes are sent. Body is written in 16KB chunks.

2. **Client socket writes** (`writeToClient()` / `flushClientOverflow()`): The bridge socket receives encrypted data from the TLS server and forwards it to the client socket. If `clientSocket.write()` returns a partial write, the remainder is queued in `clientOverflow[]`. The `drain` handler in `tcpProxy.ts` calls `flushClientOverflow()` to send queued data when the client socket buffer has space.

### Known Bun caveats

- **`socket.data` timing**: In `Bun.listen` TLS handlers, the `data` callback can fire before `open` sets `socket.data`. The MITM implementation uses closure-captured context instead.
- **Concurrent cert generation**: Multiple CONNECT requests to the same host use in-flight promise deduplication and UUID-suffixed temp files to avoid collisions.
- **ALPN wire format**: `Bun.listen` TLS config accepts `ALPNProtocols` as `string | BufferSource`. A plain string like `"http/1.1"` breaks the TLS handshake. The correct format is a wire-format Buffer with length-prefixed protocol names: `Buffer.from("\x08http/1.1")` where `\x08` is the byte length of `"http/1.1"`.
- **`socket.write()` backpressure**: `socket.write()` returns the number of bytes actually written. When the send buffer is full, it returns 0 or a partial count — remaining bytes are silently discarded unless the caller handles this. The `drain` event fires when buffer space is available.

## Proxy configuration

Proxy settings are applied to the **host macOS machine** via `networksetup` (not inside the iOS simulator). The proxy is a global system setting that affects all traffic on the active network interface.

API endpoints: `POST /proxy/enable`, `POST /proxy/disable`, `GET /proxy/status`.

## CA certificate management

The CA is auto-generated on first run and stored at `~/.aproxy/`. The CA certificate is generated with proper X.509 extensions (`basicConstraints=critical,CA:TRUE`, `keyUsage=critical,keyCertSign,cRLSign`, `subjectKeyIdentifier=hash`) required by browsers like Chrome.

CA trust is installed in the **user login keychain** (`~/Library/Keychains/login.keychain-db`) with unconditional SSL trust (`-p ssl`). This avoids requiring admin privileges and works reliably with Chrome, which uses the Chrome Root Store and reads from the login keychain.

API endpoints for certificate trust:

- `GET /ca/cert` — download the CA certificate PEM file
- `GET /ca/status` — check if CA is initialized, get cert path and trust command
- `POST /ca/trust` — trust the CA in the macOS login keychain (no admin required)
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

## Issues encountered and solutions (Chrome HTTPS interception)

Getting Chrome to work through the MITM proxy required solving five distinct issues. Safari and curl worked before these fixes; Chrome has stricter requirements.

### 1. ALPN protocol negotiation (Chrome uses HTTP/2 by default)

**Problem**: Chrome negotiates HTTP/2 via ALPN during the TLS handshake. The MITM TLS listener didn't specify ALPN protocols, so Chrome would negotiate h2 and send HTTP/2 frames. The decrypted HTTP parser only understands HTTP/1.1, so it saw binary garbage instead of text-based request lines.

**Symptom**: Corrupted URLs like `https://clients4.google.com3C͕#Ə...` in the request log, or completely silent failures.

**Fix**: Added `ALPNProtocols: Buffer.from("\x08http/1.1")` to the `Bun.listen` TLS config in `src/mitm.ts`. This tells the client during TLS negotiation that only HTTP/1.1 is supported. Chrome falls back to HTTP/1.1 gracefully.

**Bun caveat**: Bun's `ALPNProtocols` field accepts `string | BufferSource`, but passing a plain string `"http/1.1"` breaks the TLS handshake entirely (the client gets a TLS error and the connection fails). The value must be a wire-format Buffer with length-prefixed protocol names per the TLS ALPN extension spec: `Buffer.from("\x08http/1.1")` where `\x08` (8) is the byte length of `"http/1.1"`.

### 2. CA certificate missing keyUsage extensions

**Problem**: The original `generateCa()` in `src/ca.ts` used `openssl req -new -x509` without any X.509 extensions. The resulting CA certificate had no `basicConstraints` or `keyUsage` fields. Chrome's certificate validation requires `basicConstraints=CA:TRUE` and `keyUsage=keyCertSign` for a certificate to be accepted as a CA that can sign leaf certs.

**Symptom**: Chrome showed `ERR_CERT_AUTHORITY_INVALID` even after trusting the CA in the keychain. Safari was more lenient and accepted it.

**Fix**: Added `-addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -addext "subjectKeyIdentifier=hash"` flags to the `openssl req` command in `generateCa()`. After changing this, the old CA files at `~/.aproxy/` must be deleted so they are regenerated on next start.

### 3. CA trust location and SSL policy (Chrome Root Store)

**Problem**: The original trust command (`security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain`) had two issues:
- It required `sudo` (admin privileges) to write to the system keychain
- It set generic trust, not SSL-specific trust. Chrome uses the Chrome Root Store and checks for explicit SSL trust policy

**Symptom**: Chrome showed `ERR_CERT_AUTHORITY_INVALID` even with the CA in the system keychain. The `security` command prompted for admin password via GUI dialog.

**Fix**: Changed `trustCaCertOnHost()` in `src/simulators.ts` to install trust in the **user login keychain** with explicit SSL trust policy:
```
security add-trusted-cert -r trustRoot -p ssl -k ~/Library/Keychains/login.keychain-db <cert>
```
The `-p ssl` flag sets unconditional SSL trust (not just "always trust"). Using the login keychain avoids admin privileges entirely. Chrome reads trusted certs from the login keychain reliably.

### 4. Content-Encoding mismatch (double decompression)

**Problem**: Bun's `fetch()` transparently decompresses gzip/br/deflate response bodies. The proxy was forwarding the decompressed body but keeping the original `content-encoding` header and the original (compressed) `content-length` from upstream. Chrome would attempt to decompress the already-decompressed body, resulting in garbled content or errors.

**Symptom**: Pages loaded but content was corrupted or truncated. `content-length` didn't match the actual body size.

**Fix**: In `src/proxy.ts` (`computeProxyOutcome`), after reading the response body via `arrayBuffer()`:
- Delete the `content-encoding` header (body is no longer encoded)
- Set `content-length` to the actual decompressed body size (`bodyBytes.byteLength`)

This fix is in the shared proxy pipeline, so it applies to both HTTP and MITM-intercepted HTTPS requests.

### 5. Large response truncation (backpressure)

**Problem**: Bun's `socket.write()` returns the number of bytes actually written. When the socket send buffer is full, it returns 0 or a partial count, and remaining bytes are silently discarded. For large responses (YouTube's homepage is ~687KB), the buffer fills up and data is lost.

**Symptom**: YouTube pages consistently truncated at exactly 327,680 bytes (320KB = 20 x 16KB TLS records). The response would end mid-HTML, breaking the page.

**Fix**: Backpressure handling at two levels:

**Level 1 — TLS socket writes** (`socketWrite()` in `src/mitm.ts`): The response body is written in 16KB chunks. After each `socket.write()`, if fewer bytes were written than provided, the function awaits a Promise that is resolved by the TLS socket's `drain` event handler. It loops until all bytes are sent, handling partial writes correctly.

**Level 2 — Client socket writes** (`writeToClient()` / `flushClientOverflow()` in `src/mitm.ts`): The bridge socket receives encrypted data from the TLS server and forwards it to the client socket. If `clientSocket.write()` returns a partial write, the remainder is queued in an overflow buffer (`clientOverflow[]`). The client socket's `drain` handler in `tcpProxy.ts` calls `flushClientOverflow()` to send queued data when buffer space becomes available. This required adding a `flushOverflow` callback to the `SocketData` type in `tcpProxy.ts`.

### 6. MITM HTTP parser issues (original `handleDecryptedData`)

**Problem**: The original MITM HTTP parser was a single `async` function called from Bun's synchronous `data` handler. Multiple issues:
- Being `async`, concurrent `data` events could corrupt shared state (race condition)
- GET/HEAD requests discarded any trailing bytes in the buffer (pipelined requests lost)
- Request body spanning multiple `data` events wasn't properly accumulated
- No request line validation — binary data (from h2 before ALPN fix) was interpreted as URLs

**Fix**: Rewrote the parser as a three-function state machine:
- `handleDecryptedData()` — synchronous accumulator, only appends to buffer and kicks off processing if idle
- `processNext()` — state machine transitioning between `"headers"` and `"body"` states, preserves unconsumed buffer bytes
- `dispatchRequest()` — async request forwarding with `ctx.processing` flag preventing concurrent handling; re-enters `processNext()` after completing to handle pipelined requests

## Testing

- There are no tests yet; if adding, prefer lightweight smoke tests.
- Quick manual smoke test: `curl -x http://localhost:8080 https://httpbin.org/get`
- HTTPS MITM smoke test: `curl --cacert ~/.aproxy/ca.pem -x http://localhost:8080 https://httpbin.org/get`

## Benchmarking

`scripts/bench.ts` measures proxy throughput with an SSE listener connected (simulating the web UI). It spins up a local upstream server, starts the proxy, connects an SSE reader, then fires load via raw TCP sockets.

Run: `bun run bench [-- OPTIONS]`

Options:

- `--requests N` — total requests (default 2000)
- `--concurrency N` — parallel workers (default 50)
- `--warmup N` — warmup requests, not measured (default 100)
- `--req-size N` — request body size in bytes, switches to POST (default 0 = GET)
- `--res-size N` — response body size in bytes (default 0 = tiny JSON)
- `--body-size N` — shorthand: sets both `--req-size` and `--res-size`
- `--https` — use HTTPS via CONNECT tunnel + MITM interception
- `--keepalive N` — reuse each CONNECT+TLS connection for N requests (default 1, only meaningful with `--https`)

Examples:

```bash
bun run bench                                        # HTTP baseline, tiny GET
bun run bench -- --concurrency 200 --requests 5000   # HTTP, high concurrency
bun run bench -- --res-size 102400                   # HTTP, 100KB responses
bun run bench -- --https                             # HTTPS through MITM pipeline
bun run bench -- --https --keepalive 50              # HTTPS with connection reuse
bun run bench -- --https --keepalive 20 --res-size 102400  # HTTPS, 100KB, keep-alive
```

The script uses `lvh.me` as the target hostname (resolves to `127.0.0.1`) because the proxy treats requests to `127.0.0.1`/`localhost` as control API requests. In HTTPS mode, it generates a temporary self-signed cert for the upstream server and runs the proxy with `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Desktop app (Electrobun)

The project uses Electrobun (not Electron) for the desktop build. Electrobun uses Bun as its runtime, so all existing networking code runs unchanged.

- `electrobun.config.ts` — build config, copies built UI into `views/mainview/` in the app bundle
- `src/electrobun/index.ts` — desktop entry point, loads the UI via `views://mainview/index.html` (Electrobun's built-in protocol for bundled views), with HMR dev server detection in dev mode
- `scripts/build-ui.ts` — preBuild hook, builds the React UI with `VITE_API_BASE=http://127.0.0.1:8080` so API calls use absolute URLs (required because the UI is loaded via `views://` not from the backend server)
- Dev: `bun run desktop` (runs `electrobun dev`)
- Production: `bun run desktop:build` (runs `electrobun build --env=stable`, outputs DMG to `artifacts/`)

### Desktop UI loading

In the desktop app, the UI is loaded from the app bundle via the `views://mainview/index.html` protocol instead of being served by the backend HTTP server. This means:

1. The React UI is built with `VITE_API_BASE=http://127.0.0.1:8080` baked in, so all `fetch()` and `EventSource` calls use absolute URLs to reach the backend.
2. The backend includes CORS headers (`Access-Control-Allow-Origin: *`) on all control request responses so cross-origin requests from the `views://` origin succeed.
3. In dev mode, if the Vite dev server is running on port 3000, the desktop window loads from there for HMR support.

### Standalone vs desktop UI serving

| Mode | UI loaded from | API calls | CORS needed |
|------|---------------|-----------|-------------|
| **Standalone** (`bun run start`) | Backend serves `ui/dist/` at `/` | Relative URLs (`/events`, etc.) | No (same origin) |
| **Desktop prod** | `views://mainview/index.html` | Absolute: `http://127.0.0.1:8080/...` | Yes |
| **Desktop dev + HMR** | `http://localhost:3000` (Vite) | Vite proxy handles routing | No |

### Installing unsigned builds

The DMG/app is currently **unsigned**. macOS Gatekeeper will show "damaged" or "unidentified developer" errors. To work around this, after mounting the DMG and copying the app:

```bash
xattr -cr /Applications/Aproxy.app
```

### Next step: code signing and notarization

To eliminate the Gatekeeper warning, enable code signing and notarization. This requires an Apple Developer Program membership ($99/yr).

**1. Get a signing certificate:**
- Enroll at https://developer.apple.com/programs/
- In the Developer portal (Certificates, IDs & Profiles), create a "Developer ID Application" certificate
- Or in Xcode: Settings > Accounts > Manage Certificates > "+" > Developer ID Application
- Verify it's installed: `security find-identity -v -p codesigning` should show `"Developer ID Application: Your Name (TEAMID)"`

**2. Update `electrobun.config.ts`:**
```typescript
mac: {
  bundleCEF: false,
  codesign: true,
  notarize: true,
},
```

**3. Create an app-specific password:**
- Go to https://appleid.apple.com/account/manage
- Sign In & Security > App-Specific Passwords > Generate

**4. Add GitHub Actions secrets** (Settings > Secrets and variables > Actions):

| Secret | Value |
|---|---|
| `CERTIFICATE_P12_BASE64` | `.p12` export of "Developer ID Application" cert, base64-encoded (`base64 -i cert.p12 \| pbcopy`) |
| `CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `ELECTROBUN_DEVELOPER_ID` | Full identity string, e.g. `Developer ID Application: Your Name (TEAMID)` |
| `ELECTROBUN_APPLEID` | Apple ID email |
| `ELECTROBUN_APPLEIDPASS` | App-specific password (from step 3) |
| `ELECTROBUN_TEAMID` | Apple Developer Team ID |

**5. Update `.github/workflows/build.yml`** to import the certificate into a temporary keychain and pass env vars:
```yaml
- name: Import signing certificate
  env:
    CERTIFICATE_P12_BASE64: ${{ secrets.CERTIFICATE_P12_BASE64 }}
    CERTIFICATE_PASSWORD: ${{ secrets.CERTIFICATE_PASSWORD }}
  run: |
    KEYCHAIN_PATH=$RUNNER_TEMP/signing.keychain-db
    KEYCHAIN_PASSWORD=$(openssl rand -hex 16)
    echo "$CERTIFICATE_P12_BASE64" | base64 --decode > $RUNNER_TEMP/certificate.p12
    security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
    security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
    security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
    security import $RUNNER_TEMP/certificate.p12 \
      -P "$CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
    security set-key-partition-list -S apple-tool:,apple:,codesign: \
      -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
    security list-keychains -d user -s "$KEYCHAIN_PATH" login.keychain-db

- name: Build desktop app
  run: bunx electrobun build --env=stable
  env:
    ELECTROBUN_DEVELOPER_ID: ${{ secrets.ELECTROBUN_DEVELOPER_ID }}
    ELECTROBUN_APPLEID: ${{ secrets.ELECTROBUN_APPLEID }}
    ELECTROBUN_APPLEIDPASS: ${{ secrets.ELECTROBUN_APPLEIDPASS }}
    ELECTROBUN_TEAMID: ${{ secrets.ELECTROBUN_TEAMID }}

- name: Clean up keychain
  if: always()
  run: security delete-keychain $RUNNER_TEMP/signing.keychain-db 2>/dev/null || true
```

## Pull request / commit guidance

- Do not create git commits unless the user asks.
- Do not run destructive git commands.
