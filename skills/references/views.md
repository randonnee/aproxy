# Aproxy Views Reference

Views are client-side filter predicates that control which requests appear in the Aproxy web UI. They do **not** affect proxy behavior, rule evaluation, or traffic interception -- they are purely a display concern.

## File Structure

A view file exports a `views` array of factory functions:

```typescript
// ~/.aproxy/views/my-view.ts

export const views = [
  () => ({
    id: "unique-view-id",
    name: "Human Readable Name",
    description: "Optional description shown in the UI",
    filter: (ctx) => {
      // Return true to INCLUDE the request in the list
      // Return false to HIDE it
      return true;
    },
  }),
];
```

## Types

```typescript
type ViewContext = {
  id: string;                              // Unique request ID
  url: string;                             // Full request URL
  method: string;                          // HTTP method (GET, POST, etc.)
  headers: Record<string, string>;         // Request headers (lowercase keys)
  status?: number;                         // Response status code (undefined if no response yet)
  responseHeaders?: Record<string, string>; // Response headers (undefined if no response yet)
  durationMs?: number;                     // Round-trip time in milliseconds (undefined if pending)
  mocked?: boolean;                        // True if the response was mocked by a scenario rule
};

type ViewFilter = (context: ViewContext) => boolean;

type ViewInstance = {
  id: string;           // Unique view identifier
  name: string;         // Display name in UI sidebar
  description?: string; // Description text
  filter: ViewFilter;   // The filter predicate
};

type ViewFactory = () => ViewInstance;
```

## How Views Work

1. View files are loaded from `~/.aproxy/views/` at startup and hot-reloaded on changes.
2. The `filter` function is serialized via `.toString()` and sent to the browser client as a string.
3. The UI compiles it with `new Function("return (" + view.filter + ")")()`.
4. For each request in the list, the compiled filter is called. If it returns `true`, the request is shown; if `false`, it is hidden.
5. If compilation or execution fails, the filter is skipped and the request is included (fail-open).
6. Only one view can be active at a time. Users select views from the UI sidebar.

### Important Constraint

Because the filter function is serialized via `.toString()` and evaluated in the browser, it **cannot** reference any variables, imports, or closures from the file scope. The filter must be entirely self-contained. Only the `ctx` parameter is available at runtime.

```typescript
// GOOD -- self-contained
filter: (ctx) => ctx.status !== undefined && ctx.status >= 400

// BAD -- references outer scope variable (will fail in browser)
const threshold = 400;
filter: (ctx) => ctx.status !== undefined && ctx.status >= threshold
```

## Writing Filters

### Filter by status code

```typescript
// Errors only (4xx and 5xx)
filter: (ctx) => (ctx.status ?? 0) >= 400

// Successful responses only
filter: (ctx) => ctx.status !== undefined && ctx.status >= 200 && ctx.status < 300

// Redirects only
filter: (ctx) => ctx.status !== undefined && ctx.status >= 300 && ctx.status < 400
```

### Filter by domain

```typescript
// Only requests to a specific API
filter: (ctx) => /api\.example\.com/.test(ctx.url)

// Exclude requests to analytics/tracking
filter: (ctx) => !/google-analytics\.com|segment\.io|mixpanel\.com/.test(ctx.url)
```

### Filter by HTTP method

```typescript
// Only mutations (non-GET requests)
filter: (ctx) => ctx.method !== "GET"

// Only GET requests
filter: (ctx) => ctx.method === "GET"
```

### Filter by path

```typescript
// Only API endpoints (not static assets)
filter: (ctx) => /\/api\//.test(ctx.url)

// Exclude image/font/CSS requests
filter: (ctx) => !/\.(png|jpg|gif|svg|woff2?|css|ico)(\?|$)/.test(ctx.url)
```

### Filter by response time (slow requests)

```typescript
// Requests taking more than 1 second
filter: (ctx) => ctx.durationMs !== undefined && ctx.durationMs > 1000
```

### Filter by mocked status

```typescript
// Only show mocked responses (from active scenario)
filter: (ctx) => ctx.mocked === true

// Only show real (non-mocked) responses
filter: (ctx) => ctx.mocked !== true
```

### Filter by request headers

```typescript
// Only requests with a specific auth header
filter: (ctx) => "authorization" in ctx.headers

// Only JSON requests
filter: (ctx) => (ctx.headers["content-type"] ?? "").includes("application/json")
```

### Filter by response headers

```typescript
// Only responses with caching headers
filter: (ctx) =>
  ctx.responseHeaders !== undefined &&
  ("cache-control" in ctx.responseHeaders || "etag" in ctx.responseHeaders)
```

### Combined filters

```typescript
// API errors: POST/PUT/DELETE to /api/ that returned 4xx/5xx
filter: (ctx) =>
  ctx.method !== "GET" &&
  /\/api\//.test(ctx.url) &&
  (ctx.status ?? 0) >= 400
```

## Multiple Views in One File

A single file can export multiple view factories:

```typescript
export const views = [
  () => ({
    id: "errors-only",
    name: "Errors Only",
    description: "Show only 4xx and 5xx responses",
    filter: (ctx) => (ctx.status ?? 0) >= 400,
  }),
  () => ({
    id: "slow-requests",
    name: "Slow Requests",
    description: "Requests taking over 1 second",
    filter: (ctx) => ctx.durationMs !== undefined && ctx.durationMs > 1000,
  }),
  () => ({
    id: "api-only",
    name: "API Only",
    description: "Hide static asset requests",
    filter: (ctx) => !/\.(png|jpg|gif|svg|woff2?|css|js|ico)(\?|$)/.test(ctx.url),
  }),
];
```

## Full Working Example

```typescript
// ~/.aproxy/views/development-filters.ts

export const views = [
  () => ({
    id: "my-app-api",
    name: "My App API",
    description: "Only requests to myapp.example.com API endpoints",
    filter: (ctx) =>
      /myapp\.example\.com\/api\//.test(ctx.url),
  }),
  () => ({
    id: "failed-requests",
    name: "Failed Requests",
    description: "Requests that errored or returned 4xx/5xx",
    filter: (ctx) =>
      ctx.status === undefined || ctx.status >= 400,
  }),
  () => ({
    id: "exclude-noise",
    name: "Exclude Noise",
    description: "Hide analytics, fonts, images, and other noise",
    filter: (ctx) =>
      !/google-analytics\.com|fonts\.googleapis\.com|\.woff2?(\?|$)|\.png(\?|$)|\.jpg(\?|$)/.test(ctx.url),
  }),
];
```

## Default View

Users can set a default view from the UI sidebar. The default view ID is persisted in `~/.aproxy/config.json` and automatically applied when the UI loads. This is managed through the UI, not in the view file itself.

## Checklist

When writing a view, verify:

- [ ] File is saved to `~/.aproxy/views/` with a `.ts` extension
- [ ] File exports `views` (not `default`, not `filters`) as an array of factory functions
- [ ] Each view has a unique `id` and a `name`
- [ ] The `filter` function is self-contained (no references to outer scope variables or imports)
- [ ] The `filter` function returns a boolean (`true` to include, `false` to hide)
- [ ] Optional fields like `ctx.status`, `ctx.durationMs`, `ctx.responseHeaders`, and `ctx.mocked` are handled safely (they may be `undefined` for pending requests)
- [ ] Regex patterns in filters are correct and don't accidentally match/exclude too broadly
