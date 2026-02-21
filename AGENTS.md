# AI Agent Guide

This file describes how AI agents should work in this repository.

## Project goal

Build a macOS proxying tool (like Proxyman/Charles) with a Bun-based core that can:

- Proxy HTTP traffic
- Tunnel HTTPS via CONNECT (blind TCP pipe, no decryption yet)
- Emit structured events for a web UI
- Configure the host macOS proxy via `networksetup`
- Manage iOS simulator certificate trust

## Repo layout

- `src/index.ts` — entry point, wires dependencies together
- `src/tcpProxy.ts` — raw TCP listener (`Bun.listen`), HTTP request parsing, CONNECT detection and dispatch
- `src/tunnel.ts` — CONNECT tunnel handler, bidirectional TCP piping via `Bun.connect`
- `src/server.ts` — route definitions (control API + proxy dispatch), `createServer` wraps `createTcpProxy`
- `src/proxy.ts` — HTTP proxy forwarding logic with rule evaluation
- `src/http.ts` — SSE stream creation, hop-by-hop header stripping, header utilities
- `src/simulators.ts` — iOS simulator listing, cert install, host proxy config (`networksetup`)
- `src/eventBus.ts` — generic pub/sub for SSE events
- `src/models.ts` — TypeScript event and model types
- `src/rules.ts` — rule type definitions
- `src/rulesLoader.ts` — rule file loading and hot-reload watching
- `src/errors.ts` — tagged error types (Effect-TS)
- `src/ui.html` — single-page web UI
- `rules/` — user-defined scenario/rule files

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

Keep this contract stable unless the user explicitly asks to change it.

## Server architecture

The server uses a **raw TCP listener** (`Bun.listen` in `src/tcpProxy.ts`) on a single port. Incoming connections go through a state machine:

1. **Parsing** — accumulate bytes until full HTTP headers arrive
2. **CONNECT** — switch to tunnel mode, pipe TCP bidirectionally via `src/tunnel.ts`
3. **HTTP** — construct a `Request` object, pass to the Effect-based route handler, serialize the `Response` back as raw HTTP

This design was chosen because `Bun.serve` does not expose raw sockets, which are required for CONNECT tunneling.

## Proxy configuration

Proxy settings are applied to the **host macOS machine** via `networksetup` (not inside the iOS simulator). The proxy is a global system setting that affects all traffic on the active network interface.

API endpoints: `POST /proxy/enable`, `POST /proxy/disable`, `GET /proxy/status`.

## When adding features

- For HTTPS MITM: the CONNECT tunnel is in place; next step is to intercept the TLS handshake using a generated CA certificate, terminate TLS, inspect/modify traffic, and re-encrypt to upstream.
- For certificates: implement CA key/cert generation, local trust install (`security add-trusted-cert`), and simulator trust install.
- For simulator proxy config: proxy is already host-level via `networksetup`; no per-simulator config needed.

## Testing

- There are no tests yet; if adding, prefer lightweight smoke tests.
- Quick manual smoke test: `curl -x http://localhost:8080 https://httpbin.org/get`

## Pull request / commit guidance

- Do not create git commits unless the user asks.
- Do not run destructive git commands.
