import type { ProxyEvent } from "./models";
import type { RuleHandler } from "./rules";
import { Effect } from "effect";
import { ProxyError } from "./errors";
import { headersToRecord, stripHopByHop } from "./http";

type ProxyOutcome = { response: Response; event?: ProxyEvent };

export function resolveTargetUrl(req: Request) {
  return Effect.try(() => {
    if (req.url.startsWith("http://") || req.url.startsWith("https://")) {
      return new URL(req.url);
    }

    const host = req.headers.get("host");
    if (!host) throw new Error("Missing Host header");
    const path = req.url.startsWith("/") ? req.url : `/${req.url}`;
    return new URL(`http://${host}${path}`);
  }).pipe(Effect.mapError((cause) => new ProxyError({ cause })));
}

export function computeProxyOutcome(
  req: Request,
  id: string,
  startedAt: number,
  applyRules: (context: { id: string; url: string; method: string; headers: Record<string, string> }) =>
    Effect.Effect<Response | null, ProxyError>
) {
  return Effect.gen(function* (_) {
    const ruleResponse = yield* _(
      applyRules({
        id,
        url: req.url,
        method: req.method,
        headers: headersToRecord(req.headers)
      })
    );

    if (ruleResponse) {
      const responseHeaders = new Headers(ruleResponse.headers);
      const responseEvent: ProxyEvent = {
        type: "response",
        id,
        status: ruleResponse.status,
        headers: headersToRecord(responseHeaders),
        durationMs: Date.now() - startedAt,
        timestamp: Date.now()
      };
      return { response: ruleResponse, event: responseEvent };
    }

    const targetRequest = {
      method: req.method,
      url: req.url,
      headers: new Headers(req.headers),
      body: req.body
    };

    const targetUrl = yield* _(
      resolveTargetUrl(
        new Request(targetRequest.url, {
          method: targetRequest.method,
          headers: targetRequest.headers,
          body: targetRequest.body
        })
      )
    );

    const outgoingHeaders = new Headers(targetRequest.headers);
    stripHopByHop(outgoingHeaders);

    const upstreamResponse = yield* _(
      Effect.tryPromise(() =>
        fetch(targetUrl, {
          method: targetRequest.method,
          headers: outgoingHeaders,
          body: targetRequest.body,
          redirect: "manual"
        })
      ).pipe(Effect.mapError((cause) => new ProxyError({ cause })))
    );

    const responseHeaders = new Headers(upstreamResponse.headers);
    stripHopByHop(responseHeaders);

    const responseEvent: ProxyEvent = {
      type: "response",
      id,
      status: upstreamResponse.status,
      headers: headersToRecord(responseHeaders),
      durationMs: Date.now() - startedAt,
      timestamp: Date.now()
    };

    return {
      response: new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: responseHeaders
      }),
      event: responseEvent
    } as ProxyOutcome;
  });
}

export function handleHttpProxy(
  req: Request,
  emitEvent: (event: ProxyEvent) => void,
  applyRules: (context: { id: string; url: string; method: string; headers: Record<string, string> }) =>
    Effect.Effect<Response | null, ProxyError>
) {
  const id = crypto.randomUUID();
  const startedAt = Date.now();

  const requestEvent: ProxyEvent = {
    type: "request",
    id,
    method: req.method,
    url: req.url,
    headers: headersToRecord(req.headers),
    timestamp: startedAt
  };

  return Effect.gen(function* (_) {
    yield* _(Effect.sync(() => emitEvent(requestEvent)));
    const outcome = yield* _(computeProxyOutcome(req, id, startedAt, applyRules));
    if (outcome.event) {
      const event = outcome.event;
      yield* _(Effect.sync(() => emitEvent(event)));
    }
    return outcome.response;
  }).pipe(
    Effect.catchAll((error) => {
      const message = error instanceof Error ? error.message : "Unknown proxy error";
      const errorEvent: ProxyEvent = {
        type: "error",
        id,
        message,
        timestamp: Date.now()
      };
      return Effect.sync(() => {
        emitEvent(errorEvent);
        return new Response("Proxy error", { status: 502 });
      });
    })
  );
}
