import type { RulesListEvent, ProxyEvent } from "./models";
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
  eventBus: EventBus<ProxyEvent | RulesListEvent>,
  listRulesEvent: () => RulesListEvent
) {
  const sseClients = new Set<ReadableStreamDefaultController<string>>();
  eventBus.on((event) => emitSse(event, sseClients));

  return new ReadableStream<string>({
    start(controller) {
      sseClients.add(controller);
      controller.enqueue("event: hello\n");
      controller.enqueue("data: {\"status\":\"ok\"}\n\n");
      controller.enqueue(`event: rules_list\n`);
      controller.enqueue(`data: ${JSON.stringify(listRulesEvent())}\n\n`);

      abortSignal.addEventListener(
        "abort",
        () => {
          sseClients.delete(controller);
          controller.close();
        },
        { once: true }
      );
    }
  });
}

function emitSse(event: { type: string }, sseClients: Set<ReadableStreamDefaultController<string>>) {
  const payload = `event: ${event.type}\n` + `data: ${JSON.stringify(event)}\n\n`;
  for (const controller of sseClients) controller.enqueue(payload);
}

export function parseJsonBody<T>(req: Request) {
  return Effect.tryPromise(() => req.json() as Promise<T>);
}
