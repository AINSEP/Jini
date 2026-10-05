import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { test } from "vitest";

import { PgliteDialect } from "../kernel/pglite/dialect.js";
import { postgresLockKey } from "../kernel/postgres-lock.js";

// The two-connection exclusion outcome already lives in kernel.postgres.test.ts:101.
// F2.5/F6.3: this additionally catches a constant key or a session-scoped lock that leaks after exit.
test("lock keys are bound independently and advisory locks disappear on commit and rollback", async () => {
  const client = new PGlite();
  const requests: { sql: string; parameters: readonly unknown[] }[] = [];
  const db = new Kysely<unknown>({
    dialect: new PgliteDialect(client),
    log(event) {
      if (event.level === "query") requests.push({ sql: event.query.sql, parameters: [...event.query.parameters] });
    },
  });
  const lockCount = async (executor: typeof db) => (await sql<{ n: number }>`
    SELECT count(*)::integer AS n FROM pg_locks WHERE locktype = 'advisory' AND granted`.execute(executor)).rows;
  try {
    for (const rollback of [false, true]) {
      requests.length = 0;
      const work = db.transaction().execute(async tx => {
        await postgresLockKey(tx, "ledger:O'Brien;$1");
        await postgresLockKey(tx, "ledger:other");
        await postgresLockKey(tx, "ledger:O'Brien;$1");
        assert.deepEqual(await lockCount(tx), [{ n: 2 }]);
        if (rollback) throw new Error("rollback locks");
      });
      if (rollback) await assert.rejects(work, { message: "rollback locks" });
      else await work;
      assert.deepEqual(requests.filter(request => request.sql.startsWith("SELECT pg_advisory")), [
        { sql: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", parameters: ["ledger:O'Brien;$1"] },
        { sql: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", parameters: ["ledger:other"] },
        { sql: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", parameters: ["ledger:O'Brien;$1"] },
      ]);
      assert.deepEqual(await lockCount(db), [{ n: 0 }]);
    }
  } finally {
    await db.destroy();
    await client.close();
  }
});
