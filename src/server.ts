import type { RulesListEvent, ViewsListEvent, SimulatorInfo, ProxyEvent } from "./models";
import type { AproxyConfig } from "./config";
import type { SerializedRuleResponse } from "./ruleSandboxTypes";
import { Effect } from "effect";
import { networkInterfaces } from "node:os";
import { existsSync, readFileSync, readdirSync, copyFileSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { CommandError, RequestError } from "./errors";
import { createSseStream, parseJsonBody } from "./http";

// Resolve UI dist directory (built React app) for standalone mode.
// In the Electrobun desktop build, the view is loaded via views:// protocol
// and the UI is not served by the backend.
const uiDistDir = process.env.APROXY_UI_DIR ?? join(import.meta.dir, "..", "ui", "dist");
const uiIndexPath = join(uiDistDir, "index.html");
const uiFallbackPath = join(import.meta.dir, "ui.html");

// Resolve bundled examples directory
// APROXY_EXAMPLES_DIR: set by Electrobun entry to point at bundled examples.
const examplesDir = process.env.APROXY_EXAMPLES_DIR ?? join(import.meta.dir, "..", "examples");

// CORS origin allowlist.  Cross-origin requests are only expected from the
// Electrobun desktop app (views:// protocol) and, during development, the Vite
// HMR dev server.  Everything else (standalone browser mode) is same-origin and
// doesn't need CORS headers at all.
const ALLOWED_ORIGINS = new Set([
  "views://mainview",              // Electrobun production build
  // Dev-only: allow Vite HMR dev server origins
  ...(process.env.NODE_ENV !== "production" ? [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ] : []),
]);

/** Build CORS headers for the given request, or null if the origin is not allowed. */
function corsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;                       // same-origin / no CORS needed
  if (!ALLOWED_ORIGINS.has(origin)) return null;  // unknown origin — deny CORS
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

/** Append CORS headers to an existing Response (if the origin is allowed). */
function withCors(res: Response, req: Request): Response {
  const headers = corsHeaders(req);
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      res.headers.set(k, v);
    }
  }
  return res;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const listLocalHosts = () => {
  const hosts = new Set<string>(["localhost", "127.0.0.1"]);
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address && entry.address !== "0.0.0.0") hosts.add(entry.address);
    }
  }
  return hosts;
};

const getPreferredHost = () => {
  const bound = process.env.HOST ?? "127.0.0.1";
  // If the server binds to a specific address (not all interfaces), that's
  // the address clients should use — return it directly.
  if (bound !== "0.0.0.0") return bound;
  // Bound to all interfaces — pick the first LAN IPv4 address so that
  // networksetup configures the system proxy to an address that works.
  for (const host of listLocalHosts()) {
    if (host !== "localhost" && host !== "127.0.0.1") return host;
  }
  return "127.0.0.1";
};

/**
 * Create the control-plane HTTP server used when the proxying itself is handled
 * by an external engine (mitmproxy). This serves the UI, the control API, the
 * SSE stream and the `/_mitm/*` bridge endpoints — but never proxies traffic,
 * so a plain `Bun.serve` is enough (no raw sockets / CONNECT support needed).
 */
export function createControlServer(
  routes: (req: Request) => Effect.Effect<Response, never>,
  options: { hostname: string; port: number }
) {
  return Effect.try(() =>
    Bun.serve({
      hostname: options.hostname,
      port: options.port,
      // SSE clients are long-lived; the 1s heartbeat keeps them under this cap.
      idleTimeout: 60,
      fetch: (req) => Effect.runPromise(routes(req)),
    })
  ).pipe(Effect.mapError((cause) => new RequestError({ cause })));
}

/**
 * Health of the mitmproxy engine, surfaced to the UI so a missing `mitmdump`
 * shows up as an actionable message instead of a proxy that silently does
 * nothing.
 */
export type EngineStatus = {
  /** True once `mitmdump` is listening and ready to accept traffic. */
  engineAvailable: boolean;
  /** Human-readable reason the engine is unavailable, if it is. */
  engineError: string | null;
};

/** Bridge callbacks used by the mitmproxy backend's `/_mitm/*` endpoints. */
export type MitmBridge = {
  /** Shared secret the addon must present in `X-Aproxy-Token`. */
  token: string;
  emitEvent: (event: ProxyEvent) => void;
  /** Evaluate the active rules and return a mock response, if any. */
  applyRuleMock: (context: {
    id: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) => Effect.Effect<SerializedRuleResponse | null, unknown>;
  /**
   * Called when the addon reports that mitmproxy's listener is bound. This is
   * the only trustworthy readiness signal — probing the port cannot distinguish
   * our listener from an unrelated process already holding it.
   */
  onEngineReady: () => void;
};

export function createRoutes(
  deps: {
    listRulesEvent: () => RulesListEvent;
    listViewsEvent: () => ViewsListEvent;
    loadRules: () => Effect.Effect<void, RequestError | unknown>;
    scenariosDir: string;
    viewsDir: string;
    createSse: (signal: AbortSignal) => ReadableStream<string>;
    getScenarios: () => Array<{ id: string; name: string; description?: string; rules: Array<{ id: string; name?: string; description?: string }> }>;
    getActiveScenarioIds: () => string[];
    setActiveScenarioIds: (ids: string[]) => void;
    getViews: () => Array<{ id: string; name: string; description?: string; filter: string }>;
    getConfig: () => AproxyConfig;
    updateConfig: (patch: Partial<AproxyConfig>) => void;
    enableProxy: (input: {
      proxyHost: string;
      proxyPort: number;
    }) => Effect.Effect<{ networkService: string; proxyHost: string; proxyPort: number; enabled: boolean }, CommandError>;
    disableProxy: () => Effect.Effect<{ networkService: string; enabled: boolean }, CommandError>;
    proxyStatus: () => Effect.Effect<{
      settings: Record<string, string>;
      raw: string;
      networkService: string;
      enabled: boolean;
    }, CommandError>;
    listSimulators: () => Effect.Effect<SimulatorInfo[], CommandError>;
    installSimulatorCert: (input: { udid: string; certPath: string }) => Effect.Effect<SimulatorInfo, CommandError>;
    getCaCertPem: () => string | null;
    getCaCertPath: () => string | null;
    trustCaOnHost: () => Effect.Effect<{ trusted: boolean; certPath: string }, CommandError>;
    isCaTrusted: () => Effect.Effect<boolean, never>;
    installCaOnSimulator: (udid: string) => Effect.Effect<SimulatorInfo, CommandError>;
    /** Port clients should point their proxy settings at. */
    getProxyPort: () => number;
    /** Whether the mitmproxy engine is running, and why not if it isn't. */
    getEngineStatus: () => EngineStatus;
    bridge?: MitmBridge;
  }
) {
  const controlHosts = listLocalHosts();
  return (req: Request) => {
    let _isControlRequest = false;
    return Effect.gen(function* (_) {
      const hostHeader = req.headers.get("host") ?? "";
      const hostOnly = hostHeader.replace(/^\[/, "").split(":")[0].replace(/\]$/, "");
      const isControlHost = controlHosts.has(hostOnly);
      const url = (() => {
        try {
          return new URL(req.url);
        } catch {
          if (hostHeader) {
            try {
              return new URL(req.url, `http://${hostHeader}`);
            } catch {
              return null;
            }
          }
          return null;
        }
      })();
      const urlHost = url?.hostname ?? "";
      const isControlRequest = isControlHost && controlHosts.has(urlHost || hostOnly);
      _isControlRequest = isControlRequest;

      // --- mitmproxy bridge (loopback only, token-gated) ---
      // Handled before logging: these fire once or twice per proxied request
      // and would otherwise drown the incoming-request log.
      if (isControlRequest && url?.pathname.startsWith("/_mitm/") && req.method === "POST") {
        const bridge = deps.bridge;
        if (!bridge) return new Response("Bridge disabled", { status: 404 });
        if (req.headers.get("x-aproxy-token") !== bridge.token) {
          return new Response("Forbidden", { status: 403 });
        }

        const payload = yield* _(
          parseJsonBody<any>(req).pipe(Effect.mapError((cause) => new RequestError({ cause })))
        );

        if (url.pathname === "/_mitm/ready") {
          bridge.onEngineReady();
          return new Response(null, { status: 204 });
        }

        if (url.pathname === "/_mitm/request") {
          bridge.emitEvent(payload as ProxyEvent);
          const mock = yield* _(
            bridge.applyRuleMock({
              id: payload.id,
              url: payload.url,
              method: payload.method,
              headers: payload.headers ?? {},
              body: payload.body,
            }).pipe(
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  console.error(`[mitm bridge] rule evaluation failed: ${String(error)}`);
                  return null;
                })
              )
            )
          );
          return Response.json({ mock });
        }

        // response / error / ws are fire-and-forget event forwards
        bridge.emitEvent(payload as ProxyEvent);
        return new Response(null, { status: 204 });
      }

      yield* _(
        Effect.sync(() =>
          console.log(
            `[incoming] ${req.method} ${req.url} host=${hostHeader} control=${isControlRequest} urlHost=${urlHost || ""}`
          )
        )
      );

      // Handle CORS preflight requests for cross-origin API access
      if (isControlRequest && req.method === "OPTIONS") {
        const headers = corsHeaders(req);
        return new Response(null, { status: 204, headers: headers ?? {} });
      }

      if (isControlRequest && url?.pathname === "/events" && req.method === "GET") {
        const stream = deps.createSse(req.signal);
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          }
        });
      }

      if (isControlRequest && url?.pathname === "/" && req.method === "GET") {
        const html = existsSync(uiIndexPath)
          ? readFileSync(uiIndexPath, "utf-8")
          : readFileSync(uiFallbackPath, "utf-8");
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8"
          }
        });
      }

      if (isControlRequest && url?.pathname === "/host" && req.method === "GET") {
        return Response.json({
          host: getPreferredHost(),
          proxyPort: deps.getProxyPort(),
          ...deps.getEngineStatus(),
        });
      }

      if (isControlRequest && url?.pathname === "/scenarios" && req.method === "GET") {
        return Response.json({
          scenarios: deps.getScenarios(),
          activeScenarioIds: deps.getActiveScenarioIds()
        });
      }

      if (isControlRequest && url?.pathname === "/scenarios/active" && req.method === "PUT") {
        const body = yield* _(
          parseJsonBody<{ scenarioId: string }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        const current = deps.getActiveScenarioIds();
        const id = body.scenarioId;
        if (id) {
          // Toggle: add if missing, remove if present
          const next = current.includes(id)
            ? current.filter((s) => s !== id)
            : [...current, id];
          deps.setActiveScenarioIds(next);
        } else {
          // Clear all
          deps.setActiveScenarioIds([]);
        }
        return Response.json({
          scenarios: deps.getScenarios(),
          activeScenarioIds: deps.getActiveScenarioIds()
        });
      }

      if (isControlRequest && url?.pathname === "/rules" && req.method === "GET") {
        return Response.json(deps.listRulesEvent());
      }

      if (isControlRequest && url?.pathname === "/rules/reload" && req.method === "POST") {
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json(deps.listRulesEvent());
      }

      // --- File import: upload a file to scenarios or views directory ---
      if (isControlRequest && url?.pathname === "/scenarios/import" && req.method === "POST") {
        const body = yield* _(
          parseJsonBody<{ filename: string; content: string }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        const safeName = basename(body.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
        if (!existsSync(deps.scenariosDir)) mkdirSync(deps.scenariosDir, { recursive: true });
        writeFileSync(join(deps.scenariosDir, safeName), body.content, "utf-8");
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json({ imported: safeName, ...deps.listRulesEvent() });
      }

      // --- Scenario files CRUD ---

      if (isControlRequest && url?.pathname === "/scenarios/files" && req.method === "GET") {
        if (!existsSync(deps.scenariosDir)) mkdirSync(deps.scenariosDir, { recursive: true });
        const files = readdirSync(deps.scenariosDir).filter((f) => /\.(ts|js)$/.test(f));
        const result = files.map((filename) => ({
          filename,
          content: readFileSync(join(deps.scenariosDir, filename), "utf-8"),
        }));
        return Response.json({ files: result });
      }

      if (isControlRequest && url?.pathname === "/scenarios/files" && req.method === "POST") {
        const body = yield* _(
          parseJsonBody<{ filename: string; content: string }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        const safeName = basename(body.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
        if (!safeName || !/\.(ts|js)$/.test(safeName)) {
          return Response.json({ error: "Filename must end with .ts or .js" }, { status: 400 });
        }
        if (!existsSync(deps.scenariosDir)) mkdirSync(deps.scenariosDir, { recursive: true });
        const filePath = join(deps.scenariosDir, safeName);
        if (existsSync(filePath)) {
          return Response.json({ error: `File already exists: ${safeName}` }, { status: 409 });
        }
        writeFileSync(filePath, body.content, "utf-8");
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json({ filename: safeName, content: body.content });
      }

      if (isControlRequest && url?.pathname?.startsWith("/scenarios/files/") && req.method === "PUT") {
        const filename = decodeURIComponent(url.pathname.slice("/scenarios/files/".length));
        const safeName = basename(filename);
        if (!safeName || !/\.(ts|js)$/.test(safeName)) {
          return Response.json({ error: "Invalid filename" }, { status: 400 });
        }
        const filePath = join(deps.scenariosDir, safeName);
        if (!existsSync(filePath)) {
          return Response.json({ error: `File not found: ${safeName}` }, { status: 404 });
        }
        const body = yield* _(
          parseJsonBody<{ content: string }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        writeFileSync(filePath, body.content, "utf-8");
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json({ filename: safeName, content: body.content });
      }

      if (isControlRequest && url?.pathname?.startsWith("/scenarios/files/") && req.method === "DELETE") {
        const filename = decodeURIComponent(url.pathname.slice("/scenarios/files/".length));
        const safeName = basename(filename);
        if (!safeName || !/\.(ts|js)$/.test(safeName)) {
          return Response.json({ error: "Invalid filename" }, { status: 400 });
        }
        const filePath = join(deps.scenariosDir, safeName);
        if (!existsSync(filePath)) {
          return Response.json({ error: `File not found: ${safeName}` }, { status: 404 });
        }
        unlinkSync(filePath);
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json({ deleted: safeName });
      }

      if (isControlRequest && url?.pathname === "/views/import" && req.method === "POST") {
        const body = yield* _(
          parseJsonBody<{ filename: string; content: string }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        const safeName = basename(body.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
        if (!existsSync(deps.viewsDir)) mkdirSync(deps.viewsDir, { recursive: true });
        writeFileSync(join(deps.viewsDir, safeName), body.content, "utf-8");
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json({ imported: safeName });
      }

      // --- Examples: list and import bundled example files ---
      if (isControlRequest && url?.pathname === "/examples/scenarios" && req.method === "GET") {
        const dir = join(examplesDir, "scenarios");
        const files = existsSync(dir)
          ? readdirSync(dir).filter((f) => /\.(ts|js)$/.test(f))
          : [];
        return Response.json({ files });
      }

      if (isControlRequest && url?.pathname === "/examples/views" && req.method === "GET") {
        const dir = join(examplesDir, "views");
        const files = existsSync(dir)
          ? readdirSync(dir).filter((f) => /\.(ts|js)$/.test(f))
          : [];
        return Response.json({ files });
      }

      if (isControlRequest && url?.pathname === "/examples/scenarios/import" && req.method === "POST") {
        const body = yield* _(
          parseJsonBody<{ filename: string }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        const safeName = basename(body.filename);
        const src = join(examplesDir, "scenarios", safeName);
        if (!existsSync(src)) {
          return Response.json({ error: `Example not found: ${safeName}` }, { status: 404 });
        }
        if (!existsSync(deps.scenariosDir)) mkdirSync(deps.scenariosDir, { recursive: true });
        copyFileSync(src, join(deps.scenariosDir, safeName));
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json({ imported: safeName });
      }

      if (isControlRequest && url?.pathname === "/examples/views/import" && req.method === "POST") {
        const body = yield* _(
          parseJsonBody<{ filename: string }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        const safeName = basename(body.filename);
        const src = join(examplesDir, "views", safeName);
        if (!existsSync(src)) {
          return Response.json({ error: `Example not found: ${safeName}` }, { status: 404 });
        }
        if (!existsSync(deps.viewsDir)) mkdirSync(deps.viewsDir, { recursive: true });
        copyFileSync(src, join(deps.viewsDir, safeName));
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json({ imported: safeName });
      }

      // --- Config / Theme ---
      if (isControlRequest && url?.pathname === "/config" && req.method === "GET") {
        return Response.json({ config: deps.getConfig() });
      }

      if (isControlRequest && url?.pathname === "/config/theme" && req.method === "GET") {
        return Response.json({ theme: deps.getConfig().theme ?? "dark" });
      }

      if (isControlRequest && url?.pathname === "/config/theme" && req.method === "PUT") {
        const body = yield* _(
          parseJsonBody<{ theme: "light" | "dark" }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        const theme = body.theme === "light" ? "light" : "dark";
        deps.updateConfig({ theme });
        return Response.json({ theme: deps.getConfig().theme });
      }

      // --- Views (custom filters) ---
      if (isControlRequest && url?.pathname === "/views" && req.method === "GET") {
        return Response.json({
          views: deps.getViews(),
          defaultViewId: deps.getConfig().defaultViewId,
        });
      }

      if (isControlRequest && url?.pathname === "/views/default" && req.method === "PUT") {
        const body = yield* _(
          parseJsonBody<{ viewId: string | null }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        deps.updateConfig({ defaultViewId: body.viewId ?? null });
        return Response.json({
          views: deps.getViews(),
          defaultViewId: deps.getConfig().defaultViewId,
        });
      }

      // --- View files CRUD ---

      if (isControlRequest && url?.pathname === "/views/files" && req.method === "GET") {
        if (!existsSync(deps.viewsDir)) mkdirSync(deps.viewsDir, { recursive: true });
        const files = readdirSync(deps.viewsDir).filter((f) => /\.(ts|js)$/.test(f));
        const result = files.map((filename) => ({
          filename,
          content: readFileSync(join(deps.viewsDir, filename), "utf-8"),
        }));
        return Response.json({ files: result });
      }

      if (isControlRequest && url?.pathname === "/views/files" && req.method === "POST") {
        const body = yield* _(
          parseJsonBody<{ filename: string; content: string }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        const safeName = basename(body.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
        if (!safeName || !/\.(ts|js)$/.test(safeName)) {
          return Response.json({ error: "Filename must end with .ts or .js" }, { status: 400 });
        }
        if (!existsSync(deps.viewsDir)) mkdirSync(deps.viewsDir, { recursive: true });
        const filePath = join(deps.viewsDir, safeName);
        if (existsSync(filePath)) {
          return Response.json({ error: `File already exists: ${safeName}` }, { status: 409 });
        }
        writeFileSync(filePath, body.content, "utf-8");
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json({ filename: safeName, content: body.content });
      }

      if (isControlRequest && url?.pathname?.startsWith("/views/files/") && req.method === "PUT") {
        const filename = decodeURIComponent(url.pathname.slice("/views/files/".length));
        const safeName = basename(filename);
        if (!safeName || !/\.(ts|js)$/.test(safeName)) {
          return Response.json({ error: "Invalid filename" }, { status: 400 });
        }
        const filePath = join(deps.viewsDir, safeName);
        if (!existsSync(filePath)) {
          return Response.json({ error: `File not found: ${safeName}` }, { status: 404 });
        }
        const body = yield* _(
          parseJsonBody<{ content: string }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        writeFileSync(filePath, body.content, "utf-8");
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json({ filename: safeName, content: body.content });
      }

      if (isControlRequest && url?.pathname?.startsWith("/views/files/") && req.method === "DELETE") {
        const filename = decodeURIComponent(url.pathname.slice("/views/files/".length));
        const safeName = basename(filename);
        if (!safeName || !/\.(ts|js)$/.test(safeName)) {
          return Response.json({ error: "Invalid filename" }, { status: 400 });
        }
        const filePath = join(deps.viewsDir, safeName);
        if (!existsSync(filePath)) {
          return Response.json({ error: `File not found: ${safeName}` }, { status: 404 });
        }
        unlinkSync(filePath);
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json({ deleted: safeName });
      }

      if (isControlRequest && url?.pathname === "/proxy/enable" && req.method === "POST") {
        const body = yield* _(
          parseJsonBody<{ proxyHost: string; proxyPort?: number }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        // Refuse to point the system proxy at a port nothing is listening on —
        // that would take the user's network down rather than just failing to
        // capture traffic.
        const engine = deps.getEngineStatus();
        if (!engine.engineAvailable) {
          return Response.json(
            { error: engine.engineError ?? "The mitmproxy engine is not running." },
            { status: 503 }
          );
        }
        // The server owns the port: a stale UI build must not be able to point
        // the system proxy somewhere dead.
        const result = yield* _(
          deps.enableProxy({ proxyHost: body.proxyHost, proxyPort: deps.getProxyPort() }).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        return Response.json(result);
      }

      if (isControlRequest && url?.pathname === "/proxy/disable" && req.method === "POST") {
        const result = yield* _(
          deps.disableProxy().pipe(Effect.mapError((cause) => new RequestError({ cause })))
        );
        return Response.json(result);
      }

      if (isControlRequest && url?.pathname === "/proxy/status" && req.method === "GET") {
        const result = yield* _(
          deps.proxyStatus().pipe(Effect.mapError((cause) => new RequestError({ cause })))
        );
        return Response.json({ ...result, proxyPort: deps.getProxyPort(), ...deps.getEngineStatus() });
      }

      if (isControlRequest && url?.pathname === "/simulators" && req.method === "GET") {
        const simulators = yield* _(
          deps.listSimulators().pipe(Effect.mapError((cause) => new RequestError({ cause })))
        );
        return Response.json({ simulators });
      }

      if (isControlRequest && url?.pathname === "/simulators/certs" && req.method === "POST") {
        const body = yield* _(
          parseJsonBody<{ udid: string; certPath: string }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        const simulator = yield* _(
          deps.installSimulatorCert(body).pipe(Effect.mapError((cause) => new RequestError({ cause })))
        );
        return Response.json({ simulator, certPath: body.certPath });
      }

      // --- CA certificate endpoints ---
      if (isControlRequest && url?.pathname === "/ca/cert" && req.method === "GET") {
        const pem = deps.getCaCertPem();
        if (!pem) {
          return Response.json({ error: "CA not initialized" }, { status: 503 });
        }
        return new Response(pem, {
          headers: {
            "Content-Type": "application/x-pem-file",
            "Content-Disposition": "attachment; filename=\"aproxy-ca.pem\"",
          },
        });
      }

      if (isControlRequest && url?.pathname === "/ca/status" && req.method === "GET") {
        const certPath = deps.getCaCertPath();
        return Response.json({
          initialized: certPath !== null,
          certPath,
          trustCommand: certPath
            ? `security add-trusted-cert -r trustRoot -p ssl -k ~/Library/Keychains/login.keychain-db ${certPath}`
            : null,
        });
      }

      if (isControlRequest && url?.pathname === "/ca/trust" && req.method === "POST") {
        // Check if already trusted before attempting
        const alreadyTrusted = yield* _(
          deps.isCaTrusted().pipe(Effect.catchAll(() => Effect.succeed(false)))
        );
        if (alreadyTrusted) {
          return Response.json({ trusted: true, alreadyTrusted: true });
        }
        const result = yield* _(
          deps.trustCaOnHost().pipe(Effect.mapError((cause) => new RequestError({ cause })))
        );
        return Response.json(result);
      }

      if (isControlRequest && url?.pathname === "/ca/trust/status" && req.method === "GET") {
        const trusted = yield* _(deps.isCaTrusted());
        return Response.json({ trusted });
      }

      if (isControlRequest && url?.pathname === "/simulators/trust-ca" && req.method === "POST") {
        const body = yield* _(
          parseJsonBody<{ udid: string }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        const simulator = yield* _(
          deps.installCaOnSimulator(body.udid).pipe(Effect.mapError((cause) => new RequestError({ cause })))
        );
        return Response.json({ simulator });
      }

      // Serve static assets from the React UI build (js, css, etc.)
      if (isControlRequest && url?.pathname && req.method === "GET") {
        const safePath = url.pathname.replace(/\.\./g, "");
        const filePath = join(uiDistDir, safePath);
        if (existsSync(filePath)) {
          const file = Bun.file(filePath);
          const ext = extname(safePath);
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          return new Response(file, {
            headers: { "Content-Type": contentType },
          });
        }
      }

      // If we reach here for a control-host request, it means no route matched.
      if (isControlRequest) {
        return new Response("Not Found", { status: 404 });
      }

      // A non-control request reached the control port, which never proxies
      // traffic. This normally means a stale system proxy setting is pointing
      // here instead of at the mitmproxy port.
      return new Response(
        `aproxy control server does not proxy traffic. Point your proxy settings at port ${deps.getProxyPort()}.`,
        { status: 421, headers: { "Content-Type": "text/plain" } }
      );
    }).pipe(
      Effect.map((res) => _isControlRequest ? withCors(res, req) : res),
      Effect.catchAll((err) => Effect.sync(() => {
        const message = describeError(err);
        console.error(`[route error] ${message}`);
        return withCors(Response.json({ error: message }, { status: 400 }), req);
      })),
    );
  };
}

/** Best-effort human-readable message for anything that reaches the route catch-all. */
function describeError(err: unknown): string {
  if (err instanceof CommandError) return err.message;
  if (err instanceof RequestError) return String((err as any).cause ?? err);
  return String(err);
}

export function createSse(
  eventBus: { on: (listener: (event: { type: string }) => void) => () => void },
  listRulesEvent: () => RulesListEvent,
  listViewsEvent: () => ViewsListEvent,
  signal: AbortSignal
) {
  return createSseStream(signal, eventBus as any, listRulesEvent, listViewsEvent);
}
