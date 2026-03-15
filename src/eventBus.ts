export class EventBus<TEvent> {
  private listeners = new Set<(event: TEvent) => void>();

  on(listener: (event: TEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: TEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // Don't let one failing listener prevent others from receiving events.
        // Remove the broken listener to avoid repeated failures.
        this.listeners.delete(listener);
        console.error("[eventBus] listener threw, removed:", err);
      }
    }
  }
}
