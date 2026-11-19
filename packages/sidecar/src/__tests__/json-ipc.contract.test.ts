import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, createServer as createNetServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonIpcServer, jsonIpcError, prepareIpcPath, requestJsonIpc } from "../json-ipc.js";

/**
 * Real-socket contract tests (no node:net mock): the live-vs-stale socket decision that guards
 * against unlinking a running daemon's socket, the exact trace vocabulary + detail shape, and the
 * frame-size boundary. Complements index.test.ts, which drives the error paths through mocks.
 */
type Trace = { event: string } & Record<string, unknown>;

let root: string;
let traces: Trace[];
let trace = false;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jini-ipc-contract-"));
  traces = [];
  trace = false;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (args[0] === "[jini sidecar] json ipc trace") traces.push(args[1] as Trace);
  });
});

// FU-B (Codex on F2): every spawned child is registered at spawn time and killed + reaped in teardown,
// so a readiness wait that stalls or an assertion that fails never leaves a process behind.
const children: ChildProcess[] = [];
const reap = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await exited;
};

afterEach(async () => {
  for (const child of children.splice(0)) await reap(child);
  vi.restoreAllMocks();
  await rm(root, { force: true, recursive: true });
});

const listen = (path: string) =>
  new Promise<Server>((resolve, reject) => {
    const server = createNetServer((socket) => socket.end());
    server.once("error", reject);
    server.listen(path, () => resolve(server));
  });
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));
const rawExchange = (socketPath: string, data: string) =>
  new Promise<string>((resolve, reject) => {
    let out = "";
    const socket = createConnection(socketPath, () => socket.write(data));
    socket.on("data", (chunk) => (out += chunk.toString()));
    socket.on("close", () => resolve(out));
    socket.on("error", reject);
  });

describe("prepareIpcPath — live socket is never treated as stale", () => {
  it("leaves a socket with a live listener in place (connect → not stale)", async () => {
    const socketPath = join(root, "live.sock");
    const live = await listen(socketPath);
    try {
      await prepareIpcPath({ socketPath });
      expect(existsSync(socketPath)).toBe(true);
      await expect(rawExchange(socketPath, "")).resolves.toBe("");
    } finally {
      await close(live);
    }
  });

  it("a second server on a live socket fails with EADDRINUSE and the first keeps serving", async () => {
    const socketPath = join(root, "dup.sock");
    const first = await createJsonIpcServer({ handler: async () => "first", socketPath }, { trace });
    try {
      await expect(createJsonIpcServer({ handler: async () => "second", socketPath }, { trace })).rejects.toMatchObject({ code: "EADDRINUSE" });
      await expect(requestJsonIpc({ socketPath, payload: {} }, { trace })).resolves.toBe("first");
    } finally {
      await first.close();
    }
    expect(existsSync(socketPath)).toBe(false);
  });

  it("unlinks a STALE socket (file present, nobody listening → ECONNREFUSED) so a new server can bind", async () => {
    const socketPath = join(root, "stale.sock");
    const child = spawn(process.execPath, ["-e", `require("node:net").createServer().listen(${JSON.stringify(socketPath)}, () => console.log("up"))`], { stdio: ["ignore", "pipe", "inherit"] });
    children.push(child);
    // Bounded readiness: a spawn error, an early exit or 5 s of silence fails the test instead of hanging.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("child never reported ready")), 5_000);
      const settle = (fn: () => void) => () => { clearTimeout(timer); fn(); };
      child.stdout!.once("data", settle(resolve));
      child.once("error", (error) => settle(() => reject(error))());
      child.once("exit", (code) => settle(() => reject(new Error(`child exited before ready (${code})`)))());
    });
    child.removeAllListeners("exit");
    await reap(child);
    expect(lstatSync(socketPath).isSocket()).toBe(true);
    const server = await createJsonIpcServer({ handler: async () => "reborn", socketPath }, { trace });
    try {
      await expect(requestJsonIpc({ socketPath, payload: {} }, { trace })).resolves.toBe("reborn");
    } finally {
      await server.close();
    }
  });

  it("leaves a regular (non-socket) file at the path alone", async () => {
    const socketPath = join(root, "plain.sock");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(socketPath, "keep");
    await prepareIpcPath({ socketPath });
    expect(existsSync(socketPath)).toBe(true);
  });

  it("creates the parent directory and is a no-op on a missing path", async () => {
    const socketPath = join(root, "nested", "deeper", "x.sock");
    await prepareIpcPath({ socketPath });
    expect(existsSync(join(root, "nested", "deeper"))).toBe(true);
    expect(existsSync(socketPath)).toBe(false);
  });
});

describe("jsonIpcError", () => {
  it.each([
    [Object.assign(new Error("boom"), { code: "EPIPE" }), { code: "EPIPE", message: "boom" }],
    [Object.assign(new Error("n"), { code: 42 }), { code: "42", message: "n" }],
    [Object.assign(new Error("u"), { code: undefined }), { message: "u" }],
    [Object.assign(new Error("z"), { code: null }), { message: "z" }],
    [null, { message: "null" }],
    ["text", { message: "text" }],
    [{ code: "X" }, { code: "X", message: "[object Object]" }],
  ])("%j → %j (no code key unless a code is present)", (error, expected) => {
    expect(jsonIpcError({ error })).toStrictEqual(expected);
  });
});

describe("per-instance trace gate", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["yes", true],
    ["0", false],
    ["TRUE", false],
    ["", false],
    [undefined, false],
  ])("%j → tracing %s", async (value, enabled) => {
    trace = value === "1" || value === "true" || value === "yes";
    const socketPath = join(root, "gate.sock");
    const server = await createJsonIpcServer({ handler: async () => 1, socketPath }, { trace });
    try {
      await requestJsonIpc({ socketPath, payload: { type: "PING" } }, { trace });
    } finally {
      await server.close();
    }
    expect(traces.length > 0).toBe(enabled);
  });
});

const traceId = expect.stringMatching(new RegExp(`^ipc-${process.pid}-\\d+$`));
const base = (socketit("keeps enabled and disabled tracing independent across server and request instances", async () => {
  const enabledPath = join(root, "enabled.sock"), disabledPath = join(root, "disabled.sock");
  const enabled = await createJsonIpcServer({ socketPath: enabledPath, handler: () => "enabled" }, { trace: true });
  const disabled = await createJsonIpcServer({ socketPath: disabledPath, handler: () => "disabled" });
  try {
    expect(await requestJsonIpc({ socketPath: enabledPath, payload: {} }, { trace: true })).toBe("enabled");
    expect(await requestJsonIpc({ socketPath: disabledPath, payload: {} })).toBe("disabled");
    expect(traces.some(item => item.socketPath === enabledPath && item.event === "server.handler_success")).toBe(true);
    expect(traces.some(item => item.socketPath === enabledPath && item.event === "client.response_success")).toBe(true);
    expect(traces.filter(item => item.socketPath === disabledPath)).toEqual([]);
    traces = [];
    expect(await requestJsonIpc({ socketPath: disabledPath, payload: {} }, { trace: true })).toBe("disabled");
    expect(await requestJsonIpc({ socketPath: enabledPath, payload: {} })).toBe("enabled");
    expect(traces.some(item => item.socketPath === disabledPath && item.event.startsWith("server."))).toBe(false);
    expect(traces.some(item => item.socketPath === enabledPath && item.event === "client.connect_start")).toBe(false);
  } finally { await enabled.close(); await disabled.close(); }
});Path: string) => ({ socketPath, traceId, durationMs: expect.any(Number) });



describe("trace vocabulary and details", () => {

  it("a successful round trip emits the full client+server sequence with summarised messages", async () => {
    trace = true;
    const socketPath = join(root, "ok.sock");
    const server = await createJsonIpcServer({ handler: async () => ({ fine: true }), socketPath }, { trace });
    const payload = { type: "EVAL", input: { zeta: 1, alpha: 2, mid: 3 } };
    try {
      await expect(requestJsonIpc({ socketPath, payload }, { trace, timeoutMs: 2000 })).resolves.toEqual({ fine: true });
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      await server.close();
    }
    const summary = { type: "EVAL", hasInput: true, inputKeys: ["alpha", "mid", "zeta"] };
    const byEvent = (event: string) => traces.find((trace) => trace.event === event);
    expect(byEvent("client.connect_start")).toEqual({ event: "client.connect_start", message: summary, socketPath, timeoutMs: 2000, traceId });
    expect(byEvent("server.connection")).toEqual({ event: "server.connection", socketPath, traceId });
    expect(byEvent("client.connected")).toEqual({ event: "client.connected", ...base(socketPath), message: summary });
    expect(byEvent("client.write_start")).toEqual({ event: "client.write_start", ...base(socketPath), message: summary, bytes: Buffer.byteLength(`${JSON.stringify(payload)}\n`) });
    expect(byEvent("client.write_callback")).toEqual({ event: "client.write_callback", ...base(socketPath), message: summary });
    expect(byEvent("server.data")).toEqual({ event: "server.data", ...base(socketPath), bytes: expect.any(Number) });
    expect(byEvent("server.frame_parsed")).toEqual({ event: "server.frame_parsed", ...base(socketPath), message: summary, frameBytes: Buffer.byteLength(JSON.stringify(payload)) });
    expect(byEvent("server.handler_start")).toEqual({ event: "server.handler_start", ...base(socketPath), message: summary });
    expect(byEvent("server.handler_success")).toEqual({ event: "server.handler_success", ...base(socketPath), message: summary });
    expect(byEvent("client.data")).toEqual({ event: "client.data", ...base(socketPath), message: summary, bytes: expect.any(Number) });
    expect(byEvent("client.response_success")).toEqual({ event: "client.response_success", ...base(socketPath), message: summary });
    expect(byEvent("server.socket_close")).toEqual({ event: "server.socket_close", ...base(socketPath) });
    expect(byEvent("client.socket_close")).toEqual({ event: "client.socket_close", ...base(socketPath), message: summary });
    // Client and server allocate distinct, increasing ids from one module counter.
    const clientId = Number(String(byEvent("client.connect_start")!.traceId).split("-").pop());
    const serverId = Number(String(byEvent("server.connection")!.traceId).split("-").pop());
    expect(serverId).toBe(clientId + 1);
    for (const trace of traces) {
      if (trace.durationMs === undefined) continue;
      expect(trace.durationMs as number).toBeGreaterThanOrEqual(0);
      expect(trace.durationMs as number).toBeLessThan(10_000);
    }
  });

  it.each([
    ["string", "hi", { type: "string" }],
    ["null", null, { type: "object" }],
    ["number type field", { type: 7 }, { type: "number" }],
    ["primitive input", { type: "T", input: 5 }, { type: "T", hasInput: true, inputType: "number" }],
    ["null input", { type: "T", input: null }, { type: "T", hasInput: true, inputType: "object" }],
    ["no input", { type: "T" }, { type: "T" }],
  ])("summarises a %s message as %j", async (_label, payload, summary) => {
    trace = true;
    const socketPath = join(root, "sum.sock");
    const server = await createJsonIpcServer({ handler: async () => 0, socketPath }, { trace });
    try {
      await requestJsonIpc({ socketPath, payload }, { trace });
    } finally {
      await server.close();
    }
    expect(traces.find((trace) => trace.event === "client.connect_start")?.message).toStrictEqual(summary);
  });

  it("handler failure: peer gets HANDLER_ERROR + requestId; trace and log carry only redacted detail", async () => {
    trace = true;
    const socketPath = join(root, "fail.sock");
    const server = await createJsonIpcServer({ handler: async () => { throw new Error("db at /secret/path failed"); }, socketPath }, { trace });
    let rejection: (Error & { code?: string; requestId?: string }) | undefined;
    try {
      await requestJsonIpc({ socketPath, payload: { type: "X" } }, { trace }).catch((error) => (rejection = error));
    } finally {
      await server.close();
    }
    expect(rejection?.message).toBe("internal error");
    expect(rejection?.code).toBe("HANDLER_ERROR");
    const failed = traces.find((trace) => trace.event === "server.handler_failed");
    expect(failed).toEqual({ event: "server.handler_failed", ...base(socketPath), message: { type: "X" }, error: "Error" });
    expect(rejection?.requestId).toBe(failed?.traceId);
    for (const text of ["/secret/path", "json-ipc.contract.test"]) expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(text);
    expect(traces.find((trace) => trace.event === "client.response_error")).toEqual({ event: "client.response_error", ...base(socketPath), message: { type: "X" }, error: "internal error" });
  });

  it("unparseable frame: SyntaxError message relayed without a code; parse-failed trace", async () => {
    trace = true;
    const socketPath = join(root, "parse.sock");
    const server = await createJsonIpcServer({ handler: async () => 0, socketPath }, { trace });
    let reply = "";
    try {
      reply = await rawExchange(socketPath, "{nope\n");
    } finally {
      await server.close();
    }
    const parsed = JSON.parse(reply);
    expect(parsed.ok).toBe(false);
    expect(Object.keys(parsed.error)).toEqual(["message"]);
    expect(traces.find((trace) => trace.event === "server.frame_parse_failed")).toEqual({ event: "server.frame_parse_failed", ...base(socketPath), error: "SyntaxError", frameBytes: 5 });
  });

  it("client rejects with the server's message and no code when the error has none", async () => {
    const socketPath = join(root, "nocode.sock");
    const fake = createNetServer((socket) => socket.on("data", () => socket.end(`${JSON.stringify({ ok: false, error: { message: "plain" } })}\n`)));
    await new Promise<void>((resolve) => fake.listen(socketPath, () => resolve()));
    try {
      const error = (await requestJsonIpc({ socketPath, payload: {} }, { trace }).catch((e) => e)) as Error & { code?: string; requestId?: string };
      expect(error.message).toBe("plain");
      expect("code" in error).toBe(false);
      expect("requestId" in error).toBe(false);
    } finally {
      await close(fake);
    }
  });

  it("client falls back to 'IPC request failed' when an error response has no error object", async () => {
    trace = true;
    const socketPath = join(root, "bare.sock");
    const fake = createNetServer((socket) => socket.on("data", () => socket.end(`${JSON.stringify({ ok: false })}\n`)));
    await new Promise<void>((resolve) => fake.listen(socketPath, () => resolve()));
    try {
      await expect(requestJsonIpc({ socketPath, payload: {} }, { trace })).rejects.toThrow(/^IPC request failed$/);
    } finally {
      await close(fake);
    }
    expect(traces.find((trace) => trace.event === "client.response_error")?.error).toBe("IPC request failed");
  });

  it("client timeout trace carries timeoutMs; error names the socket", async () => {
    trace = true;
    const socketPath = join(root, "slow.sock");
    const server = await createJsonIpcServer({ handler: () => new Promise(() => undefined), socketPath }, { trace });
    try {
      await expect(requestJsonIpc({ socketPath, payload: { type: "S" } }, { trace, timeoutMs: 50 })).rejects.toThrow(`IPC request timed out: ${socketPath}`);
    } finally {
      await server.close();
    }
    expect(traces.find((trace) => trace.event === "client.timeout")).toEqual({ event: "client.timeout", ...base(socketPath), message: { type: "S" }, timeoutMs: 50 });
  });

  it("client socket error (no listener) is traced and rejects with ENOENT", async () => {
    trace = true;
    const socketPath = join(root, "absent.sock");
    await expect(requestJsonIpc({ socketPath, payload: {} }, { trace })).rejects.toMatchObject({ code: "ENOENT" });
    expect(traces.find((trace) => trace.event === "client.socket_error")).toEqual({ event: "client.socket_error", ...base(socketPath), message: { type: "undefined" }, error: "Error(ENOENT)" });
  });

  it("idle timeout trace carries idleTimeoutMs and drops the connection", async () => {
    trace = true;
    const socketPath = join(root, "idle.sock");
    const server = await createJsonIpcServer({ handler: async () => 0, socketPath }, { trace, idleTimeoutMs: 30 });
    try {
      await expect(rawExchange(socketPath, "{\"partial\":")).resolves.toBe("");
    } finally {
      await server.close();
    }
    expect(traces.find((trace) => trace.event === "server.idle_timeout")).toEqual({ event: "server.idle_timeout", ...base(socketPath), idleTimeoutMs: 30 });
  });
});

describe("frame size boundary (SEC-004)", () => {
  it("accepts a frame of exactly maxFrameBytes and refuses maxFrameBytes + 1", async () => {
    trace = true;
    const socketPath = join(root, "size.sock");
    const frame = `${JSON.stringify({ pad: "x".repeat(20) })}\n`;
    const limit = Buffer.byteLength(frame);
    const server = await createJsonIpcServer({ handler: async () => "ok", socketPath }, { trace, maxFrameBytes: limit });
    try {
      expect(JSON.parse(await rawExchange(socketPath, frame))).toEqual({ ok: true, result: "ok" });
      const refused = JSON.parse(await rawExchange(socketPath, ` ${frame}`));
      expect(refused).toEqual({ ok: false, error: { code: "FRAME_TOO_LARGE", message: "request frame exceeds the maximum size" } });
    } finally {
      await server.close();
    }
    expect(traces.find((trace) => trace.event === "server.frame_too_large")).toEqual({ event: "server.frame_too_large", ...base(socketPath), maxFrameBytes: limit, receivedBytes: limit + 1 });
  });

  it("an empty frame (bare newline) is answered as a parse failure, not left waiting", async () => {
    const socketPath = join(root, "empty.sock");
    const server = await createJsonIpcServer({ handler: async () => "never", socketPath }, { trace, idleTimeoutMs: 5_000 });
    try {
      const reply = JSON.parse(await rawExchange(socketPath, "\n"));
      expect(reply.ok).toBe(false);
      expect(typeof reply.error.message).toBe("string");
    } finally {
      await server.close();
    }
  });

  it("a payload larger than the socket buffer traces client.drain", async () => {
    trace = true;
    const socketPath = join(root, "drain.sock");
    const server = await createJsonIpcServer({ handler: async () => "ok", socketPath }, { trace, maxFrameBytes: 8_000_000 });
    try {
      await requestJsonIpc({ socketPath, payload: { blob: "x".repeat(4_000_000) } }, { trace, timeoutMs: 10_000 });
    } finally {
      await server.close();
    }
    expect(traces.find((trace) => trace.event === "client.drain")).toEqual({ event: "client.drain", ...base(socketPath), message: { type: "undefined" } });
  });

  it("ignores a second frame on the same connection (one request per connection)", async () => {
    const socketPath = join(root, "two.sock");
    const handler = vi.fn(async ({ message }: { message: unknown }) => message);
    const server = await createJsonIpcServer({ handler, socketPath }, { trace });
    try {
      const reply = await rawExchange(socketPath, "{\"n\":1}\n{\"n\":2}\n");
      expect(reply.trim().split("\n").map((line) => JSON.parse(line))).toEqual([{ ok: true, result: { n: 1 } }]);
    } finally {
      await server.close();
    }
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
