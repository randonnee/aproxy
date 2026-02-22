# Aproxy Scenarios Reference

Scenarios are proxy interception rules that can mock HTTP/HTTPS responses. They are the core mechanism for intercepting and modifying traffic flowing through the Aproxy proxy.

## File Structure

A scenario file exports a `scenarios` array of factory functions:

```typescript
// ~/.aproxy/scenarios/my-scenario.ts

export const scenarios = [
  () => ({
    id: "unique-scenario-id",
    name: "Human Readable Name",
    description: "Optional description shown in the UI",
    rules: [
      {
        id: "unique-rule-id",
        name: "Rule Name",
        description: "Optional rule description",
        handle: (context) => {
          // Return Response to mock, or null to pass through
          return null;
        },
      },
    ],
  }),
];
```

## Types

```typescript
type RuleContext = {
  id: string;                        // Unique request ID
  url: string;                       // Full request URL (e.g., "https://api.example.com/users")
  method: string;                    // HTTP method (GET, POST, PUT, DELETE, etc.)
  headers: Record<string, string>;   // Request headers (lowercase keys)
};

type RuleHandler = (context: RuleContext) => Response | null | Promise<Response | null>;

type RuleInstance = {
  id: string;           // Unique rule identifier
  name?: string;        // Display name in UI
  description?: string; // Tooltip description in UI
  handle: RuleHandler;  // The interception function
};

type ProxyScenario = {
  id: string;           // Unique scenario identifier
  name: string;         // Display name in UI
  description?: string; // Description shown in UI
  rules: RuleInstance[];
};

type ScenarioFactory = () => ProxyScenario;
```

## How Rules Work

1. When a request arrives, Aproxy iterates through the active scenario's rules in order.
2. Each rule's `handle` function is called with the request context.
3. If `handle` returns a `Response`, that response is sent back to the client (the request is **mocked** and never reaches the upstream server).
4. If `handle` returns `null`, the next rule is tried.
5. If no rule returns a `Response`, the request is forwarded to the upstream server normally.
6. Only one scenario can be active at a time. The user activates scenarios from the UI sidebar.

## Writing Handlers

### Basic pattern: URL matching + mock response

```typescript
handle: (context) => {
  // Always check if the request matches your target
  if (!/api\.example\.com\/users/.test(context.url)) return null;

  // Return a mock Response
  return new Response(
    JSON.stringify({ users: [{ id: 1, name: "Test User" }] }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
},
```

### Check HTTP method

```typescript
handle: (context) => {
  if (context.method !== "POST") return null;
  if (!/api\.example\.com\/login/.test(context.url)) return null;

  return new Response(
    JSON.stringify({ token: "mock-jwt-token", expiresIn: 3600 }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
},
```

### Simulate errors

```typescript
handle: (context) => {
  if (!/api\.example\.com\/flaky-endpoint/.test(context.url)) return null;

  return new Response(
    JSON.stringify({ error: "Internal Server Error" }),
    { status: 500, headers: { "content-type": "application/json" } }
  );
},
```

### Simulate latency

```typescript
handle: async (context) => {
  if (!/api\.example\.com\/slow/.test(context.url)) return null;

  // Simulate 2 second network delay
  await new Promise((resolve) => setTimeout(resolve, 2000));

  return new Response(
    JSON.stringify({ data: "delayed response" }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
},
```

### Stateful mock (using closure)

```typescript
export const scenarios = [
  () => {
    // Closure state -- persists across requests while the scenario is active
    let requestCount = 0;
    const store: Record<string, any> = {};

    return {
      id: "stateful-api",
      name: "Stateful API Mock",
      rules: [
        {
          id: "create-item",
          name: "Create item",
          handle: (context) => {
            if (context.method !== "POST") return null;
            if (!/api\.example\.com\/items/.test(context.url)) return null;

            const id = ++requestCount;
            store[id] = { id, name: `Item ${id}`, createdAt: Date.now() };

            return new Response(JSON.stringify(store[id]), {
              status: 201,
              headers: { "content-type": "application/json" },
            });
          },
        },
        {
          id: "list-items",
          name: "List items",
          handle: (context) => {
            if (context.method !== "GET") return null;
            if (!/api\.example\.com\/items$/.test(context.url)) return null;

            return new Response(JSON.stringify(Object.values(store)), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          },
        },
      ],
    };
  },
];
```

### Conditional mock (e.g., mock only specific headers)

```typescript
handle: (context) => {
  if (!/api\.example\.com/.test(context.url)) return null;

  // Only mock if a specific header is present
  if (context.headers["x-mock"] !== "true") return null;

  return new Response(
    JSON.stringify({ mocked: true }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
},
```

### Multiple scenarios in one file

A file can export multiple scenario factories. Each becomes a separate selectable scenario in the UI:

```typescript
export const scenarios = [
  () => ({
    id: "happy-path",
    name: "Happy Path",
    description: "All API calls succeed",
    rules: [
      /* ... success mocks ... */
    ],
  }),
  () => ({
    id: "error-path",
    name: "Error Path",
    description: "All API calls return 500",
    rules: [
      /* ... error mocks ... */
    ],
  }),
];
```

## Full Working Example

```typescript
// ~/.aproxy/scenarios/mock-payments.ts

export const scenarios = [
  () => {
    let nextId = 1000;

    return {
      id: "mock-payments",
      name: "Mock Payment API",
      description: "Mocks the Stripe-like payment API for local development",
      rules: [
        {
          id: "create-charge",
          name: "Create charge",
          description: "POST /v1/charges returns a successful charge",
          handle: async (context) => {
            if (context.method !== "POST") return null;
            if (!/payments\.example\.com\/v1\/charges/.test(context.url)) return null;

            await new Promise((r) => setTimeout(r, 300));
            const id = `ch_${++nextId}`;

            return new Response(
              JSON.stringify({
                id,
                status: "succeeded",
                amount: 2000,
                currency: "usd",
                created: Math.floor(Date.now() / 1000),
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          },
        },
        {
          id: "get-charge",
          name: "Get charge",
          description: "GET /v1/charges/:id returns charge details",
          handle: (context) => {
            if (context.method !== "GET") return null;
            const match = context.url.match(/payments\.example\.com\/v1\/charges\/(ch_\w+)/);
            if (!match) return null;

            return new Response(
              JSON.stringify({
                id: match[1],
                status: "succeeded",
                amount: 2000,
                currency: "usd",
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          },
        },
        {
          id: "list-charges",
          name: "List charges",
          description: "GET /v1/charges returns an empty list",
          handle: (context) => {
            if (context.method !== "GET") return null;
            if (!/payments\.example\.com\/v1\/charges$/.test(context.url)) return null;

            return new Response(
              JSON.stringify({ data: [], has_more: false }),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          },
        },
      ],
    };
  },
];
```

## Checklist

When writing a scenario, verify:

- [ ] File is saved to `~/.aproxy/scenarios/` with a `.ts` extension
- [ ] File exports `scenarios` (not `default`, not `rules`) as an array of factory functions
- [ ] Each scenario has a unique `id` and a `name`
- [ ] Each rule has a unique `id`
- [ ] Each `handle` function returns `null` for non-matching requests
- [ ] JSON responses include `"content-type": "application/json"` header
- [ ] Async handlers (with latency) use `async`/`await` properly
- [ ] URL matching uses regex or string checks that are specific enough to avoid false matches
