import type { DomainEvent, EventBusPort } from "@jini-ai/cms/core";
export class InMemoryEventBus implements EventBusPort {
  private handlers = new Map<string, Set<(event: DomainEvent<any>) => Promise<void>>>();
  private all = new Set<(event: DomainEvent) => Promise<void>>();
  async subscribe<T>({ eventName: name, handler }: { eventName: string; handler: (event: DomainEvent<T>) => Promise<void> }) {
    const set = this.handlers.get(name) ?? new Set(); set.add(handler); this.handlers.set(name, set);
    return async () => { set.delete(handler); };
  }
  async subscribeAll({ handler }: { handler: (event: DomainEvent) => Promise<void> }) { this.all.add(handler); return async () => { this.all.delete(handler); }; }
  async publish<T>(event: DomainEvent<T>) {
    for (const h of this.handlers.get(event.name) ?? []) await h(event);
    for (const h of this.all) {
      // Catch-all subscribers require record payloads even though publishing is generic.
      if (!hasRecordPayload(event)) throw new TypeError("Catch-all subscribers require record event payloads");
      await h(event);
    }
  }
  async publishBatch<T>({ events }: { events: DomainEvent<T>[] }) { for (const e of events) await this.publish(e); }
}
function hasRecordPayload<T>(event: DomainEvent<T>): event is DomainEvent<T> & DomainEvent {
  return typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload);
}
export class InMemoryOutbox {
  events: DomainEvent[] = [];
  async enqueue(event: DomainEvent) { this.events.push(event); }
  async claimPending(_limit: number, _now: string) { return this.events.map(event => ({ event })); }
}
export function createRateLimiter() {
  const counts = new Map<string, number>();
  return { check({ key }: { key: string }) { const n = (counts.get(key) ?? 0) + 1; counts.set(key, n); return n <= 5 ? { allowed: true as const } : { allowed: false as const, retryAfterSeconds: 60 }; } };
}
