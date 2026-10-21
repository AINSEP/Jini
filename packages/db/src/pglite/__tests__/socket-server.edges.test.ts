import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { afterAll, afterEach, beforeAll, test, vi } from "vitest";

import { PGLITE_SOCKET_FILE } from "../../core/index.js";
import { PgliteSocketServer, type SocketServerClient, type SocketServerFactory, type SocketServerListener } from "../socket-server.js";

/**
 * @file The socket server's edges that the main suite does not reach: answers split at arbitrary
 * byte boundaries, a startup that arrives a few bytes at a time, `stop()` with work running or
 * queued, a non-Error thrown inside `runExclusive`, the idle-timeout log line, a second `start()`,
 * and a client that vanishes between sending bytes and their execution (scripted through the
 * injectable listener, with a real PGlite behind it).
 */

let db: PGlite;
let dir: string | undefined;
let server: PgliteSocketServer | undefined;
const clients: pg.Client[] = [];

beforeAll(async () => {
  db = await PGlite.create();
});
afterAll(async () => {
  await db.close();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) await client.end().catch(() => {});
  await server?.stop();
  server = undefined;
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function serve(options: { idleInTransactionTimeoutMs?: number; log?: (message: string) => void } = {}): Promise<PgliteSocketServer> {
  dir = mkdtempSync(join(tmpdir(), "pgs-edge-"));
  server = new PgliteSocketServer({ db, path: join(dir, PGLITE_SOCKET_FILE), ...options });
  await server.start();
  return server;
}

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ host: dir, port: 5432, user: "postgres", database: "postgres" });
  client.on("error", () => {});
  await client.connect();
  clients.push(client);
  return client;
}

/** Resolves after `turns` macrotask turns, letting socket I/O and queued jobs make progress. */
async function settle(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function startupFrame(): Buffer {
  const body = Buffer.from("user\0postgres\0database\0postgres\0\0");
  const frame = Buffer.alloc(8 + body.length);
  frame.writeInt32BE(frame.length, 0);
  frame.writeInt32BE(196608, 4);
  body.copy(frame, 8);
  return frame;
}

function queryFrame(text: string): Buffer {
  const body = Buffer.from(`${text}\0`);
  const frame = Buffer.alloc(5 + body.length);
  frame.write("Q", 0);
  frame.writeInt32BE(4 + body.length, 1);
  body.copy(frame, 5);
  return frame;
}

/** The type bytes of the whole frames in `bytes`, in order. */
function frameTypes(bytes: Buffer): string[] {
  const types: string[] = [];
  for (let offset = 0; bytes.length - offset >= 5; ) {
    const size = 1 + bytes.readInt32BE(offset + 1);
    if (bytes.length - offset < size) break;
    types.push(String.fromCharCode(bytes[offset]!));
    offset += size;
  }
  return types;
}

test("answers PGlite streams in pieces that split frames are reassembled, keeping one ReadyForQuery per exchange", async () => {
  await serve();
  const stream = db.execProtocolRawStream.bind(db);
  vi.spyOn(db, "execProtocolRawStream").mockImplementation((bytes, options) =>
    stream(bytes, {
      ...options,
      onRawData: (chunk) => {
        for (let at = 0; at < chunk.length; at += 3) options?.onRawData(chunk.subarray(at, at + 3));
      },
    })
  );
  const client = await connect();

  // Extended protocol (a parameter): Parse/Bind/Execute answers are filtered, Sync's is kept.
  await assert.rejects(client.query("SELECT $1::int / 0 AS v", [1]), /division by zero/);
  const next = await client.query<{ v: string }>("SELECT $1::text AS v", ["next"]);
  assert.deepEqual(next.rows, [{ v: "next" }], "the failed query's extra ReadyForQuery did not shift this answer");
});

test("a startup whose length arrives before its protocol code waits for the rest", async () => {
  await serve();
  const socket = net.createConnection(join(dir as string, PGLITE_SOCKET_FILE));
  await once(socket, "connect");
  let received = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    received = Buffer.concat([received, chunk]);
  });
  const startup = startupFrame();

  socket.write(startup.subarray(0, 6)); // the length and half the protocol code
  await settle();
  assert.equal(received.length, 0, "nothing is answered from a partial startup");
  socket.write(startup.subarray(6));
  while (!frameTypes(received).includes("Z")) await settle(1);

  assert.deepEqual(frameTypes(received).slice(0, 1), ["R"], "authentication answers the completed startup");
  socket.destroy();
});

test("a non-Error thrown inside runExclusive rejects with an Error carrying its text, and the queue keeps serving", async () => {
  const running = await serve();

  await assert.rejects(
    running.runExclusive(async () => {
      throw "plain refusal"; // a non-Error throw is the case under test
    }),
    (error: unknown) => error instanceof Error && error.message === "plain refusal"
  );
  assert.equal(await running.runExclusive(async (database) => (await database.query<{ v: number }>("SELECT 7 AS v")).rows[0]?.v), 7);
});

test("stop waits for exclusive work that is running, which still completes", async () => {
  const running = await serve();
  const gate = deferred();
  const started = deferred();
  const work = running.runExclusive(async () => {
    started.resolve();
    await gate.promise;
    return "finished";
  });
  await started.promise;

  let stopped = false;
  const stopping = running.stop().then(() => {
    stopped = true;
  });
  await settle();
  assert.equal(stopped, false, "stop is still waiting on the running job");

  gate.resolve();
  await stopping;
  assert.equal(await work, "finished");
  server = undefined;
});

test("stop rejects queued exclusive work and drops a waiting client's queued startup, rolling back the open transaction", async () => {
  const running = await serve();
  await running.runExclusive((database) => database.exec("CREATE TABLE IF NOT EXISTS stop_marks (who text)"));
  const holder = await connect();
  await holder.query("BEGIN");
  await holder.query("INSERT INTO stop_marks VALUES ('holder')");
  // Even a new connection's startup waits while another client's transaction is open.
  const waiter = net.createConnection(join(dir as string, PGLITE_SOCKET_FILE));
  await once(waiter, "connect");
  let waiterAnswer = Buffer.alloc(0);
  waiter.on("data", (chunk: Buffer) => {
    waiterAnswer = Buffer.concat([waiterAnswer, chunk]);
  });
  const waiterClosed = new Promise<void>((resolve) => waiter.on("close", () => resolve()));
  waiter.write(Buffer.concat([startupFrame(), queryFrame("INSERT INTO stop_marks VALUES ('waiter')")]));
  const exclusiveOutcome = running.runExclusive((database) => database.exec("INSERT INTO stop_marks VALUES ('owner')")).then(
    () => undefined,
    (error: unknown) => error
  );
  while (running.stats().queued < 2) await settle(1);
  assert.deepEqual(running.stats(), { connections: 2, queued: 2 }, "the waiter's startup and the owner's job wait on the transaction");

  await running.stop();
  server = undefined;
  await waiterClosed;

  const error = await exclusiveOutcome;
  assert.ok(error instanceof Error && error.message === "socket server stopped");
  assert.equal(waiterAnswer.length, 0, "the waiter was never served");
  assert.equal(db.isInTransaction(), false);
  assert.deepEqual((await db.query<{ who: string }>("SELECT who FROM stop_marks")).rows, [], "nothing from the holder, waiter or owner survived");
  await db.exec("DROP TABLE stop_marks");
});

test("the idle-in-transaction cut-off is reported through the log callback", async () => {
  const lines: string[] = [];
  await serve({ idleInTransactionTimeoutMs: 50, log: (line) => lines.push(line) });
  const client = await connect();
  const gone = new Promise<void>((resolve) => client.on("end", () => resolve()));
  await client.query("BEGIN");

  await gone;
  assert.deepEqual(lines, ["connection #1 idle in transaction; rolling back"]);
  assert.equal(db.isInTransaction(), false);
});

test("a second start is refused while the first listener runs", async () => {
  const running = await serve();
  await assert.rejects(running.start(), (error: unknown) => error instanceof Error && error.message === "socket server already started");
  assert.equal(running.stats().connections, 0);
});

/** A client socket whose events the test emits itself; records what the server writes and how it ends. */
class ScriptedSocket extends EventEmitter implements SocketServerClient {
  writable = true;
  readonly written: Array<Uint8Array | string> = [];
  ended = false;
  setNoDelay(): void {}
  pause(): void {}
  resume(): void {}
  write(data: Uint8Array | string): void {
    this.written.push(data);
  }
  end(): void {
    this.ended = true;
  }
  destroy(): void {
    this.writable = false;
  }
}

/** A listener that never touches the network: `connect` hands the server a scripted socket. */
function scriptedListener(): { createServer: SocketServerFactory; connect: (socket: SocketServerClient) => void } {
  let accept: ((socket: SocketServerClient) => void) | undefined;
  const listener: SocketServerListener = Object.assign(new EventEmitter(), {
    listen: (_path: string, onListening: () => void) => onListening(),
    close: (onClosed: () => void) => onClosed(),
  });
  return {
    createServer: (onAccept) => {
      accept = onAccept;
      return listener;
    },
    connect: (socket) => accept?.(socket),
  };
}

test("bytes from a client that disconnects before they are handled are never run", async () => {
  const scripted = scriptedListener();
  server = new PgliteSocketServer({ db, path: "/unused", createServer: scripted.createServer });
  await server.start();
  const stream = vi.spyOn(db, "execProtocolRawStream");
  const socket = new ScriptedSocket();
  scripted.connect(socket);

  socket.emit("data", startupFrame());
  socket.emit("close"); // gone before the chained handler runs
  await settle();

  assert.equal(stream.mock.calls.length, 0);
  assert.equal(socket.ended, true);
  assert.equal(server.stats().connections, 0);
});

test("a client that disconnects while one message runs has the rest of its pipelined messages discarded", async () => {
  await db.exec("CREATE TABLE IF NOT EXISTS pipeline_marks (n int)");
  const scripted = scriptedListener();
  server = new PgliteSocketServer({ db, path: "/unused", createServer: scripted.createServer });
  await server.start();
  const socket = new ScriptedSocket();
  scripted.connect(socket);
  const stream = db.execProtocolRawStream.bind(db);
  const spy = vi.spyOn(db, "execProtocolRawStream").mockImplementation(async (bytes, options) => {
    if (spy.mock.calls.length === 1) socket.emit("close"); // the client vanishes during its startup
    return stream(bytes, options);
  });

  socket.emit("data", Buffer.concat([startupFrame(), queryFrame("INSERT INTO pipeline_marks VALUES (1)")]));
  while (server.stats().connections > 0 || spy.mock.calls.length === 0) await settle(1);
  await settle();

  assert.equal(spy.mock.calls.length, 1, "only the startup ran");
  vi.restoreAllMocks();
  assert.deepEqual((await db.query("SELECT n FROM pipeline_marks")).rows, []);
  await db.exec("DROP TABLE pipeline_marks");
});
