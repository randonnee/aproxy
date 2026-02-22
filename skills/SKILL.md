---
name: aproxy
description: Write proxy scenarios and views for Aproxy, a macOS HTTP/HTTPS intercepting proxy. Use this skill when the user asks to create, modify, or debug proxy scenarios (mock responses, intercept requests) or views (filter predicates for the request list). Handles file creation in the correct directories with proper types.
references:
  - scenarios
  - views
---

# Aproxy Scenarios & Views Skill

This skill guides creation of **proxy scenarios** (rules that intercept and mock HTTP responses) and **views** (client-side filter predicates that control which requests appear in the UI) for the Aproxy macOS proxy tool.

## Quick Decision Tree

```
User wants to...
├─ Mock/intercept HTTP responses → Create a SCENARIO (load `scenarios` reference)
├─ Simulate latency or errors   → Create a SCENARIO (load `scenarios` reference)
├─ Filter which requests show   → Create a VIEW (load `views` reference)
├─ Both mock and filter          → Create both (load both references)
```

## Key Concepts

- **Scenarios** contain **rules**. A scenario groups related rules together (e.g., "Mock Payment API"). Each rule has a `handle` function that receives request context and returns a `Response` (to mock) or `null` (to pass through).
- **Views** define **filters**. A view has a `filter` function that receives request+response context and returns `true` to include a request in the UI list, `false` to hide it.
- Scenarios affect proxy behavior (they intercept traffic). Views are purely a display concern (they don't affect traffic).

## File Locations

All files go in the user's `~/.aproxy/` directory:

- **Scenarios**: `~/.aproxy/scenarios/<name>.ts`
- **Views**: `~/.aproxy/views/<name>.ts`

These directories are auto-created by Aproxy on first run. Files are `.ts` or `.js` and are dynamically imported at runtime. Changes are hot-reloaded automatically.

## Workflow

1. **Identify** whether the user needs a scenario, a view, or both.
2. **Load the appropriate reference** (`scenarios` or `views`) for detailed type information and patterns.
3. **Write the file** to the correct `~/.aproxy/` subdirectory.
4. **Verify** by checking the file was written correctly. Aproxy will hot-reload it automatically.

## Type Import Path

Scenario and view files import types from the Aproxy source relative to where they are installed. Since files in `~/.aproxy/scenarios/` and `~/.aproxy/views/` are loaded by the Aproxy runtime via dynamic import, types can be used inline without explicit imports if preferred, or imported from the Aproxy installation if the path is known.

The simplest approach is to use inline type annotations without imports, since the runtime only cares about the exported `scenarios` or `views` array, not the type imports.

## Common Patterns

### Scenario: URL pattern matching
Rules typically match requests by testing `context.url` with a regex or string check, and optionally checking `context.method`. Return `null` for non-matching requests to let them pass through.

### Scenario: Simulated latency
Use `async` handlers with `await new Promise(r => setTimeout(r, ms))` before returning the mock response.

### Scenario: Stateful mocks
Use closure variables in the factory function to maintain state across requests (e.g., incrementing counters, toggling responses).

### View: Status code filters
Filter on `ctx.status` to show only errors, successes, redirects, etc.

### View: Domain filters
Filter on `ctx.url` to show only requests to specific hosts or paths.

### View: Combined filters
Combine multiple conditions (method, status, URL pattern, duration) for precise filtering.
