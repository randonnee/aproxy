import type { ProxyEvent } from "./models";
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
  requestBodyText: string | undefined,
  applyRules: (context: { id: string; url: string; method: string; headers: Record<string, string>; body?: string }) =>
    Effect.Effect<Response | null, ProxyError>
) {
  return Effect.gen(function* (_) {
    const ruleResponse = yield* _(
      applyRules({
        id,
        url: req.url,
        method: req.method,
        headers: headersToRecord(req.headers),
        body: requestBodyText
      })
    );

    if (ruleResponse) {
      const responseHeaders = new Headers(ruleResponse.headers);
      // Read the full body so we can include it in the event
      let bodyText: string | undefined;
      let bodyBase64: string | undefined;
      const bodyBytes = yield* _(
        Effect.tryPromise(() => ruleResponse.clone().arrayBuffer()).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )
      );
      if (bodyBytes) {
        const contentType = responseHeaders.get("content-type") ?? responseHeaders.get("Content-Type") ?? "";
        const normalizedType = contentType.toLowerCase();
        const isMedia = normalizedType.startsWith("image/") || normalizedType.startsWith("video/") || normalizedType.startsWith("audio/");
        if (isMedia) {
          bodyBase64 = Buffer.from(bodyBytes).toString("base64");
        } else {
          try {
            bodyText = new TextDecoder().decode(bodyBytes);
          } catch {
            bodyBase64 = Buffer.from(bodyBytes).toString("base64");
          }
        }
      }
      const responseEvent: ProxyEvent = {
        type: "response",
        id,
        status: ruleResponse.status,
        headers: headersToRecord(responseHeaders),
        durationMs: Date.now() - startedAt,
        timestamp: Date.now(),
        body: bodyText,
        bodyBase64,
        bodyEncoding: bodyBase64 ? "base64" : undefined,
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
    let bodyBase64: string | undefined;
    const contentType = responseHeaders.get("content-type") ?? responseHeaders.get("Content-Type") ?? "";
    const normalizedType = contentType.toLowerCase();
    const isMedia = normalizedType.startsWith("image/") || normalizedType.startsWith("video/") || normalizedType.startsWith("audio/");
    if (isMedia) {
      bodyBase64 = Buffer.from(bodyBytes).toString("base64");
    } else {
      try {
        bodyText = new TextDecoder().decode(bodyBytes);
      } catch {
        bodyBase64 = Buffer.from(bodyBytes).toString("base64");
      }
    }

    const responseEvent: ProxyEvent = {
      type: "response",
      id,
      status: upstreamResponse.status,
      headers: headersToRecord(responseHeaders),
      durationMs: Date.now() - startedAt,
      timestamp: Date.now(),
      body: bodyText,
      bodyBase64,
      bodyEncoding: bodyBase64 ? "base64" : undefined
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
  applyRules: (context: { id: string; url: string; method: string; headers: Record<string, string>; body?: string }) =>
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
    // Read request body for the event before forwarding.
    // IMPORTANT: req.clone() must be called outside the if-block. In Bun's
    // generator runtime, calling clone() inside a conditional corrupts the
    // internal ReadableStream tee, causing the original req.body to become
    // empty by the time it reaches the upstream fetch().
    let requestBodyText: string | undefined;
    const cloned = req.clone();
    if (cloned.body && req.method !== "GET" && req.method !== "HEAD") {
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
    const outcome = yield* _(computeProxyOutcome(req, id, startedAt, requestBodyText, applyRules));
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
