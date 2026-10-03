import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll as after, afterEach, beforeAll as before, test } from "vitest";

import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

import { pgliteLowMemoryStartParams } from "../pglite/index.js";
import { PGLITE_SOCKET_FILE } from "../core/index.js";
import { PgliteSocketServer } from "../pglite/index.js";

/**
 * @file The vendored PGlite socket server's fixes from upstream (see `pglite-server/NOTICE.md`),
 * each proven against a real in-memory PGlite over a real Unix socket: the extra ReadyForQuery that
 * shifted answers, the queue wedge, the idle-in-transaction timeout, `runExclusive`, transaction
 * affinity between two clients, and the connection cap. Data-dir, lock and crash behaviour:
 * `pglite-owner.test.ts`.
 */

let db: PGlite;
let dir: string | undefined;
let server: PgliteSocketServer | undefined;
const clients: pg.Client[] = [];

before(async () => {
  db = await PGlite.create({ startParams: pgliteLowMemoryStartParams(PGlite) });
});

after(async () => {
  await db.close();
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.end().catch(() => {});
  await server?.stop();
  server = undefined;
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

async function serve(options: { idleInTransactionTimeoutMs?: number; maxConnections?: number } = {}): Promise<void> {
  const socketDir = mkdtempSync(join(tmpdir(), "pgs-"));
  dir = socketDir;
  server = new PgliteSocketServer({ db, path: join(socketDir, PGLITE_SOCKET_FILE), ...options });
  await server.start();
}

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ host: dir, port: 5432, user: "postgres", database: "postgres" });
  client.on("error", () => {});
  await client.connect();
  // Only once connected: end() on a refused client never resolves.
  clients.push(client);
  return client;
}

const values = async (client: pg.Client, text: string): Promise<string[]> =>
  (await client.query<{ v: string }>(text)).rows.map((row) => row.v);

/** Resolves with "pending" if `promise` has not settled within `ms`. */
const settledWithin = <T>(promise: Promise<T>, ms: number): Promise<T | "pending"> =>
  Promise.race([promise, new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), ms))]);

// ---- raw wire helpers: a failing extended-protocol query (Parse OK, Bind fails) ----

const cstr = (text: string) => Buffer.from(`${text}\0`);
function frame(type: string, body: Buffer): Buffer {
  const out = Buffer.alloc(5 + body.length);
  out.write(type, 0);
  out.writeInt32BE(4 + body.length, 1);
  body.copy(out, 5);
  return out;
}
const PARSE = frame("P", Buffer.concat([cstr(""), cstr("SELECT $1::int"), Buffer.from([0, 0])]));
const BIND_BAD = frame(
  "B",
  Buffer.concat([cstr(""), cstr(""), Buffer.from([0, 0, 0, 1, 0, 0, 0, 8]), Buffer.from("notanint"), Buffer.from([0, 0])])
);
const EXECUTE = frame("E", Buffer.concat([cstr(""), Buffer.alloc(4)]));
const SYNC = frame("S", Buffer.alloc(0));

function frameTypes(bytes: Buffer): string[] {
  const types: string[] = [];
  let rest = bytes;
  while (rest.length >= 5 && rest.length >= 1 + rest.readInt32BE(1)) {
    types.push(String.fromCharCode(rest[0]!));
    rest = rest.subarray(1 + rest.readInt32BE(1));
  }
  return types;
}

/** Startup over a raw socket, then the failing P/B/E/S; the frame types answered to the latter. */
async function rawFailingExtendedQuery(): Promise<string[]> {
  const socket = net.createConnection(join(dir!, PGLITE_SOCKET_FILE));
  const startup = Buffer.concat([Buffer.alloc(8), cstr("user"), cstr("postgres"), cstr("database"), cstr("postgres"), Buffer.from([0])]);
  startup.writeInt32BE(startup.length, 0);
  startup.writeInt32BE(196608, 4);
  let received = Buffer.alloc(0);
  let sent = false;
  socket.on("data", (data) => {
    received = Buffer.concat([received, data]);
    if (!sent && frameTypes(received).includes("Z")) {
      sent = true;
      socket.write(Buffer.concat([PARSE, BIND_BAD, EXECUTE, SYNC]));
    }
  });
  socket.write(startup);
  await new Promise((resolve) => setTimeout(resolve, 800));
  socket.destroy();
  const types = frameTypes(received);
  return types.slice(types.indexOf("Z") + 1);
}

test("RED evidence: PGlite core itself answers a failing Bind with ReadyForQuery, then Sync with another", async () => {
  const types: string[] = [];
  for (const message of [PARSE, BIND_BAD, EXECUTE, SYNC]) {
    types.push(...frameTypes(Buffer.from(await db.execProtocolRaw(new Uint8Array(message)))));
  }
  // Postgres sends `1 E Z`. If this ever becomes `1 E Z`, PGlite fixed it and the filter can go.
  assert.deepEqual(types, ["1", "E", "Z", "Z"]);
});

test("over the socket a failing extended query gets exactly one ReadyForQuery (1 E Z)", async () => {
  await serve();
  // ParameterStatus (`S`) reports may ride along; what matters is ONE ReadyForQuery, last.
  assert.deepEqual(
    (await rawFailingExtendedQuery()).filter((type) => type !== "S"),
    ["1", "E", "Z"]
  );
});

test("a failed parameterized query with queries queued behind it: each later query gets its own answer", async () => {
  await serve();
  const client = await connect();
  // Queued, not awaited: node-postgres sends the next query on the first ReadyForQuery, so an
  // extra one would complete `a` with no rows and shift every answer after it.
  const failed = client.query("SELECT $1::int AS v", ["notanint"]).then(
    () => "no error",
    (error: Error) => error.message
  );
  const answers = Promise.all(
    ["a", "b", "c", "d"].map((want) =>
      client.query<{ v: string }>(`SELECT '${want}'::text AS v`).then((result) => result.rows[0]?.v ?? "(no rows)")
    )
  );
  assert.match(await failed, /invalid input syntax/);
  assert.deepEqual(await answers, ["a", "b", "c", "d"]);
  await client.query("BEGIN");
  await assert.rejects(client.query("SELECT $1::int AS v", ["notanint"]));
  const afterRollback = client.query("ROLLBACK").then(() => values(client, "SELECT 'e'::text AS v"));
  assert.deepEqual(await afterRollback, ["e"]);
});

test("a throwing PGlite call fails only that message's connection; the queue keeps serving (no wedge)", async () => {
  await serve();
  const a = await connect();
  const b = await connect();
  const original = db.execProtocolRawStream.bind(db);
  let armed = true;
  db.execProtocolRawStream = async (message, options) => {
    if (armed) {
      armed = false;
      throw new Error("injected PGlite failure");
    }
    return original(message, options);
  };
  try {
    await assert.rejects(a.query("SELECT 1"));
    // Upstream never cleared its busy flag here: this query and every later one hung forever.
    assert.deepEqual(await settledWithin(values(b, "SELECT 'still served'::text AS v"), 5000), ["still served"]);
    const fresh = await connect();
    assert.deepEqual(await values(fresh, "SELECT 'new client'::text AS v"), ["new client"]);
  } finally {
    db.execProtocolRawStream = original;
  }
});

test("idle in a transaction past the timeout: that client is cut off with 25P03 and its writes roll back", async () => {
  await serve({ idleInTransactionTimeoutMs: 300 });
  const idle = await connect();
  const other = await connect();
  let fatal: (Error & { code?: string }) | undefined;
  idle.on("error", (error) => (fatal = error));
  await other.query("CREATE TABLE idle_probe (v text)");
  await idle.query("BEGIN");
  await idle.query("INSERT INTO idle_probe VALUES ('uncommitted')");
  // `other` waits behind the open transaction until the timeout rolls it back.
  const started = Date.now();
  assert.deepEqual(await values(other, "SELECT count(*)::text AS v FROM idle_probe"), ["0"]);
  assert.ok(Date.now() - started >= 250, "the reader waited for the idle transaction");
  await assert.rejects(idle.query("COMMIT"));
  assert.equal(fatal?.code, "25P03");
  await other.query("DROP TABLE idle_probe");
});

test("runExclusive waits for an open client transaction, and clients wait while it runs", async () => {
  await serve();
  const client = await connect();
  // Connected up front: a connection's startup also queues behind runExclusive.
  const reader = await connect();
  await client.query("CREATE TABLE excl_probe (v text)");
  await client.query("BEGIN");
  await client.query("INSERT INTO excl_probe VALUES ('client')");
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  const exclusive = server!.runExclusive(async (pglite) => {
    const seen = (await pglite.query<{ v: string }>("SELECT v FROM excl_probe")).rows.map((row) => row.v);
    await hold;
    await pglite.query("INSERT INTO excl_probe VALUES ('owner')");
    return seen;
  });
  assert.equal(await settledWithin(exclusive, 200), "pending", "no dirty read: it waits for the client's COMMIT");
  await client.query("COMMIT");
  const read = values(reader, "SELECT v FROM excl_probe ORDER BY v");
  assert.equal(await settledWithin(read, 200), "pending", "clients wait while runExclusive runs");
  release();
  assert.deepEqual(await exclusive, ["client"]);
  assert.deepEqual(await read, ["client", "owner"]);
  await reader.query("DROP TABLE excl_probe");
});

test("runExclusive that leaves a transaction open is rolled back and throws", async () => {
  await serve();
  await server!.runExclusive((pglite) => pglite.exec("CREATE TABLE left_open (v int)"));
  await assert.rejects(
    server!.runExclusive(async (pglite) => {
      await pglite.exec("BEGIN; INSERT INTO left_open VALUES (1)");
    }),
    /left a transaction open/
  );
  const client = await connect();
  assert.deepEqual(await values(client, "SELECT count(*)::text AS v FROM left_open"), ["0"]);
  await client.query("DROP TABLE left_open");
});

test("two clients: transactions do not interleave, a rollback leaks nothing, no lost updates", async () => {
  await serve();
  const a = await connect();
  const b = await connect();
  await a.query("CREATE TABLE iso_probe (v text)");
  await a.query("BEGIN");
  await a.query("INSERT INTO iso_probe VALUES ('a1')");
  const meanwhile = values(b, "SELECT v FROM iso_probe ORDER BY v");
  assert.equal(await settledWithin(meanwhile, 200), "pending", "B waits for A's transaction");
  await a.query("INSERT INTO iso_probe VALUES ('a2')");
  await a.query("COMMIT");
  assert.deepEqual(await meanwhile, ["a1", "a2"], "B never sees a partial state");

  await b.query("BEGIN");
  await b.query("INSERT INTO iso_probe VALUES ('b-rolled-back')");
  await b.query("ROLLBACK");
  assert.deepEqual(await values(a, "SELECT v FROM iso_probe ORDER BY v"), ["a1", "a2"]);

  await a.query("CREATE TABLE counter (n int)");
  await a.query("INSERT INTO counter VALUES (0)");
  const bump = async (client: pg.Client, times: number) => {
    for (let i = 0; i < times; i += 1) {
      await client.query("BEGIN");
      const [n] = await values(client, "SELECT n::text AS v FROM counter");
      await client.query("UPDATE counter SET n = $1", [Number(n) + 1]);
      await client.query("COMMIT");
    }
  };
  await Promise.all([bump(a, 40), bump(b, 40)]);
  assert.deepEqual(await values(a, "SELECT n::text AS v FROM counter"), ["80"]);
  await a.query("DROP TABLE iso_probe; DROP TABLE counter");
});

test("a connection past the cap is refused with FATAL 53300", async () => {
  await serve({ maxConnections: 1 });
  await connect();
  await assert.rejects(connect(), (error: Error & { code?: string }) => error.code === "53300");
});
