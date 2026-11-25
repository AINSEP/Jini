import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, createServer as createNetServer, Socket, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClientFacingError } from "@jini-ai/core/contracts/server";
import type { ObservabilityPort } from "@jini-ai/core/contracts/observability";
import { createRecordingLogger, createRecordingReporter } from "@jini-ai/core/errors/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonIpcServer, prepareIpcPath, requestJsonIpc } from "../json-ipc.js";

/**
 * Real-socket contract tests (no node:net mock): the live-vs-stale socket decision that guards
 * against unlinking a running daemon's socket, the exact trace vocabulary + detail shape, and the
 * frame-size boundary. Complements index.test.ts, which drives the error paths through mocks.
 */
type Trace = { event: string } & Record<string, unknown>;

let root: string;
let traces: Trace[];
let previousTrace: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jini-ipc-contract-"));
  traces = [];
  previousTrace = process.env.JINI_JSON_IPC_TRACE;
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
  if (previousTrace === undefined) delete process.env.JINI_JSON_IPC_TRACE;
  else process.env.JINI_JSON_IPC_TRACE = previousTrace;
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
    const first = await createJsonIpcServer({ handler: async () => "first", socketPath });
    try {
      await expect(createJsonIpcServer({ handler: async () => "second", socketPath })).rejects.toMatchObject({ code: "EADDRINUSE" });
      await expect(requestJsonIpc({ socketPath, payload: {} })).resolves.toBe("first");
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
    const server = await createJsonIpcServer({ handler: async () => "reborn", socketPath });
    try {
      await expect(requestJsonIpc({ socketPath, payload: {} })).resolves.toBe("reborn");
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

describe("JINI_JSON_IPC_TRACE gate", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["yes", true],
    ["0", false],
    ["TRUE", false],
    ["", false],
    [undefined, false],
  ])("%j → tracing %s", async (value, enabled) => {
    if (value === undefined) delete process.env.JINI_JSON_IPC_TRACE;
    else process.env.JINI_JSON_IPC_TRACE = value;
    const socketPath = join(root, "gate.sock");
    const server = await createJsonIpcServer({ handler: async () => 1, socketPath });
    try {
      await requestJsonIpc({ socketPath, payload: { type: "PING" } });
    } finally {
      await server.close();
    }
    expect(traces.length > 0).toBe(enabled);
  });
});

const traceId = expect.stringMatching(new RegExp(`^ipc-${process.pid}-\\d+$`));
const base = (socketPath: string) => ({ socketPath, traceId, durationMs: expect.any(Number) });

describe("trace vocabulary and details", () => {

  it("a successful round trip emits the full client+server sequence with summarised messages", async () => {
    process.env.JINI_JSON_IPC_TRACE = "yes";
    const socketPath = join(root, "ok.sock");
    const server = await createJsonIpcServer({ handler: async () => ({ fine: true }), socketPath });
    const payload = { type: "EVAL", input: { zeta: 1, alpha: 2, mid: 3 } };
    try {
      await expect(requestJsonIpc({ socketPath, payload }, { timeoutMs: 2000 })).resolves.toEqual({ fine: true });
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
    process.env.JINI_JSON_IPC_TRACE = "1";
    const socketPath = join(root, "sum.sock");
    const server = await createJsonIpcServer({ handler: async () => 0, socketPath });
    try {
      await requestJsonIpc({ socketPath, payload });
    } finally {
      await server.close();
    }
    expect(traces.find((trace) => trace.event === "client.connect_start")?.message).toStrictEqual(summary);
  });

  it("handler failure: peer gets HANDLER_ERROR + requestId; trace and log carry only redacted detail", async () => {
    process.env.JINI_JSON_IPC_TRACE = "1";
    const socketPath = join(root, "fail.sock");
    const server = await createJsonIpcServer({ handler: async () => { throw new Error("db at /secret/path failed"); }, socketPath });
    let rejection: (Error & { code?: string; requestId?: string }) | undefined;
    try {
      await requestJsonIpc({ socketPath, payload: { type: "X" } }).catch((error) => (rejection = error));
    } finally {
      await server.close();
    }
    expect(rejection?.message, "Handler failures explain the retry and request ID").toBe("The sidecar could not finish this request. Try again, and report the request ID if it keeps failing.");
    expect(rejection?.code).toBe("HANDLER_ERROR");
    const failed = traces.find((trace) => trace.event === "server.handler_failed");
    expect(failed).toEqual({ event: "server.handler_failed", ...base(socketPath), message: { type: "X" }, error: "Error" });
    expect(rejection?.requestId).toBe(failed?.traceId);
    for (const text of ["/secret/path", "json-ipc.contract.test"]) expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(text);
    expect(traces.find((trace) => trace.event === "client.response_error"), "The client trace preserves the safe handler words").toEqual({ event: "client.response_error", ...base(socketPath), message: { type: "X" }, error: "The sidecar could not finish this request. Try again, and report the request ID if it keeps failing." });
  });

  it("unparseable frame: fixed BAD_FRAME refusal; parse-failed trace", async () => {
    process.env.JINI_JSON_IPC_TRACE = "1";
    const socketPath = join(root, "parse.sock");
    const server = await createJsonIpcServer({ handler: async () => 0, socketPath });
    let reply = "";
    try {
      reply = await rawExchange(socketPath, "{nope\n");
    } finally {
      await server.close();
    }
    const parsed = JSON.parse(reply);
    expect(parsed).toEqual({ ok: false, error: { code: "BAD_FRAME", message: "The sidecar could not read the request frame. Send one line of valid JSON." } });
    expect(traces.find((trace) => trace.event === "server.frame_parse_failed")).toEqual({ event: "server.frame_parse_failed", ...base(socketPath), error: "SyntaxError", frameBytes: 5 });
  });

  it("client rejects with the server's message and no code when the error has none", async () => {
    const socketPath = join(root, "nocode.sock");
    const fake = createNetServer((socket) => socket.on("data", () => socket.end(`${JSON.stringify({ ok: false, error: { message: "plain" } })}\n`)));
    await new Promise<void>((resolve) => fake.listen(socketPath, () => resolve()));
    try {
      const error = (await requestJsonIpc({ socketPath, payload: {} }).catch((e) => e)) as Error & { code?: string; requestId?: string };
      expect(error.message).toBe("plain");
      expect("code" in error).toBe(false);
      expect("requestId" in error).toBe(false);
    } finally {
      await close(fake);
    }
  });

  it("client falls back to 'IPC request failed' when an error response has no error object", async () => {
    process.env.JINI_JSON_IPC_TRACE = "1";
    const socketPath = join(root, "bare.sock");
    const fake = createNetServer((socket) => socket.on("data", () => socket.end(`${JSON.stringify({ ok: false })}\n`)));
    await new Promise<void>((resolve) => fake.listen(socketPath, () => resolve()));
    try {
      await expect(requestJsonIpc({ socketPath, payload: {} })).rejects.toThrow(/^IPC request failed$/);
    } finally {
      await close(fake);
    }
    expect(traces.find((trace) => trace.event === "client.response_error")?.error).toBe("IPC request failed");
  });

  it("client timeout trace carries timeoutMs; error names the socket", async () => {
    process.env.JINI_JSON_IPC_TRACE = "1";
    const socketPath = join(root, "slow.sock");
    const server = await createJsonIpcServer({ handler: () => new Promise(() => undefined), socketPath });
    try {
      await expect(requestJsonIpc({ socketPath, payload: { type: "S" } }, { timeoutMs: 50 })).rejects.toThrow(`IPC request timed out: ${socketPath}`);
    } finally {
      await server.close();
    }
    expect(traces.find((trace) => trace.event === "client.timeout")).toEqual({ event: "client.timeout", ...base(socketPath), message: { type: "S" }, timeoutMs: 50 });
  });

  it("client socket error (no listener) is traced and rejects with ENOENT", async () => {
    process.env.JINI_JSON_IPC_TRACE = "1";
    const socketPath = join(root, "absent.sock");
    await expect(requestJsonIpc({ socketPath, payload: {} })).rejects.toMatchObject({ code: "ENOENT" });
    expect(traces.find((trace) => trace.event === "client.socket_error")).toEqual({ event: "client.socket_error", ...base(socketPath), message: { type: "undefined" }, error: "Error(ENOENT)" });
  });

  it("idle timeout trace carries idleTimeoutMs and drops the connection", async () => {
    process.env.JINI_JSON_IPC_TRACE = "1";
    const socketPath = join(root, "idle.sock");
    const server = await createJsonIpcServer({ handler: async () => 0, socketPath }, { idleTimeoutMs: 30 });
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
    process.env.JINI_JSON_IPC_TRACE = "1";
    const socketPath = join(root, "size.sock");
    const frame = `${JSON.stringify({ pad: "x".repeat(20) })}\n`;
    const limit = Buffer.byteLength(frame);
    const server = await createJsonIpcServer({ handler: async () => "ok", socketPath }, { maxFrameBytes: limit });
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
    const server = await createJsonIpcServer({ handler: async () => "never", socketPath }, { idleTimeoutMs: 5_000 });
    try {
      const reply = JSON.parse(await rawExchange(socketPath, "\n"));
      expect(reply.ok).toBe(false);
      expect(typeof reply.error.message).toBe("string");
    } finally {
      await server.close();
    }
  });

  it("a payload larger than the socket buffer traces client.drain", async () => {
    process.env.JINI_JSON_IPC_TRACE = "1";
    const socketPath = join(root, "drain.sock");
    const server = await createJsonIpcServer({ handler: async () => "ok", socketPath }, { maxFrameBytes: 8_000_000 });
    try {
      await requestJsonIpc({ socketPath, payload: { blob: "x".repeat(4_000_000) } }, { timeoutMs: 10_000 });
    } finally {
      await server.close();
    }
    expect(traces.find((trace) => trace.event === "client.drain")).toEqual({ event: "client.drain", ...base(socketPath), message: { type: "undefined" } });
  });

  it("ignores a second frame on the same connection (one request per connection)", async () => {
    const socketPath = join(root, "two.sock");
    const handler = vi.fn(async ({ message }: { message: unknown }) => message);
    const server = await createJsonIpcServer({ handler, socketPath });
    try {
      const reply = await rawExchange(socketPath, "{\"n\":1}\n{\"n\":2}\n");
      expect(reply.trim().split("\n").map((line) => JSON.parse(line))).toEqual([{ ok: true, result: { n: 1 } }]);
    } finally {
      await server.close();
    }
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ---- Reporter mode (additive `errors` option) -------------------------------------------------
const NOW = "2026-01-01T00:00:00.000Z";
const ERR = "ERR-0123-4567-89AB-CDEF";
type IpcRejection = Error & { code?: string; reason?: string; requestId?: string };
type Started = { name: string; attributes?: Readonly<Record<string, string | number>> };

/** A real reporter over recording ports, plus a tracker that keeps what each operation started with. */
const reporterHost = (extra: { methodOf?: (required: { message: unknown }) => string | undefined } = {}) => {
  const recording = createRecordingReporter({ ids: [ERR, "ERR-0000-0000-0000-0002"], iso: NOW });
  const started: Started[] = [];
  const observability: Pick<ObservabilityPort, "trackOperation"> = {
    trackOperation: (input) => {
      started.push(input);
      return { run: (fn) => fn(), end: () => undefined };
    },
  };
  const sidecarLog = createRecordingLogger();
  const errors = { reporter: recording.reporter, observability, refusalCode: "HANDLER_ERROR" as const, ...extra };
  return { ...recording, started, errors, sidecarLog };
};
const failureOf = async (socketPath: string, payload: unknown = { type: "X" }) =>
  (await requestJsonIpc({ socketPath, payload }, { timeoutMs: 2000 }).then(() => undefined, (error) => error)) as IpcRejection | undefined;
const consoleLines = () => vi.mocked(console.error).mock.calls;

describe("reporter mode (errors option)", () => {
  it("a handler throw yields one report and the ERR- id in requestId", async () => {
    delete process.env.JINI_JSON_IPC_TRACE;
    const host = reporterHost();
    const socketPath = join(root, "report.sock");
    const server = await createJsonIpcServer({ handler: async () => { throw new Error("db at /secret/path failed"); }, socketPath }, { errors: host.errors, logger: host.sidecarLog.logger });
    let rejection: IpcRejection | undefined;
    try {
      rejection = await failureOf(socketPath);
    } finally {
      await server.close();
    }
    expect(rejection?.requestId).toBe(ERR);
    expect(rejection?.message, "the ERR id is in the words a person reads").toContain(ERR);
    expect(rejection?.message).not.toContain("/secret/path");
    expect(consoleLines(), "reporter mode never writes the legacy console line").toHaveLength(0);
    expect(host.entries.filter((entry) => entry.level === "error"), "the reporter's logger gets the one incident record").toHaveLength(1);
    expect(host.reports, "the tracker gets one report").toHaveLength(1);
    expect(host.sidecarLog.entries, "the sidecar's own logger adds no second incident").toEqual([]);
  });

  it("without errors the legacy reply keeps traceId as requestId and logs once", async () => {
    delete process.env.JINI_JSON_IPC_TRACE;
    const socketPath = join(root, "legacy.sock");
    const server = await createJsonIpcServer({ handler: async () => { throw new Error("db at /secret/path failed"); }, socketPath });
    let rejection: IpcRejection | undefined;
    try {
      rejection = await failureOf(socketPath);
    } finally {
      await server.close();
    }
    expect(rejection?.code).toBe("HANDLER_ERROR");
    expect(rejection?.requestId).toMatch(new RegExp(`^ipc-${process.pid}-\\d+$`));
    expect(rejection?.reason).toBeUndefined();
    expect(consoleLines()).toHaveLength(1);
    expect(String(consoleLines()[0]?.[0])).toBe(`[@jini-ai/sidecar] json-ipc handler failed (traceId=${rejection?.requestId})`);
    expect(JSON.stringify(consoleLines())).not.toContain("/secret/path");
  });

  it("without errors an injected logger receives the one legacy incident write instead of the console", async () => {
    delete process.env.JINI_JSON_IPC_TRACE;
    const log = createRecordingLogger();
    const socketPath = join(root, "legacy-logger.sock");
    const server = await createJsonIpcServer({ handler: async () => { throw new Error("boom"); }, socketPath }, { logger: log.logger });
    try {
      await failureOf(socketPath);
    } finally {
      await server.close();
    }
    expect(consoleLines()).toHaveLength(0);
    expect(log.entries.filter((entry) => entry.level === "error")).toHaveLength(1);
  });

  it("the ipc.method attribute is the bounded label, never message text", async () => {
    const socketPath = join(root, "method.sock");
    const secretText = "tool run with secret words";
    const candidates: Array<[string, (required: { message: unknown }) => string | undefined, string]> = [
      ["a 500-character candidate", () => "m".repeat(500), "unknown"],
      ["raw message text", ({ message }) => (message as { type: string }).type, "unknown"],
      ["a label with a leading digit", () => "1tool", "unknown"],
      ["a throwing label function", () => { throw new Error("label broke"); }, "unknown"],
      ["no label", () => undefined, "unknown"],
      ["a valid label", () => "tool.run:v2", "tool.run:v2"],
    ];
    for (const [label, methodOf, expected] of candidates) {
      const host = reporterHost({ methodOf });
      const server = await createJsonIpcServer({ handler: async () => "fine", socketPath }, { errors: host.errors });
      try {
        await expect(requestJsonIpc({ socketPath, payload: { type: secretText, input: { apiKey: "k" } } })).resolves.toBe("fine");
      } finally {
        await server.close();
      }
      expect(host.started, label).toHaveLength(1);
      expect(host.started[0]?.name).toBe("ipc.handle");
      expect(host.started[0]?.attributes?.["ipc.method"], label).toBe(expected);
      const published = JSON.stringify(host.started);
      for (const forbidden of [secretText, "apiKey", socketPath]) expect(published, `${label} must not publish ${forbidden}`).not.toContain(forbidden);
      expect(host.started[0]?.attributes?.["ipc.trace_id"]).toMatch(new RegExp(`^ipc-${process.pid}-\\d+$`));
      expect(host.started[0]?.attributes?.["ipc.trace_id"]).not.toBe(ERR);
    }
  });

  it("a peer gone before the reply produces no second incident", async () => {
    const host = reporterHost();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let handlerStarted!: () => void;
    const started = new Promise<void>((resolve) => (handlerStarted = resolve));
    const socketPath = join(root, "gone.sock");
    const server = await createJsonIpcServer({ handler: async () => { handlerStarted(); await gate; throw new Error("late failure"); }, socketPath }, { errors: host.errors, logger: host.sidecarLog.logger });
    try {
      const client = createConnection(socketPath, () => client.write('{"type":"X"}\n'));
      client.on("error", () => undefined);
      await started;
      client.destroy();
      await new Promise((resolve) => setTimeout(resolve, 100));
      release();
      await vi.waitFor(() => expect(host.sidecarLog.entries.filter((entry) => entry.level === "warn")).toHaveLength(1));
    } finally {
      await server.close();
    }
    expect(host.sidecarLog.entries).toEqual([{ level: "warn", message: "[@jini-ai/sidecar] json-ipc could not write the reply; the peer is gone." }]);
    expect(host.reports, "only the handler's own failure is reported").toHaveLength(1);
    expect(host.entries.filter((entry) => entry.level === "error")).toHaveLength(1);
  });

  it("a synchronous write failure on the success reply is contained with a warning and no incident", async () => {
    const host = reporterHost();
    const realEnd = Socket.prototype.end;
    vi.spyOn(Socket.prototype, "end").mockImplementation(function (this: Socket, ...args: unknown[]) {
      if (typeof args[0] === "string" && args[0].includes('"ok":true')) throw new Error("EPIPE: write after peer reset");
      return (realEnd as (...inner: unknown[]) => Socket).apply(this, args);
    });
    const socketPath = join(root, "sync-write.sock");
    const server = await createJsonIpcServer({ handler: async () => "fine", socketPath }, { errors: host.errors, logger: host.sidecarLog.logger });
    try {
      await expect(requestJsonIpc({ socketPath, payload: {} }, { timeoutMs: 2000 })).rejects.toThrow(/closed before a complete response/);
      await vi.waitFor(() => expect(host.sidecarLog.entries).toHaveLength(1));
    } finally {
      await server.close();
    }
    expect(host.sidecarLog.entries[0]).toEqual({ level: "warn", message: "[@jini-ai/sidecar] json-ipc could not write the reply; the peer is gone." });
    expect(JSON.stringify(host.sidecarLog.entries)).not.toContain("EPIPE");
    expect(host.reports).toHaveLength(0);
  });

  it("HANDLER_ERROR code is kept in reporter mode", async () => {
    const host = reporterHost();
    const socketPath = join(root, "code.sock");
    const server = await createJsonIpcServer({ handler: async () => { throw new Error("x"); }, socketPath }, { errors: host.errors });
    let rejection: IpcRejection | undefined;
    try {
      rejection = await failureOf(socketPath);
    } finally {
      await server.close();
    }
    expect(rejection?.code).toBe("HANDLER_ERROR");
    expect(rejection?.reason, "an incident has no refusal reason").toBeUndefined();
    expect(rejection?.requestId).toBe(ERR);
  });

  it("a refusal keeps HANDLER_ERROR, carries its code as reason with safe words, and has no requestId", async () => {
    const host = reporterHost();
    const socketPath = join(root, "refusal.sock");
    const refusal = new ClientFacingError({ apiError: { code: "WIDGET_MISSING", message: "That widget does not exist." } });
    const server = await createJsonIpcServer({ handler: async () => { throw refusal; }, socketPath }, { errors: host.errors });
    let rejection: IpcRejection | undefined;
    try {
      rejection = await failureOf(socketPath);
    } finally {
      await server.close();
    }
    expect(rejection?.code).toBe("HANDLER_ERROR");
    expect(rejection?.reason).toBe("WIDGET_MISSING");
    expect(rejection?.message).toBe("That widget does not exist.");
    expect("requestId" in (rejection as object)).toBe(false);
    expect(host.reports).toHaveLength(0);
    expect(host.entries).toHaveLength(0);
  });

  it("a successful handler replies {ok,result} untouched and reports nothing", async () => {
    const host = reporterHost();
    const socketPath = join(root, "success.sock");
    const server = await createJsonIpcServer({ handler: async ({ message }) => ({ echo: message }), socketPath }, { errors: host.errors });
    try {
      await expect(rawExchange(socketPath, '{"n":1}\n')).resolves.toBe(`${JSON.stringify({ ok: true, result: { echo: { n: 1 } } })}\n`);
    } finally {
      await server.close();
    }
    expect(host.reports).toHaveLength(0);
    expect(host.entries).toHaveLength(0);
  });

  it("an unserializable success result becomes an incident, not a half-written reply", async () => {
    const host = reporterHost();
    const socketPath = join(root, "bigint.sock");
    const server = await createJsonIpcServer({ handler: async () => 10n, socketPath }, { errors: host.errors });
    let rejection: IpcRejection | undefined;
    try {
      rejection = await failureOf(socketPath);
    } finally {
      await server.close();
    }
    expect(rejection?.code).toBe("HANDLER_ERROR");
    expect(rejection?.requestId).toBe(ERR);
    expect(host.reports).toHaveLength(1);
  });

  it("keeps the oversized-frame and idle-connection behavior, and never calls the handler for them", async () => {
    const host = reporterHost();
    const handler = vi.fn(async () => "never");
    const socketPath = join(root, "bounds.sock");
    const server = await createJsonIpcServer({ handler, socketPath }, { errors: host.errors, maxFrameBytes: 16, idleTimeoutMs: 40 });
    try {
      const refused = JSON.parse(await rawExchange(socketPath, `${JSON.stringify({ pad: "x".repeat(40) })}\n`));
      expect(refused).toEqual({ ok: false, error: { code: "FRAME_TOO_LARGE", message: "request frame exceeds the maximum size" } });
      await expect(rawExchange(socketPath, '{"partial":')).resolves.toBe("");
      expect(JSON.parse(await rawExchange(socketPath, "{nope\n"))).toEqual({ ok: false, error: { code: "BAD_FRAME", message: "The sidecar could not read the request frame. Send one line of valid JSON." } });
    } finally {
      await server.close();
    }
    expect(handler).not.toHaveBeenCalled();
    expect(host.reports).toHaveLength(0);
  });

  it("traces go to the injected logger without request summaries or exception text", async () => {
    process.env.JINI_JSON_IPC_TRACE = "1";
    const host = reporterHost();
    const socketPath = join(root, "traces.sock");
    const server = await createJsonIpcServer({ handler: async () => { throw new Error("db at /secret/path failed"); }, socketPath }, { errors: host.errors, logger: host.sidecarLog.logger });
    try {
      await failureOf(socketPath, { type: "SECRET_TYPE", input: { secretKey: 1 } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      await server.close();
    }
    expect(traces.filter((trace) => trace.event.startsWith("server."))).toEqual([]);
    const serverEvents = host.sidecarLog.entries.map((entry) => (entry.meta as { event: string }).event);
    expect(serverEvents).toEqual(expect.arrayContaining(["server.connection", "server.handler_start", "server.handler_failed", "server.socket_close"]));
    const written = JSON.stringify(host.sidecarLog.entries);
    for (const forbidden of ["SECRET_TYPE", "secretKey", "/secret/path", "db at"]) expect(written).not.toContain(forbidden);
  });
});
