import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestJsonIpc } from "../json-ipc.js";

/**
 * Pins `requestJsonIpc`'s client-side settlement against a scripted raw server (no createJsonIpcServer):
 * a reply split across chunks (including a multibyte character), malformed replies, timeout, and
 * replies/closes that arrive after the request already settled. The request owns exactly one
 * settlement; a second one would re-run the reply handling (visible as a duplicated trace).
 */
type Trace = { event: string } & Record<string, unknown>;

let root: string;
let traces: Trace[];
let servers: Server[];
let sockets: Socket[];
let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jini-ipc-settle-"));
  traces = [];
  servers = [];
  sockets = [];
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
  process.env.JINI_JSON_IPC_TRACE = "1";
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (args[0] === "[jini sidecar] json ipc trace") traces.push(args[1] as Trace);
  });
});

afterEach(async () => {
  process.off("unhandledRejection", onUnhandled);
  delete process.env.JINI_JSON_IPC_TRACE;
  vi.restoreAllMocks();
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await rm(root, { force: true, recursive: true });
});

/** Start a raw server; `script` runs once per connection after the request line arrives. */
const serve = async (name: string, script: (socket: Socket) => void): Promise<string> => {
  const socketPath = join(root, `${name}.sock`);
  const server = createNetServer({ allowHalfOpen: true }, (socket) => {
    sockets.push(socket);
    socket.once("data", () => script(socket));
    socket.on("error", () => undefined);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return socketPath;
};
const count = (event: string) => traces.filter((trace) => trace.event === event).length;

describe("requestJsonIpc reply parsing", () => {
  it("assembles a reply split across chunks, including a multibyte character cut mid-sequence", async () => {
    const reply = Buffer.from(`${JSON.stringify({ ok: true, result: { word: "héllo ✓" } })}\n`);
    const cut = reply.indexOf(0xc3) + 1; // between the two bytes of "é"
    const socketPath = await serve("split", (socket) => {
      socket.write(reply.subarray(0, 5));
      setTimeout(() => socket.write(reply.subarray(5, cut)), 15);
      setTimeout(() => socket.write(reply.subarray(cut)), 30);
    });
    await expect(requestJsonIpc({ socketPath, payload: { type: "X" } }, { timeoutMs: 2000 })).resolves.toEqual({ word: "héllo ✓" });
    expect(count("client.data")).toBe(3);
    expect(count("client.response_success")).toBe(1);
  });

  it("a reply with no newline yet is not parsed; the close then rejects as incomplete", async () => {
    const socketPath = await serve("nonl", (socket) => socket.end(JSON.stringify({ ok: true, result: 1 })));
    await expect(requestJsonIpc({ socketPath, payload: {} }, { timeoutMs: 2000 })).rejects.toThrow(`IPC connection closed before a complete response: ${socketPath}`);
    expect(count("client.response_success")).toBe(0);
  });

  it("rejects a malformed reply line with the parse error and never traces a response", async () => {
    const socketPath = await serve("bad", (socket) => socket.write("{not json\n"));
    await expect(requestJsonIpc({ socketPath, payload: {} }, { timeoutMs: 2000 })).rejects.toBeInstanceOf(SyntaxError);
    await sleep(30);
    expect(count("client.response_success") + count("client.response_error")).toBe(0);
    expect(unhandled).toEqual([]);
  });
});

describe("requestJsonIpc single settlement", () => {
  it("settles once when more reply bytes arrive after the first complete line", async () => {
    const socketPath = await serve("extra", (socket) => {
      socket.write(`${JSON.stringify({ ok: true, result: "first" })}\n`);
      setTimeout(() => socket.write(`${JSON.stringify({ ok: true, result: "second" })}\n`), 40);
      setTimeout(() => socket.end(), 80);
    });
    await expect(requestJsonIpc({ socketPath, payload: {} }, { timeoutMs: 2000 })).resolves.toBe("first");
    await sleep(150);
    expect(count("client.response_success")).toBe(1);
    expect(count("client.data")).toBeGreaterThanOrEqual(2);
    expect(unhandled).toEqual([]);
  });

  it("a reply that lands after the timeout neither settles again nor surfaces an unhandled error", async () => {
    const socketPath = await serve("late", (socket) => {
      setTimeout(() => {
        if (!socket.destroyed) socket.write(`${JSON.stringify({ ok: true, result: "late" })}\n`);
      }, 120);
    });
    await expect(requestJsonIpc({ socketPath, payload: { type: "L" } }, { timeoutMs: 40 })).rejects.toThrow(`IPC request timed out: ${socketPath}`);
    await sleep(250);
    expect(count("client.timeout")).toBe(1);
    expect(count("client.response_success") + count("client.response_error")).toBe(0);
    expect(unhandled).toEqual([]);
  });

  it("a close after a settled reply does not clear or re-arm anything observable", async () => {
    const socketPath = await serve("closeafter", (socket) => socket.end(`${JSON.stringify({ ok: false, error: { code: "E", message: "nope" } })}\n`));
    await expect(requestJsonIpc({ socketPath, payload: {} }, { timeoutMs: 2000 })).rejects.toMatchObject({ code: "E", message: "nope" });
    await sleep(50);
    expect(count("client.response_error")).toBe(1);
    expect(count("client.socket_close")).toBe(1);
    expect(unhandled).toEqual([]);
  });
});
