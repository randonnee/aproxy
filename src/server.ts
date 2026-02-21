import type { RulesListEvent, SimulatorInfo, ProxyEvent } from "./models";
import { Effect } from "effect";
import { networkInterfaces } from "node:os";
import { RequestError } from "./errors";
import { createSseStream, parseJsonBody } from "./http";
import { createTcpProxy } from "./tcpProxy";

const uiHtml = await Bun.file(new URL("./ui.html", import.meta.url)).text();

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
  emitEvent: (event: ProxyEvent) => void
) {
  return Effect.try(() =>
    createTcpProxy({
      hostname: process.env.HOST ?? "0.0.0.0",
      port: Number(process.env.PROXY_PORT ?? 8080),
      fetchHandler,
      emitEvent
    })
  ).pipe(Effect.mapError((cause) => new RequestError({ cause })));
}

export function createRoutes(
  deps: {
    listRulesEvent: () => RulesListEvent;
    loadRules: () => Effect.Effect<void, RequestError | unknown>;
    handleProxy: (req: Request) => Effect.Effect<Response, unknown>;
    createSse: (signal: AbortSignal) => ReadableStream<string>;
    getScenarios: () => Array<{ id: string; name: string; description?: string }>;
    getActiveScenarioId: () => string | null;
    setActiveScenarioId: (id: string | null) => void;
    enableProxy: (input: {
      proxyHost: string;
      proxyPort: number;
    }) => Effect.Effect<{ networkService: string; proxyHost: string; proxyPort: number; enabled: boolean }, RequestError | unknown>;
    disableProxy: () => Effect.Effect<{ networkService: string; enabled: boolean }, RequestError | unknown>;
    proxyStatus: () => Effect.Effect<{
      settings: Record<string, string>;
      raw: string;
      networkService: string;
      enabled: boolean;
    }, RequestError | unknown>;
    listSimulators: () => Effect.Effect<SimulatorInfo[], RequestError | unknown>;
    installSimulatorCert: (input: { udid: string; certPath: string }) => Effect.Effect<SimulatorInfo, RequestError | unknown>;
  }
) {
  const controlHosts = listLocalHosts();
  return (req: Request) =>
    Effect.gen(function* (_) {
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

      yield* _(
        Effect.sync(() =>
          console.log(
            `[incoming] ${req.method} ${req.url} host=${hostHeader} control=${isControlRequest} urlHost=${urlHost || ""}`
          )
        )
      );

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
        return new Response(uiHtml, {
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
          activeScenarioId: deps.getActiveScenarioId()
        });
      }

      if (isControlRequest && url?.pathname === "/scenarios/active" && req.method === "PUT") {
        const body = yield* _(
          parseJsonBody<{ scenarioId: string | null }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        deps.setActiveScenarioId(body.scenarioId ?? null);
        return Response.json({
          scenarios: deps.getScenarios(),
          activeScenarioId: deps.getActiveScenarioId()
        });
      }

      if (isControlRequest && url?.pathname === "/rules" && req.method === "GET") {
        return Response.json(deps.listRulesEvent());
      }

      if (isControlRequest && url?.pathname === "/rules/reload" && req.method === "POST") {
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json(deps.listRulesEvent());
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

      // If we reach here for a control-host request, it means no route matched.
      // Return 404 instead of falling through to the proxy handler, which would
      // create an infinite loop when the system proxy is enabled (the proxy would
      // send the request back to itself via the system proxy).
      if (isControlRequest) {
        return new Response("Not Found", { status: 404 });
      }

      return yield* _(deps.handleProxy(req));
    }).pipe(Effect.catchAll(() => Effect.sync(() => new Response("Request error", { status: 400 }))));
}

export function createSse(
  eventBus: { on: (listener: (event: { type: string }) => void) => () => void },
  listRulesEvent: () => RulesListEvent,
  signal: AbortSignal
) {
  return createSseStream(signal, eventBus as any, listRulesEvent);
}
