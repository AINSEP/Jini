import type { BrowserStreamPorts, StreamChannel } from "../browser-stream.js";

/** Separate document/clock/channel ports for each simulated tab; one origin lock queue. */
export function fakeBrowserOrigin() {
  const channels = new Map<string, Set<StreamChannel>>();
  const tails = new Map<string, Promise<void>>();
  function tab() {
    let visibilityState: DocumentVisibilityState = "visible";
    let now = 0;
    let nextTimer = 0;
    const timers = new Map<number, { due: number; work: () => void }>();
    const visibilityListeners = new Set<() => void>();
    const pageListeners = new Map<string, Set<() => void>>();
    const ports: BrowserStreamPorts = {
      visibility: {
        get visibilityState() { return visibilityState; },
        addEventListener: (_kind, listener) => { visibilityListeners.add(listener); },
        removeEventListener: (_kind, listener) => { visibilityListeners.delete(listener); },
      },
      page: {
        addEventListener(kind, listener) {
          const set = pageListeners.get(kind) ?? new Set();
          set.add(listener);
          pageListeners.set(kind, set);
        },
        removeEventListener: (kind, listener) => { pageListeners.get(kind)?.delete(listener); },
      },
      now: () => now,
      schedule: ({ work, delayMs }) => {
        const id = ++nextTimer;
        timers.set(id, { work, due: now + delayMs });
        return () => { timers.delete(id); };
      },
      requestLock: ({ key, signal, hold }) => {
        const previous = tails.get(key) ?? Promise.resolve();
        const requested = previous.then(async () => { if (!signal.aborted) await hold(); });
        tails.set(key, requested.catch(() => {}));
        return requested;
      },
      openChannel: ({ name }) => {
        const peers = channels.get(name) ?? new Set();
        const listeners = new Set<(event: MessageEvent<unknown>) => void>();
        const channel: StreamChannel = {
          addEventListener: (_kind, listener) => { listeners.add(listener); },
          removeEventListener: (_kind, listener) => { listeners.delete(listener); },
          postMessage(value) {
            const data = structuredClone(value);
            for (const peer of peers) {
              if (peer !== channel) queueMicrotask(() => {
                if (peers.has(peer)) (peer as StreamChannel & { deliver(data: unknown): void }).deliver(data);
              });
            }
          },
          close: () => { peers.delete(channel); listeners.clear(); },
        };
        Object.assign(channel, { deliver: (data: unknown) => {
          for (const listener of listeners) listener({ data } as MessageEvent<unknown>);
        } });
        peers.add(channel);
        channels.set(name, peers);
        return channel;
      },
    };
    return {
      ports,
      hide() { visibilityState = "hidden"; for (const listener of visibilityListeners) listener(); },
      show() { visibilityState = "visible"; for (const listener of visibilityListeners) listener(); },
      page(kind: "pagehide" | "pageshow") { for (const listener of pageListeners.get(kind) ?? []) listener(); },
      advance(ms: number) {
        now += ms;
        for (const [id, timer] of [...timers]) {
          if (timer.due <= now) { timers.delete(id); timer.work(); }
        }
      },
      listenerCount: () => visibilityListeners.size,
      timerCount: () => timers.size,
    };
  }
  return { tab };
}

export async function settleLocks(): Promise<void> {
  for (let step = 0; step < 20; step++) await Promise.resolve();
}

/** Native event delivery with a controlled connection state; satisfies the EventSource port. */
export class StreamFake extends EventTarget {
  readonly addEventListener = super.addEventListener.bind(this) as EventSource["addEventListener"];
  readyState = 1;
  closed = false;
  constructor(readonly url: string) { super(); }
  emit(kind: string, data = "", lastEventId = "") {
    if (this.closed) return;
    this.dispatchEvent(kind === "open" || kind === "error"
      ? new Event(kind)
      : new MessageEvent(kind, { data, lastEventId }));
  }
  close() { this.closed = true; this.readyState = 2; }
}
