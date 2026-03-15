import type { RulesListEvent, ViewsListEvent, ProxyEvent, SimulatorEvent } from "./models";
import type { EventBus } from "./eventBus";
import { Effect } from "effect";

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "proxy-connection"
]);

/** Headers that must be preserved for WebSocket upgrade requests. */
const wsPreservedHeaders = new Set(["connection", "upgrade"]);

export function stripHopByHop(headers: Headers) {
  for (const name of hopByHopHeaders) headers.delete(name);
}

/**
 * Strip hop-by-hop headers but preserve Connection and Upgrade
 * which are required for WebSocket handshakes.
 */
export function stripHopByHopForWebSocket(headers: Headers) {
  for (const name of hopByHopHeaders) {
    if (!wsPreservedHeaders.has(name)) headers.delete(name);
  }
}

/** Check if a request is a WebSocket upgrade. */
export function isWebSocketUpgrade(headers: Headers): boolean {
  const upgrade = headers.get("upgrade");
  const connection = headers.get("connection");

  // Standard check: Upgrade: websocket + Connection includes "upgrade"
  if (
    upgrade !== null &&
    upgrade.toLowerCase() === "websocket" &&
    connection !== null &&
    connection.toLowerCase().includes("upgrade")
  ) {
    return true;
  }

  // Fallback: some clients (e.g. iOS URLSessionWebSocketTask through MITM)
  // may include Sec-WebSocket-Key without explicit Upgrade/Connection headers.
  // The presence of Sec-WebSocket-Key + Sec-WebSocket-Version is a definitive
  // indicator of a WebSocket upgrade request.
  if (headers.has("sec-websocket-key") && headers.has("sec-websocket-version")) {
    return true;
  }

  return false;
}

export function headersToRecord(headers: Headers) {
  const record: Record<string, string> = {};
  for (const [key, value] of headers) record[key] = value;
  return record;
}

export function createSseStream(
  abortSignal: AbortSignal,
  eventBus: EventBus<ProxyEvent | RulesListEvent | ViewsListEvent | SimulatorEvent>,
  listRulesEvent: () => RulesListEvent,
  listViewsEvent: () => ViewsListEvent
) {
  const sseClients = new Set<ReadableStreamDefaultController<string>>();
  const unsubscribe = eventBus.on((event) => emitSse(event, sseClients));

  return new ReadableStream<string>({
    start(controller) {
      sseClients.add(controller);
      controller.enqueue("data: {\"type\":\"hello\",\"status\":\"ok\"}\n\n");
      controller.enqueue(`data: ${JSON.stringify(listRulesEvent())}\n\n`);
      controller.enqueue(`data: ${JSON.stringify(listViewsEvent())}\n\n`);

      // Send heartbeat event every 1s so the client can detect a dead connection
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue("data: {\"type\":\"heartbeat\"}\n\n");
        } catch {
          clearInterval(heartbeat);
        }
      }, 1_000);

      abortSignal.addEventListener(
        "abort",
        () => {
          clearInterval(heartbeat);
          sseClients.delete(controller);
          unsubscribe();
          controller.close();
        },
        { once: true }
      );
    }
  });
}

function emitSse(event: { type: string }, sseClients: Set<ReadableStreamDefaultController<string>>) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const controller of sseClients) {
    try {
      controller.enqueue(payload);
    } catch {
      // Controller's stream is closed — remove it so we don't keep failing
      sseClients.delete(controller);
    }
  }
}

export function parseJsonBody<T>(req: Request) {
  return Effect.tryPromise(() => req.json() as Promise<T>);
}
