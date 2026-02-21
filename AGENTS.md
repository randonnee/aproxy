# AI Agent Guide

This file describes how AI agents should work in this repository.

## Project goal

Build a macOS proxying tool (like Proxyman/Charles) with a Bun-based core that can:

- Proxy HTTP traffic initially
- Emit structured events for a UI
- Later support HTTPS MITM, certificate install, and iOS simulator proxy config

## Repo layout (initial)

- `src/index.ts` core proxy + event stream server
- `README.md` usage and port info

## Development constraints

- Prefer minimal, focused changes per step.
- Do not add UI frameworks yet; keep UI work to a simple event listener when requested.
- Avoid adding dependencies unless they are clearly necessary.

## Event stream contract

SSE endpoint: `GET /events` on the control server.

Events use `event:` field with a JSON `data:` payload.

Current event types:

- `request`
- `response`
- `error`

Keep this contract stable unless the user explicitly asks to change it.

## When adding features

- For HTTPS: add `CONNECT` tunneling first, then MITM interception.
- For certificates: implement generation, local trust install, and simulator trust install.
- For simulator proxy config: use Xcode CLI tooling; keep the steps scripted.

## Testing

- There are no tests yet; if adding, prefer lightweight smoke tests.

## Pull request / commit guidance

- Do not create git commits unless the user asks.
- Do not run destructive git commands.
