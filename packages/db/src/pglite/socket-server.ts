/*
 * Derived from @electric-sql/pglite-socket 0.2.11 (packages/pglite-socket/src/index.ts),
 * Copyright Electric DB Limited, licensed under the Apache License, Version 2.0 (see
 * `LICENSE.pglite-socket` at the package root). Modified 2026-09-28: see `NOTICE.md` at the
 * package root for every change from upstream.
 */
import { createServer, type Server, type Socket } from "node:net";

import type { PGlite } from "@electric-sql/pglite";

/**
 * @file One PGlite served to several processes over a Unix socket, speaking the Postgres wire
 * protocol.
 *
 * PGlite is ONE backend session: every connection's messages go through one queue, one at a time,
 * and while a client has a transaction open only that client's messages run (every other client —
 * even a new connection's startup — waits). Changes from upstream, each covered by
 * `__tests__/pglite-socket-server.test.ts`:
 *
 * 1. ReadyForQuery filter. PGlite 0.5.8 answers an error in an extended-protocol message
 *    (Parse/Bind/Execute) with ErrorResponse + ReadyForQuery at once, and the later Sync with a
 *    second ReadyForQuery. Postgres sends exactly one, at Sync; the extra one shifts every later
 *    answer on that connection by one query. So `Z` frames are dropped from the answer to any typed
 *    message except Sync, Query, FunctionCall and CopyDone/CopyFail (which end a simple-protocol
 *    exchange). Version-specific: `@electric-sql/pglite` is pinned and a test asserts the pin.
 * 2. No wedge. Upstream returned from the queue loop without clearing its "processing" flag when
 *    PGlite threw, and no later message from anyone was ever run. Here the job fails alone.
 * 3. Idle-in-transaction timeout. A client that holds a transaction open without sending anything
 *    for `idleInTransactionTimeoutMs` is sent FATAL 25P03 and disconnected; its transaction rolls back.
 * 4. {@link PgliteSocketServer.runExclusive}: the owning process's only way to the database while it
 *    serves (a direct `pglite.query` would run inside some client's open transaction: dirty read,
 *    lost write). Runs when no client transaction is open; nothing else runs meanwhile.
 * 5. Unix socket only, no TCP; disconnect rollbacks go through the queue; per-connection messages
 *    are handled strictly in order; a refused connection gets a protocol ErrorResponse.
 */

const SSL_REQUEST_CODE = 80877103;
const GSSENC_REQUEST_CODE = 80877104;
const CANCEL_REQUEST_CODE = 80877102;
const PROTOCOL_3 = 196608;

/** Typed messages after which PGlite's ReadyForQuery is legitimate: Sync, Query, FunctionCall, CopyDone, CopyFail. */
const ENDS_EXCHANGE = new Set(["S", "Q", "F", "c", "f"].map((c) => c.charCodeAt(0)));
const READY_FOR_QUERY = "Z".charCodeAt(0);

/** The id of work that belongs to no connection ({@link PgliteSocketServer.runExclusive}). */
const OWNER_JOB = 0;

export interface PgliteSocketServerOptions {
  /** The PGlite this server owns. Nothing else may query it while the server runs. */
  db: PGlite;
  /** Unix socket path. Must not exist (the owner removes a stale one first). */
  path: string;
  /** Default 8. Further connections get FATAL 53300 and are closed. */
  maxConnections?: number | undefined;
  /** A client idle inside an open transaction this long is disconnected and rolled back. Default 30 s; 0 = never. */
  idleInTransactionTimeoutMs?: number | undefined;
  log?: ((message: string) => void) | undefined;
}

interface Job {
  owner: number;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

/** A Postgres ErrorResponse frame. */
export function errorResponseFrame(severity: "ERROR" | "FATAL", code: string, message: string): Buffer {
  const field = (tag: string, value: string) => Buffer.concat([Buffer.from(tag), Buffer.from(`${value}\0`)]);
  const body = Buffer.concat([field("S", severity), field("V", severity), field("C", code), field("M", message), Buffer.from([0])]);
  const head = Buffer.alloc(5);
  head.write("E", 0);
  head.writeInt32BE(4 + body.length, 1);
  return Buffer.concat([head, body]);
}

/**
 * Passes whole frames from PGlite's streamed answer to `emit`, minus ReadyForQuery when `dropReady`.
 * Frames may arrive split across chunks, so a partial frame waits for the rest.
 */
function frameFilter(dropReady: boolean, emit: (data: Uint8Array) => void) {
  let pending = Buffer.alloc(0);
  return {
    push(chunk: Uint8Array): void {
      if (!dropReady) return emit(chunk);
      pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
      const keep: Buffer[] = [];
      while (pending.length >= 5) {
        const size = 1 + pending.readInt32BE(1);
        if (pending.length < size) break;
        if (pending[0] !== READY_FOR_QUERY) keep.push(pending.subarray(0, size));
        pending = pending.subarray(size);
      }
      if (keep.length > 0) emit(new Uint8Array(Buffer.concat(keep)));
    },
  };
}

/**
 * Half-closes `socket`, then destroys it: end() alone lets a FATAL frame written just before reach
 * the client, but a client that never closes its side would hold `server.close()` open forever.
 */
function endSocket(socket: Socket, destroyNow: boolean): void {
  socket.end();
  if (destroyNow) socket.destroy();
  else setTimeout(() => socket.destroy(), 1000).unref();
}

/**
 * The one queue in front of PGlite. While a transaction is open, only the job owner that opened it
 * is served; everything else waits in arrival order.
 */
class PgliteQueue {
  private readonly jobs: Job[] = [];
  private draining = false;
  private lastOwner: number | null = null;
  private idleTimer: NodeJS.Timeout | undefined;
  /** Whose idle transaction {@link idleTimer} is counting; a timer already running is not restarted. */
  private idleTimerOwner: number | null = null;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly db: PGlite,
    private readonly idleInTransactionTimeoutMs: number,
    private readonly onIdleInTransaction: (owner: number) => void
  ) {}

  enqueue(owner: number, run: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.jobs.push({ owner, run, resolve, reject });
      void this.drain();
    });
  }

  /** Rejects every queued (not running) job of `owner`. */
  dropQueued(owner: number, reason: Error): void {
    for (let i = this.jobs.length - 1; i >= 0; i -= 1) {
      if (this.jobs[i]!.owner === owner) this.jobs.splice(i, 1)[0]!.reject(reason);
    }
  }

  /** Rolls back `owner`'s open transaction, as the next job that owner may run. */
  rollbackIfOwned(owner: number): Promise<void> {
    return this.enqueue(owner, async () => {
      if (this.db.isInTransaction() && this.lastOwner === owner) await this.db.exec("ROLLBACK");
    });
  }

  /** Resolves once nothing is running (queued jobs that wait on a transaction do not count). */
  whenIdle(): Promise<void> {
    return this.draining ? new Promise((resolve) => this.idleWaiters.push(resolve)) : Promise.resolve();
  }

  get length(): number {
    return this.jobs.length;
  }

  private next(): Job | undefined {
    if (this.db.isInTransaction() && this.lastOwner !== null) {
      const index = this.jobs.findIndex((job) => job.owner === this.lastOwner);
      return index === -1 ? undefined : this.jobs.splice(index, 1)[0];
    }
    return this.jobs.shift();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let job = this.next(); job !== undefined; job = this.next()) {
        this.stopTimer();
        try {
          await job.run();
          job.resolve();
        } catch (error) {
          // Upstream returned here with the loop still marked busy: nothing was ever run again.
          job.reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          this.lastOwner = job.owner;
        }
      }
    } finally {
      this.draining = false;
      this.armIdleTimer();
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  private armIdleTimer(): void {
    if (this.idleInTransactionTimeoutMs <= 0 || !this.db.isInTransaction() || this.lastOwner === null) return;
    const owner = this.lastOwner;
    if (this.idleTimerOwner === owner) return;
    this.stopTimer();
    this.idleTimerOwner = owner;
    this.idleTimer = setTimeout(() => {
      this.idleTimerOwner = null;
      if (!this.draining && this.db.isInTransaction() && this.lastOwner === owner) this.onIdleInTransaction(owner);
    }, this.idleInTransactionTimeoutMs);
    this.idleTimer.unref();
  }

  stopTimer(): void {
    clearTimeout(this.idleTimer);
    this.idleTimerOwner = null;
  }
}

/** One client connection: splits the byte stream into messages and runs them in order. */
class Connection {
  private buffer = Buffer.alloc(0);
  private started = false;
  private closed = false;
  /** Every chunk's handling chained, so a connection's messages never interleave with themselves. */
  private chain: Promise<void> = Promise.resolve();

  constructor(
    readonly id: number,
    private readonly socket: Socket,
    private readonly db: PGlite,
    private readonly queue: PgliteQueue,
    private readonly onClosed: (connection: Connection) => void
  ) {
    socket.setNoDelay(true);
    socket.on("data", (data) => {
      this.chain = this.chain.then(() => this.handle(data)).catch((error: unknown) => this.close(error));
    });
    socket.on("error", (error) => this.close(error));
    socket.on("close", () => this.close());
  }

  /** Sends `frame` (an ErrorResponse) if the socket is still writable, then closes the connection. */
  terminate(frame: Buffer): void {
    if (!this.closed && this.socket.writable) this.socket.write(frame);
    this.close();
  }

  /**
   * Idempotent: drops this connection's queued messages and rolls back its open transaction.
   * `destroyNow` skips the grace period a just-written FATAL frame needs.
   */
  close(_reason?: unknown, destroyNow = false): void {
    if (this.closed) return;
    this.closed = true;
    const gone = new Error("connection closed");
    this.queue.dropQueued(this.id, gone);
    void this.queue.rollbackIfOwned(this.id).catch(() => {});
    endSocket(this.socket, destroyNow);
    this.onClosed(this);
  }

  private async handle(data: Buffer): Promise<void> {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, data]);
    for (;;) {
      const message = this.nextMessage();
      if (message === undefined) return;
      if (message === "skip") continue;
      await this.execute(message);
      if (this.closed) return;
    }
  }

  /**
   * The next complete message; `"skip"` for a request answered here (SSL/GSS: "no"; cancel:
   * dropped, PGlite has no backend to signal); `undefined` when more bytes are needed.
   */
  private nextMessage(): { bytes: Buffer; startup: boolean } | "skip" | undefined {
    if (!this.started) {
      if (this.buffer.length < 8) return undefined;
      const size = this.buffer.readInt32BE(0);
      const code = this.buffer.readInt32BE(4);
      if (this.buffer.length < size) return undefined;
      const bytes = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      if (code === SSL_REQUEST_CODE || code === GSSENC_REQUEST_CODE) {
        this.socket.write("N");
        return "skip";
      }
      if (code === CANCEL_REQUEST_CODE) {
        this.close();
        return undefined;
      }
      if (code !== PROTOCOL_3) throw new Error(`unsupported protocol ${code}`);
      this.started = true;
      return { bytes, startup: true };
    }
    if (this.buffer.length < 5) return undefined;
    const size = 1 + this.buffer.readInt32BE(1);
    if (this.buffer.length < size) return undefined;
    const bytes = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return { bytes, startup: false };
  }

  private execute(message: { bytes: Buffer; startup: boolean }): Promise<void> {
    const dropReady = !message.startup && !ENDS_EXCHANGE.has(message.bytes[0]!);
    const out = frameFilter(dropReady, (data) => {
      if (!this.closed && this.socket.writable) this.socket.write(data);
    });
    const bytes = new Uint8Array(message.bytes);
    return this.queue.enqueue(this.id, () =>
      this.db.runExclusive(() => this.db.execProtocolRawStream(bytes, { onRawData: (chunk) => out.push(chunk) }))
    );
  }
}

export class PgliteSocketServer {
  private server: Server | null = null;
  private readonly connections = new Map<number, Connection>();
  private readonly queue: PgliteQueue;
  private nextId = 1;
  private readonly maxConnections: number;

  constructor(private readonly options: PgliteSocketServerOptions) {
    this.maxConnections = options.maxConnections ?? 8;
    this.queue = new PgliteQueue(options.db, options.idleInTransactionTimeoutMs ?? 30_000, (id) => {
      options.log?.(`connection #${id} idle in transaction; rolling back`);
      this.connections
        .get(id)
        ?.terminate(errorResponseFrame("FATAL", "25P03", "terminating connection due to idle-in-transaction timeout"));
    });
  }

  get path(): string {
    return this.options.path;
  }

  async start(): Promise<void> {
    if (this.server !== null) throw new Error("socket server already started");
    await this.options.db.waitReady;
    const server = createServer((socket) => this.accept(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.path, () => {
        server.off("error", reject);
        resolve();
      });
    });
    server.on("error", (error) => this.options.log?.(`socket server error: ${error.message}`));
  }

  /**
   * Runs `fn` with the database to itself: after any open client transaction ends, before the next
   * queued client message. `fn` must not leave a transaction open (it is rolled back and this throws).
   */
  runExclusive<T>(fn: (db: PGlite) => Promise<T>): Promise<T> {
    let result: T;
    const db = this.options.db;
    return this.queue
      .enqueue(OWNER_JOB, async () => {
        try {
          result = await fn(db);
        } finally {
          if (db.isInTransaction()) {
            await db.exec("ROLLBACK");
            throw new Error("runExclusive(fn) left a transaction open; it was rolled back");
          }
        }
      })
      .then(() => result);
  }

  stats(): { connections: number; queued: number } {
    return { connections: this.connections.size, queued: this.queue.length };
  }

  /** Closes every connection (their transactions roll back) and the listener; waits for running work. */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const connection of [...this.connections.values()]) connection.close(undefined, true);
    this.queue.stopTimer();
    this.queue.dropQueued(OWNER_JOB, new Error("socket server stopped"));
    if (server !== null) await new Promise<void>((resolve) => server.close(() => resolve()));
    await this.queue.whenIdle();
  }

  private accept(socket: Socket): void {
    if (this.server === null || this.connections.size >= this.maxConnections) {
      socket.write(errorResponseFrame("FATAL", "53300", "sorry, too many clients already"));
      endSocket(socket, false);
      return;
    }
    const connection = new Connection(this.nextId++, socket, this.options.db, this.queue, (closed) =>
      this.connections.delete(closed.id)
    );
    this.connections.set(connection.id, connection);
  }
}
