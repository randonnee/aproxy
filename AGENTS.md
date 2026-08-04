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

- `src/index.ts` — entry point, wires dependencies together, supervises the engine, owns `engineStatus()`
- `src/mitmBackend.ts` — `mitmdump` discovery, CA export into mitmproxy's confdir, subprocess supervision, readiness
- `src/ca.ts` — root CA key/cert generation (mitmproxy derives leaf certs from it)
- `src/server.ts` — route definitions, `createControlServer` (`Bun.serve`, control plane only), `/_mitm/*` bridge endpoints, CORS headers for cross-origin desktop requests
- `src/http.ts` — SSE stream creation, JSON body parsing
- `src/simulators.ts` — iOS simulator listing, cert install, host proxy config (`networksetup`), CA trust on host. All functions return `Effect<T, CommandError>`
- `src/eventBus.ts` — generic pub/sub for SSE events
- `src/models.ts` — TypeScript event and model types
- `src/rules.ts` — rule and view type definitions (`ScenarioFactory`, `ViewFactory`, etc.)
- `src/rulesLoader.ts` — scenario and view file loading from separate directories, hot-reload watching
- `src/errors.ts` — tagged error types (Effect-TS): `CommandError`, `RequestError`, `ProxyError`, `CertError`, `RulesLoadError`, `MitmBackendError`
- `src/config.ts` — user config (`~/.aproxy/config.json`) load/save, stores `defaultViewId`, `theme` and `maxRequests`
- `src/ui.html` — legacy single-page web UI (fallback if React build is missing)

### mitmproxy bridge (`python/`)

- `python/aproxy_addon.py` — mitmproxy addon loaded into `mitmdump`; forwards flows to the Bun control server over `/_mitm/*`

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
- `~/.aproxy/config.json` — user config (defaultViewId, theme, maxRequests)
- `~/.aproxy/scenarios/` — user scenario files (loaded at runtime)
- `~/.aproxy/views/` — user view files (loaded at runtime)
- `~/.aproxy/mitmproxy/` — mitmproxy confdir, seeded with the aproxy CA

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

**`mitmdump` does all the proxying.** aproxy owns the control plane only: a
plain `Bun.serve` (`createControlServer` in `src/server.ts`) on `PROXY_PORT`
that serves the UI, control API, SSE stream and the `/_mitm/*` bridge. It never
forwards traffic — an origin-form request that reaches it (a stale system proxy
setting, say) gets `421 Misdirected Request`, not a proxied response.

| | |
|---|---|
| Engine | supervised `mitmdump` subprocess + `python/aproxy_addon.py` |
| Control API | `PROXY_PORT` (8080) |
| Proxy | `APROXY_MITM_PORT` (9090) |
| Required install | `brew install mitmproxy` |

`mitmdump` discovery must not rely on `PATH` alone. A GUI-launched macOS app
inherits launchd's `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), which excludes
Homebrew — `Bun.which("mitmdump")` returns `null` inside the desktop app even
when the binary is installed. `FALLBACK_BINARY_PATHS` in `src/mitmBackend.ts`
exists for that case; don't remove it.

Because the proxy port is not the control port, **the UI must never hardcode
it**. `GET /host` returns `{ host, proxyPort, engineAvailable, engineError }`
and `POST /proxy/enable` ignores any client-supplied port, using
`deps.getProxyPort()` instead.

### When mitmproxy is unavailable

mitmproxy is a hard dependency, but a missing one must not stop the app from
launching — a desktop app that refuses to open gives the user nothing to act on.
`src/index.ts` records the reason in `engineError` and **still starts the
control server**, so the UI loads, explains the problem, and CA/simulator
management keeps working.

`engineStatus()` in `src/index.ts` derives availability from the live
subprocess rather than a boolean captured at startup, so a mitmdump that dies
mid-session is reported honestly instead of leaving the UI claiming traffic is
being captured.

It reads `mitmBackend.available`, **not** `mitmBackend.running` — the two are
different and the distinction is safety-critical:

| getter | meaning |
|---|---|
| `running` | the subprocess exists and has not exited |
| `available` | `running` **and** the addon has signalled `/_mitm/ready` |

mitmdump spends seconds booting Python before it binds, so `running` is true
for a window in which the proxy port refuses connections. Reporting
`engineAvailable: true` during that window let the UI enable the system proxy
against a dead port — the exact failure the 503 guard below exists to prevent.
This was a real bug; do not "simplify" `available` back to `running`.

`POST /proxy/enable` returns **503** whenever the engine is down. This is a
safety property, not a nicety: pointing macOS at a port nothing listens on takes
the user's network offline, which is far worse than simply not capturing
traffic.

### Readiness: why the port is not probed

`waitUntilReady()` waits for the addon to POST `/_mitm/ready` from mitmproxy's
`running` hook, which only fires once the listener is actually bound.

The obvious alternative — connecting to the proxy port — is **wrong**, and was
a real bug. A successful connect proves *something* is listening, not that it is
ours. When another process already holds the port, mitmdump logs a bind error
and exits, but the probe succeeds instantly against the squatter, so startup
reported "listening" for a proxy that was already dead. mitmdump spends seconds
booting Python before it even attempts to bind, so no settle delay closes the
race either.

The same "process is up ≠ port is up" reasoning is why `available` exists
separately from `running` (see the table above).

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PROXY_PORT` | `8080` | control API port |
| `APROXY_MITM_PORT` | `9090` | port `mitmdump` listens on |
| `APROXY_MITMDUMP` | auto-discovered | explicit path to the `mitmdump` binary |
| `APROXY_MITM_ADDON` | `python/aproxy_addon.py` | explicit path to the bridge addon (set by the Electrobun entry point, since the bundle layout differs) |
| `APROXY_SSL_INSECURE` | unset | `1` adds `--ssl-insecure`, for self-signed upstreams (benchmarks, local dev servers) |

### mitmproxy data flow

```
client ──▶ mitmdump :9090 (aproxy_addon.py)
                │  POST /_mitm/request   emits the request event, returns the rule decision
                │  POST /_mitm/response  emits the response event
                │  POST /_mitm/error | /_mitm/ws
                ▼
           Bun control server :8080 ──▶ SSE /events ──▶ React UI
                                    └─▶ RuleSandbox (unchanged TS rules)
```

- `/_mitm/ready` is posted once from mitmproxy's `running` hook and is the
  readiness signal the supervisor waits on (see above).
- `/_mitm/request` does double duty: it emits the `request` event **and** returns
  the rule decision (`{"mock": null}` or a `SerializedRuleResponse`). Folding
  both into one call keeps it to a single round-trip per request and guarantees
  the `request` event is emitted before the matching `response` event.
- All other events are queued onto a single background thread in the addon, so
  ordering is preserved without stalling mitmproxy's asyncio loop.
- The endpoints are loopback-only and gated on a per-run token
  (`X-Aproxy-Token`) generated at startup and passed to the addon via env.
- Bridge requests are handled before the `[incoming]` log line so they don't
  drown the control-request log.
- If the control server is unreachable the addon logs once and passes traffic
  through untouched — a broken bridge must never break browsing.

### Why the proxy port is 9090, not 8081

The obvious default (`PROXY_PORT + 1` = 8081) is **React Native Metro's default
port**. Binding it caused two problems on a normal iOS-development machine:

1. aproxy stole the port from Metro, breaking `react-native start`.
2. Every RN app on the host — including inside iOS simulators, which aproxy
   explicitly targets — polls `localhost:8081/inspector/device` roughly once a
   second. Those are origin-form requests addressed to the proxy itself, which
   mitmproxy cannot forward, so each poll produced a `request` event plus a
   "Request destination unknown" `error` event and swamped the UI.

`_is_self_addressed()` in the addon is the general defence: any request whose
destination is the proxy's own host:port is answered with `421 Misdirected
Request` and **not** reported as traffic (the flow is tagged
`aproxy_ignore`, which the `response` and `error` hooks honour). The addon logs
once per path so the cause is still discoverable. Requests to *other* localhost
ports proxy normally — only the proxy's own address is special-cased.

`LEGACY_MITM_PORTS` in `src/index.ts` keeps 8081 in the stale-proxy cleanup list
so upgrading from an older build never leaves the system proxy pointed at a port
nothing listens on.

### mitmproxy CA

`seedMitmConfdir()` writes the aproxy root CA (key + cert concatenated) to
`~/.aproxy/mitmproxy/mitmproxy-ca.pem` and passes `--set confdir=` to mitmdump.
mitmproxy derives its remaining cert files from that. This means a CA already
trusted on the host keychain or an iOS simulator keeps working when switching
backends — do not let mitmproxy generate its own CA.

### mitmproxy caveats

- **`stream_large_bodies=0` means "stream everything", not "disable streaming".**
  Setting it discards `flow.request.content` / `flow.response.content`, so
  bodies silently vanish from events. Leave the option unset.
- **`flow_detail=0` silences *all* mitmdump runtime logging**, including the
  stdlib `logging` bridge, regardless of `termlog_verbosity`. Startup errors
  still print. That's why the addon writes diagnostics straight to `sys.stderr`
  via `_log()` instead of using `logging`.
- **`from mitmproxy import http` shadows the stdlib `http` package.** Import
  submodules by name (`from http.client import HTTPConnection`), never
  `import http.client`.
- **The addon's stderr is a pipe to the supervisor, so it breaks when the
  supervisor dies.** `_log()` swallows exceptions for exactly this reason —
  an unguarded `print` raises `BrokenPipeError` and silently kills whichever
  thread called it (this defeated the shutdown watchdog on the first attempt).

### Keeping mitmdump from outliving aproxy

`mitmdump` is a child process holding the proxy port, and the system proxy
points at it. Orphaning it means the next launch can't bind the port and the
user's traffic goes to a proxy with no control server. Two independent
mechanisms prevent that, and **both are required**:

1. `installShutdownHandlers()` in `src/index.ts` calls `mitmBackend.stop()` from
   the signal handlers *and* from `process.on("exit")`, because Bun does not run
   signal handlers on a plain `process.exit()`.
2. `_watch_parent()` in the addon polls `os.getppid()` on a daemon thread and
   calls `os._exit(0)` once it reparents to launchd. This is the only thing that
   covers `SIGKILL`, a crash, or a host runtime that swallows signals — which
   Electrobun does: killing the packaged app's Bun process leaves JS handlers
   unrun, and mitmdump survived until the watchdog was added.

When touching shutdown, verify with `kill -9` on the parent, not just Ctrl-C.

### Desktop bundle packaging

Anything the Electrobun entry point resolves at runtime must be listed **twice**:

- in `build.copy` in `electrobun.config.ts` (used by `electrobun build`), and
- in `scripts/build-ui.ts` (used by `bun run desktop`)

Electrobun's `copy` config only runs on the *initial* build, so `electrobun dev`
silently keeps a stale bundle and never picks up newly-added copy entries. That
is why `scripts/build-ui.ts` hand-syncs `views/mainview`, `bun/ruleSandboxWorker.ts`
and `python/aproxy_addon.py`. Forgetting the second half means the app runs fine
from source and breaks only in the desktop build.

## MITM SSL interception

mitmproxy terminates TLS and issues per-host leaf certificates derived from
aproxy's root CA (see "mitmproxy CA"). Decrypted requests are reported through
the bridge, so HTTPS traffic goes through the same rule pipeline and appears in
the UI exactly like plain HTTP.

aproxy owns only the **root** CA (`src/ca.ts`: `ensureCa`, `getCaCertPath`,
`caExists`). Leaf-cert generation, caching, ALPN negotiation, HTTP/2, WebSocket
framing, backpressure and connection reuse are all mitmproxy's problem now —
that is the entire point of the migration, so do not reintroduce them here.

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

Chrome is stricter than Safari or curl about certificate validation. These two
CA problems still apply, because aproxy still owns the root CA.

Issues that used to live here — ALPN/HTTP-2 negotiation, double decompression
from `Content-Encoding`, response truncation from unhandled socket backpressure,
and the decrypted-HTTP parser state machine — were all defects in the
hand-rolled engine. They were removed with it and are mitmproxy's concern now.

### CA certificate missing keyUsage extensions

**Problem**: The original `generateCa()` in `src/ca.ts` used `openssl req -new -x509` without any X.509 extensions. The resulting CA certificate had no `basicConstraints` or `keyUsage` fields. Chrome's certificate validation requires `basicConstraints=CA:TRUE` and `keyUsage=keyCertSign` for a certificate to be accepted as a CA that can sign leaf certs.

**Symptom**: Chrome showed `ERR_CERT_AUTHORITY_INVALID` even after trusting the CA in the keychain. Safari was more lenient and accepted it.

**Fix**: Added `-addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -addext "subjectKeyIdentifier=hash"` flags to the `openssl req` command in `generateCa()`. After changing this, the old CA files at `~/.aproxy/` must be deleted so they are regenerated on next start.

### CA trust location and SSL policy (Chrome Root Store)

**Problem**: The original trust command (`security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain`) had two issues:
- It required `sudo` (admin privileges) to write to the system keychain
- It set generic trust, not SSL-specific trust. Chrome uses the Chrome Root Store and checks for explicit SSL trust policy

**Symptom**: Chrome showed `ERR_CERT_AUTHORITY_INVALID` even with the CA in the system keychain. The `security` command prompted for admin password via GUI dialog.

**Fix**: Changed `trustCaCertOnHost()` in `src/simulators.ts` to install trust in the **user login keychain** with explicit SSL trust policy:
```
security add-trusted-cert -r trustRoot -p ssl -k ~/Library/Keychains/login.keychain-db <cert>
```
The `-p ssl` flag sets unconditional SSL trust (not just "always trust"). Using the login keychain avoids admin privileges entirely. Chrome reads trusted certs from the login keychain reliably.

## Testing

- `bun test` runs the suite. Prefer lightweight, focused tests.
  - `src/mitmBackend.test.ts` — `mitmdump`/addon discovery, port selection, CA
    export into the confdir, the `/_mitm/*` bridge endpoints, and the
    engine-unavailable behaviour. **Does not require mitmproxy to be installed**
    — keep it that way so the suite runs anywhere.
- Smoke test (proxy is on 9090, control API stays on 8080):

  ```bash
  bun run start
  curl -x http://localhost:9090 http://httpbin.org/get
  curl --cacert ~/.aproxy/ca.pem -x http://localhost:9090 https://httpbin.org/get
  curl -sN http://localhost:8080/events    # request/response events should appear
  ```

  Rules only apply when the system proxy is enabled (`proxyEnabled`), so mock
  testing needs `POST /proxy/enable` first — remember to `POST /proxy/disable`
  afterwards. Note `PUT /scenarios/active` takes `{"scenarioId": "..."}` and
  **toggles**; it is not a set-all.

- Worth re-checking by hand after touching startup or shutdown, because none of
  it is covered by unit tests:

  | Scenario | Expected |
  |---|---|
  | `APROXY_MITMDUMP=/nonexistent bun run start` | app starts, `/host` reports `engineAvailable:false`, `POST /proxy/enable` → 503 |
  | proxy port already taken | startup reports the failure; must **not** claim "listening" |
  | `kill -9` the parent | no orphaned `mitmdump` (`lsof -ti :9090` is empty) |
  | request to the control port with an absolute URL | `421`, and **no** SSE event |

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

The script uses `lvh.me` as the target hostname (resolves to `127.0.0.1`) because
requests addressed to the proxy's own host:port are rejected with `421` rather
than forwarded. Load is driven at `APROXY_MITM_PORT` (9090) while the SSE reader
connects to the control port (8080) — they are different servers. In HTTPS mode
it generates a temporary self-signed cert for the upstream and sets
`APROXY_SSL_INSECURE=1`, which adds `--ssl-insecure` to mitmdump.

`waitForProxy()` polls `GET /host` until `engineAvailable` is true, not merely
until the control server answers: the control server is up well before mitmdump
finishes binding.

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

### Code signing and notarization

Signing is **driven entirely by the environment** — `electrobun.config.ts`
derives `mac.codesign` / `mac.notarize` from the presence of credentials rather
than hardcoding them:

| Env vars present | Result |
|---|---|
| none | unsigned build, warning printed, DMG still produced |
| `ELECTROBUN_DEVELOPER_ID` | signed, not notarized |
| + `ELECTROBUN_APPLEID`, `ELECTROBUN_APPLEIDPASS`, `ELECTROBUN_TEAMID` | signed and notarized |

Do not set `codesign: true` unconditionally. Electrobun aborts the whole build
with "Env var ELECTROBUN_DEVELOPER_ID is required to codesign" when the identity
is missing, which breaks `bun run desktop:build` for anyone without an Apple
Developer account. Notarization also requires signing — electrobun computes
`shouldNotarize = shouldCodesign && config.build.mac.notarize` — so partial
credentials degrade to signed-but-not-notarized rather than failing.

**Installing unsigned builds:** Gatekeeper shows "damaged" or "unidentified
developer". After copying the app out of the DMG:

```bash
xattr -cr /Applications/Aproxy.app
```

**To produce signed builds** (requires an Apple Developer Program membership):

**1. Get a signing certificate:**
- Enroll at https://developer.apple.com/programs/
- In the Developer portal (Certificates, IDs & Profiles), create a "Developer ID Application" certificate
- Or in Xcode: Settings > Accounts > Manage Certificates > "+" > Developer ID Application
- Verify it's installed: `security find-identity -v -p codesigning` should show `"Developer ID Application: Your Name (TEAMID)"`

**2. Export it and set the env vars** — no config change is needed; the build
picks them up automatically.

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

**5. `.github/workflows/build.yml` already imports the certificate into a
temporary keychain and passes these env vars through** — no workflow change is
needed. With the secrets unset it still produces an unsigned DMG rather than
failing, because signing is env-driven.

## Pull request / commit guidance

- Do not create git commits unless the user asks.
- Do not run destructive git commands.
