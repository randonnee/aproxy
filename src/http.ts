import type { RulesListEvent, ViewsListEvent, ProxyEvent, SimulatorEvent } from "./models";
import type { EventBus } from "./eventBus";
import { Effect } from "effect";

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
