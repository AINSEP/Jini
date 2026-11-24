import { describe, expect, it } from "vitest";
import { createPreloadSubscriber, type PreloadIpcListenerPort, type PreloadIpcHandler } from "../index.js";

/** A fake `ipcRenderer` keyed by channel, with identity-based removal like Electron's EventEmitter. */
function fakeIpcRenderer(): PreloadIpcListenerPort & { listeners: Map<string, Set<PreloadIpcHandler>> } {
  const listeners = new Map<string, Set<PreloadIpcHandler>>();
  return {
    listeners,
    on: ({ channel, handler }) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(handler);
    },
    removeListener: ({ channel, handler }) => { listeners.get(channel)?.delete(handler); },
  };
}

function emit({ ipc, channel, event, payload }: { ipc: ReturnType<typeof fakeIpcRenderer>; channel: string; event: unknown; payload: unknown }): void {
  for (const handler of [...(ipc.listeners.get(channel) ?? [])]) handler(event, payload);
}

describe("createPreloadSubscriber", () => {
  it("subscribes to the channel and forwards only the payload, never the raw IPC event", () => {
    const ipc = fakeIpcRenderer();
    const subscribe = createPreloadSubscriber({ ipcRenderer: ipc });
    const received: unknown[][] = [];
    subscribe<string>({ channel: "host:find:toggle", listener: (...args: unknown[]) => received.push(args) });
    expect(ipc.listeners.get("host:find:toggle")?.size).toBe(1);
    emit({ ipc, channel: "host:find:toggle", event: { sender: "must not cross the bridge" }, payload: "back" });
    expect(received).toEqual([["back"]]);
  });

  it("cleanup removes exactly the listener it added and leaves other subscribers attached", () => {
    const ipc = fakeIpcRenderer();
    const subscribe = createPreloadSubscriber({ ipcRenderer: ipc });
    const first: unknown[] = [];
    const second: unknown[] = [];
    const offFirst = subscribe({ channel: "host:zoom", listener: (payload) => first.push(payload) });
    subscribe({ channel: "host:zoom", listener: (payload) => second.push(payload) });
    expect(ipc.listeners.get("host:zoom")?.size).toBe(2);
    offFirst();
    expect(ipc.listeners.get("host:zoom")?.size).toBe(1);
    emit({ ipc, channel: "host:zoom", event: {}, payload: "in" });
    expect(first).toEqual([]);
    expect(second).toEqual(["in"]);
  });

  it("cleanup detaches from the same channel it subscribed to", () => {
    const ipc = fakeIpcRenderer();
    const subscribe = createPreloadSubscriber({ ipcRenderer: ipc });
    const received: unknown[] = [];
    const off = subscribe({ channel: "host:a", listener: (payload) => received.push(payload) });
    subscribe({ channel: "host:b", listener: () => undefined });
    off();
    expect(ipc.listeners.get("host:a")?.size).toBe(0);
    expect(ipc.listeners.get("host:b")?.size).toBe(1);
    emit({ ipc, channel: "host:a", event: {}, payload: 1 });
    expect(received).toEqual([]);
  });
});
