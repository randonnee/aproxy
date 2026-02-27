import type { ProxyEvent } from "./models";
import type { RuleHandler } from "../shared/rules";
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
      // Read the full body so we can include it in the event
      let bodyText: string | undefined;
      const bodyBytes = yield* _(
        Effect.tryPromise(() => ruleResponse.clone().arrayBuffer()).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )
      );
      if (bodyBytes) {
        try { bodyText = new TextDecoder().decode(bodyBytes); } catch {}
      }
      const responseEvent: ProxyEvent = {
        type: "response",
        id,
        status: ruleResponse.status,
        headers: headersToRecord(responseHeaders),
        durationMs: Date.now() - startedAt,
        timestamp: Date.now(),
        body: bodyText,
        mocked: true
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

    // Read the full body so we can include it in the event and still
    // return it in the Response for the client.
    const bodyBytes = yield* _(
      Effect.tryPromise(() => upstreamResponse.arrayBuffer()).pipe(
        Effect.mapError((cause) => new ProxyError({ cause }))
      )
    );

    // Bun's fetch() transparently decompresses gzip/br/deflate bodies, so the
    // ArrayBuffer we have is already decompressed.  Fix headers to match:
    // - Remove content-encoding (body is no longer encoded)
    // - Replace content-length with the actual decompressed size
    if (responseHeaders.has("content-encoding")) {
      responseHeaders.delete("content-encoding");
    }
    responseHeaders.set("content-length", String(bodyBytes.byteLength));
    let bodyText: string | undefined;
    try {
      bodyText = new TextDecoder().decode(bodyBytes);
    } catch {}

    const responseEvent: ProxyEvent = {
      type: "response",
      id,
      status: upstreamResponse.status,
      headers: headersToRecord(responseHeaders),
      durationMs: Date.now() - startedAt,
      timestamp: Date.now(),
      body: bodyText
    };

    return {
      response: new Response(bodyBytes, {
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
  const controlPort = Number(process.env.PROXY_PORT ?? 8080);

  const isUiRequest = (() => {
    try {
      if (req.url.startsWith("http://") || req.url.startsWith("https://")) {
        const parsed = new URL(req.url);
        const port = parsed.port ? Number(parsed.port) : 80;
        if (Number.isNaN(port) || port !== controlPort) return false;
        return ["localhost", "127.0.0.1"].includes(parsed.hostname);
      }
      return true;
    } catch {
      return false;
    }
  })();

  return Effect.gen(function* (_) {
    // Read request body for the event before forwarding (stream can only be consumed once)
    let requestBodyText: string | undefined;
    if (req.body && req.method !== "GET" && req.method !== "HEAD") {
      const cloned = req.clone();
      const bodyBytes = yield* _(
        Effect.tryPromise(() => cloned.arrayBuffer()).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )
      );
      if (bodyBytes && bodyBytes.byteLength > 0) {
        try { requestBodyText = new TextDecoder().decode(bodyBytes); } catch {}
      }
    }

    const requestEvent: ProxyEvent = {
      type: "request",
      id,
      method: req.method,
      url: req.url,
      headers: headersToRecord(req.headers),
      timestamp: startedAt,
      body: requestBodyText
    };

    yield* _(Effect.sync(() => emitEvent(requestEvent)));
    if (!isUiRequest) {
      yield* _(Effect.sync(() => console.log(`[proxy] ${req.method} ${req.url}`)));
    }
    const outcome = yield* _(computeProxyOutcome(req, id, startedAt, applyRules));
    if (outcome.event) {
      const event = outcome.event;
      yield* _(Effect.sync(() => emitEvent(event)));
    }
    return outcome.response;
  }).pipe(
    Effect.catchAll((error) => {
      let message = "Unknown proxy error";
      try {
        if (error instanceof Error) {
          message = error.message;
        } else if (typeof error === "object" && error !== null) {
          const e = error as any;
          if (e.cause instanceof Error) {
            message = e.cause.message;
          } else if (e.cause?.cause instanceof Error) {
            message = e.cause.cause.message;
          } else if (e.cause) {
            message = String(e.cause);
          } else {
            message = JSON.stringify(error);
          }
        } else {
          message = String(error);
        }
      } catch {}
      console.error(`[proxy] error for ${req.method} ${req.url}:`, message);
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
