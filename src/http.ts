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

export function stripHopByHop(headers: Headers) {
  for (const name of hopByHopHeaders) headers.delete(name);
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

      abortSignal.addEventListener(
        "abort",
        () => {
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
  for (const controller of sseClients) controller.enqueue(payload);
}

export function parseJsonBody<T>(req: Request) {
  return Effect.tryPromise(() => req.json() as Promise<T>);
}
