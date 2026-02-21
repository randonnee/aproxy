import type { RulesListEvent, SimulatorInfo } from "./models";
import { Effect } from "effect";
import { RequestError } from "./errors";
import { createSseStream, parseJsonBody } from "./http";

export function createServer(fetchHandler: (req: Request) => Effect.Effect<Response, RequestError>) {
  return Effect.try(() =>
    Bun.serve({
      port: Number(process.env.PROXY_PORT ?? 8080),
      fetch: (req) => Effect.runPromise(fetchHandler(req))
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
    listSimulators: () => Effect.Effect<SimulatorInfo[], RequestError | unknown>;
    configureSimulator: (input: {
      udid: string;
      proxyHost: string;
      proxyPort: number;
    }) => Effect.Effect<SimulatorInfo, RequestError | unknown>;
    installSimulatorCert: (input: { udid: string; certPath: string }) => Effect.Effect<SimulatorInfo, RequestError | unknown>;
  }
) {
  return (req: Request) =>
    Effect.gen(function* (_) {
      const url = yield* _(
        Effect.try(() => new URL(req.url)).pipe(Effect.mapError((cause) => new RequestError({ cause })))
      );

      if (url.pathname === "/events" && req.method === "GET") {
        const stream = deps.createSse(req.signal);
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          }
        });
      }

      if (url.pathname === "/scenarios" && req.method === "GET") {
        return Response.json({
          scenarios: deps.getScenarios(),
          activeScenarioId: deps.getActiveScenarioId()
        });
      }

      if (url.pathname === "/scenarios/active" && req.method === "PUT") {
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

      if (url.pathname === "/rules" && req.method === "GET") {
        return Response.json(deps.listRulesEvent());
      }

      if (url.pathname === "/rules/reload" && req.method === "POST") {
        yield* _(deps.loadRules().pipe(Effect.mapError((cause) => new RequestError({ cause }))));
        return Response.json(deps.listRulesEvent());
      }

      if (url.pathname === "/simulators" && req.method === "GET") {
        const simulators = yield* _(
          deps.listSimulators().pipe(Effect.mapError((cause) => new RequestError({ cause })))
        );
        return Response.json({ simulators });
      }

      if (url.pathname === "/simulators/configure" && req.method === "POST") {
        const body = yield* _(
          parseJsonBody<{ udid: string; proxyHost: string; proxyPort: number }>(req).pipe(
            Effect.mapError((cause) => new RequestError({ cause }))
          )
        );
        const simulator = yield* _(
          deps.configureSimulator(body).pipe(Effect.mapError((cause) => new RequestError({ cause })))
        );
        return Response.json({ simulator, proxyHost: body.proxyHost, proxyPort: body.proxyPort });
      }

      if (url.pathname === "/simulators/certs" && req.method === "POST") {
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

      if (req.method === "CONNECT") return new Response("CONNECT not implemented yet", { status: 501 });
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
