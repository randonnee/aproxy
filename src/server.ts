import type { RulesListEvent, ViewsListEvent, SimulatorInfo, ProxyEvent } from "./models";
import type { CaCert } from "./ca";
import type { AproxyConfig } from "./config";
import { Effect } from "effect";
import { networkInterfaces } from "node:os";
import { existsSync, readFileSync, readdirSync, copyFileSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { CommandError, RequestError } from "./errors";
import { createSseStream, parseJsonBody } from "./http";
import { createTcpProxy } from "./tcpProxy";

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
 * Create the proxy server using a raw TCP listener that supports CONNECT tunneling.
 * Normal HTTP requests are handled by the provided fetchHandler.
 */
export function createServer(
  fetchHandler: (req: Request) => Effect.Effect<Response, RequestError>,
  emitEvent: (event: ProxyEvent) => void,
  ca?: CaCert
) {
  return Effect.try(() =>
    createTcpProxy({
      hostname: process.env.HOST ?? "127.0.0.1",
      port: Number(process.env.PROXY_PORT ?? 8080),
      fetchHandler,
      emitEvent,
      ca,
    })
  ).pipe(Effect.mapError((cause) => new RequestError({ cause })));
}

export function createRoutes(
  deps: {
    listRulesEvent: () => RulesListEvent;
    listViewsEvent: () => ViewsListEvent;
    loadRules: () => Effect.Effect<void, RequestError | unknown>;
    scenariosDir: string;
    viewsDir: string;
    handleProxy: (req: Request) => Effect.Effect<Response, unknown>;
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
        return Response.json({ host: getPreferredHost() });
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
          parseJsonBody<{ proxyHost: string; proxyPort: number }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        const result = yield* _(
          deps.enableProxy(body).pipe(Effect.mapError((cause) => new RequestError({ cause })))
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
        return Response.json(result);
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
      // Return 404 instead of falling through to the proxy handler, which would
      // create an infinite loop when the system proxy is enabled (the proxy would
      // send the request back to itself via the system proxy).
      if (isControlRequest) {
        return new Response("Not Found", { status: 404 });
      }

      return yield* _(deps.handleProxy(req));
    }).pipe(
      Effect.map((res) => _isControlRequest ? withCors(res, req) : res),
      Effect.catchAll((err) => Effect.sync(() => {
        const message = err instanceof CommandError
          ? err.message
          : err instanceof RequestError
            ? String((err as any).cause ?? err)
            : String(err);
        console.error(`[route error] ${message}`);
        return withCors(Response.json({ error: message }, { status: 400 }), req);
      })),
    );
  };
}

export function createSse(
  eventBus: { on: (listener: (event: { type: string }) => void) => () => void },
  listRulesEvent: () => RulesListEvent,
  listViewsEvent: () => ViewsListEvent,
  signal: AbortSignal
) {
  return createSseStream(signal, eventBus as any, listRulesEvent, listViewsEvent);
}
