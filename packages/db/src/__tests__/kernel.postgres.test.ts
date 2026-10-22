import assert from "node:assert/strict";
import { afterAll as after, beforeAll as before, test } from "vitest";

import { sql } from "kysely";
import pg from "pg";

import { openPostgresKernel } from "../kernel/postgres/index.js";
import type { StorageKernel } from "../kernel/port.js";
import { freshPostgresDatabase } from "../testing/postgres-database.js";

/**
 * @file The kernel on a REAL Postgres server through node-postgres: a pool, so two transactions run
 * on two independent connections at once. Proves (1) the hazard `lockKey` exists for is real — two
 * read-then-insert transactions both read the same "latest" row under READ COMMITTED — and (2)
 * `lockKey` removes it. Fails (never skips) when the local server is down.
 */

interface LedgerDb {
  ledger: { id: string; stream: string; seq: number; previous_id: string | null };
}

let first: StorageKernel<LedgerDb>;
let second: StorageKernel<LedgerDb>;

before(async () => {
  const url = freshPostgresDatabase("jini_kernel_pg_fixture");
  first = openPostgresKernel<LedgerDb>({ pg, connectionString: url });
  second = openPostgresKernel<LedgerDb>({ pg, connectionString: url });
  await first.execute(sql`CREATE TABLE ledger (id text PRIMARY KEY, stream text NOT NULL, seq integer NOT NULL, previous_id text)`);
});

after(async () => {
  await first?.close();
  await second?.close();
});

function gate(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

/** Read the stream's latest row, (optionally pause), append after it — the appendRevision shape. */
async function append(
  kernel: StorageKernel<LedgerDb>,
  input: { stream: string; id: string; lock: boolean; afterRead?: () => Promise<void> }
): Promise<string | null> {
  return kernel.transaction(async () => {
    if (input.lock) await kernel.lockKey(`ledger:${input.stream}`);
    const latest = await kernel.run((db) =>
      db.selectFrom("ledger").select(["id", "seq"]).where("stream", "=", input.stream).orderBy("seq", "desc").limit(1).executeTakeFirst()
    );
    await input.afterRead?.();
    const previous = latest?.id ?? null;
    await kernel.run((db) =>
      db
        .insertInto("ledger")
        .values({ id: input.id, stream: input.stream, seq: (latest?.seq ?? 0) + 1, previous_id: previous })
        .execute()
    );
    return previous;
  });
}

test("postgres: transactions commit, roll back and nest on a pooled connection", async () => {
  await first.transaction(async () => {
    await first.transaction(async () =>
      first.run((db) => db.insertInto("ledger").values({ id: "n1", stream: "nest", seq: 1, previous_id: null }).execute())
    );
  });
  await assert.rejects(
    first.transaction(async () => {
      await first.run((db) => db.insertInto("ledger").values({ id: "n2", stream: "nest", seq: 2, previous_id: null }).execute());
      throw new Error("boom");
    }),
    /boom/
  );
  const rows = await second.run((db) => db.selectFrom("ledger").select("id").where("stream", "=", "nest").execute());
  assert.deepEqual(rows.map((row) => row.id), ["n1"]);
});

test("two connections WITHOUT lockKey: both appends read the same latest row (the hazard is real)", async () => {
  await append(first, { stream: "race", id: "r0", lock: false });
  const readDone = gate();
  const release = gate();
  const slow = append(first, {
    stream: "race",
    id: "r1",
    lock: false,
    afterRead: async () => {
      readDone.open();
      await release.opened;
    },
  });
  await readDone.opened;
  const fast = await append(second, { stream: "race", id: "r2", lock: false });
  release.open();
  assert.deepEqual([await slow, fast], ["r0", "r0"]);
});

test("two connections WITH lockKey: the second append waits and chains after the first", async () => {
  await append(first, { stream: "locked", id: "l0", lock: true });
  const readDone = gate();
  const release = gate();
  const slow = append(first, {
    stream: "locked",
    id: "l1",
    lock: true,
    afterRead: async () => {
      readDone.open();
      await release.opened;
    },
  });
  await readDone.opened;
  let fastSettled = false;
  const fast = append(second, { stream: "locked", id: "l2", lock: true }).finally(() => (fastSettled = true));
  await new Promise((resolve) => setTimeout(resolve, 150));
  const waited = !fastSettled;
  release.open();
  assert.equal(waited, true, "the second append must wait for the first transaction's lock");
  assert.deepEqual([await slow, await fast], ["l0", "l1"]);
});
