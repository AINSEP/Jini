import { EventEmitter } from "node:events";
import type { Serializable } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { createNodeIpcChannel } from "../supervisor-node.js";

class Peer extends EventEmitter {
  connected = true;
  sent: Serializable[] = [];
  other?: Peer;
  send(message: Serializable, callback: (error: Error | null) => void): boolean {
    this.sent.push(message);
    queueMicrotask(() => this.other?.emit("message", message));
    callback(null);
    return true;
  }
}

describe("native inherited IPC", () => {
  it("preserves an explicitly public refusal reason without echoing private handler details", async () => {
    const parent = new Peer(); const child = new Peer(); parent.other = child; child.other = parent;
    const reason = "An older server still owns this scope. Restart the site.";
    const client = createNodeIpcChannel({ peer: parent });
    const server = createNodeIpcChannel({ peer: child }, { handle: async () => {
      throw Object.assign(new Error("private-credential"), { refusalReason: reason });
    } });
    try {
      await expect(client.request({ payload: "register" })).rejects.toMatchObject({ message: reason, refusalReason: reason });
      expect(JSON.stringify(child.sent)).not.toContain("private-credential");
    } finally { client.dispose({}); server.dispose({}); }
  });

  it("ignores malformed or unbounded public refusal reasons", async () => {
    const parent = new Peer(); const child = new Peer(); parent.other = child; child.other = parent;
    const client = createNodeIpcChannel({ peer: parent });
    const server = createNodeIpcChannel({ peer: child }, { handle: async payload => {
      throw Object.assign(new Error("private-credential"), { refusalReason: payload });
    } });
    try {
      for (const reason of ["", 42, "x".repeat(1025)]) {
        await expect(client.request({ payload: reason })).rejects.toThrow("IPC request refused");
      }
      expect(JSON.stringify(child.sent)).not.toContain("private-credential");
    } finally { client.dispose({}); server.dispose({}); }
  });

  it("requests are bound to their child and reject stale replies", async () => {
    const a = new Peer(); const b = new Peer();
    const first = createNodeIpcChannel({ peer: a });
    const second = createNodeIpcChannel({ peer: b });
    const result = first.request({ payload: "private" });
    const envelope = a.sent[0] as { id: string };
    b.emit("message", { jiniIpc: 1, kind: "reply", id: envelope.id, ok: true, payload: "foreign" });
    a.emit("message", { jiniIpc: 1, kind: "reply", id: "stale", ok: true, payload: "stale" });
    a.emit("message", { jiniIpc: 1, kind: "reply", id: envelope.id, ok: true, payload: "own" });
    expect(await result).toBe("own");
    first.dispose({}); second.dispose({});
  });

  it("disconnect releases pending requests without exposing payloads", async () => {
    const peer = new Peer(); const channel = createNodeIpcChannel({ peer });
    const result = channel.request({ payload: { token: "never-in-errors" } });
    peer.connected = false; peer.emit("disconnect");
    await expect(result).rejects.toThrow("IPC disconnected");
    await expect(channel.request({ payload: "never-in-errors" })).rejects.not.toThrow("never-in-errors");
    channel.dispose({});
    expect(peer.listenerCount("message")).toBe(0);
  });

  it("timeouts and capacity bound unavailable main processes", async () => {
    vi.useFakeTimers();
    const peer = new Peer(); const channel = createNodeIpcChannel({ peer }, { timeoutMs: 25, maxPending: 1 });
    try {
      const result = channel.request({ payload: "credential" });
      const rejection = expect(result).rejects.toThrow("IPC request timed out");
      await expect(channel.request({ payload: "overflow" })).rejects.toThrow("IPC capacity");
      await vi.advanceTimersByTimeAsync(25); await rejection;
    } finally { channel.dispose({}); vi.useRealTimers(); }
  });

  it("an oversized request is a capacity error rather than a lost connection", async () => {
    const peer = new Peer(); const channel = createNodeIpcChannel({ peer });
    try {
      await expect(channel.request({ payload: "x".repeat(1024 * 1024) })).rejects.toThrow("IPC envelope too large");
      expect(peer.sent).toHaveLength(0);
    } finally { channel.dispose({}); }
  });

  it("a child handler returns only its result and redacts failures", async () => {
    const parent = new Peer(); const child = new Peer(); parent.other = child; child.other = parent;
    const client = createNodeIpcChannel({ peer: parent });
    const server = createNodeIpcChannel({ peer: child }, { handle: async payload => {
      if (payload === "bad") throw new Error("private-secret");
      return "ready";
    } });
    try {
      expect(await client.request({ payload: "scope" })).toBe("ready");
      await expect(client.request({ payload: "bad" })).rejects.toThrow("IPC request refused");
      expect(JSON.stringify(child.sent)).not.toContain("private-secret");
    } finally { client.dispose({}); server.dispose({}); }
  });

  it("a busy receiver refuses excess work instead of making a live main look disconnected", async () => {
    const parent = new Peer(); const child = new Peer(); parent.other = child; child.other = parent;
    let release!: (value: string) => void;
    const held = new Promise<string>(resolve => { release = resolve; });
    const client = createNodeIpcChannel({ peer: parent });
    const server = createNodeIpcChannel({ peer: child }, { maxPending: 1, handle: () => held });
    try {
      const first = client.request({ payload: "first" });
      await expect(client.request({ payload: "overflow" })).rejects.toThrow("IPC request refused");
      release("ready"); expect(await first).toBe("ready");
    } finally { client.dispose({}); server.dispose({}); }
  });
});
