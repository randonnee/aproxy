export class EventBus<TEvent> {
  private listeners = new Set<(event: TEvent) => void>();

  on(listener: (event: TEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: TEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
