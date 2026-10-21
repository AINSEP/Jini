import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll as after, beforeAll as before, describe, test, vi } from "vitest";

import { sql } from "kysely";
import pg from "pg";

import { PGLITE_SOCKET_FILE } from "../core/index.js";
import { StorageOpError, StorageOpNotSupportedError, type StorageKernel } from "../kernel/index.js";
import { openPgliteSocketKernel, openPostgresKernel, postgresOps } from "../kernel/postgres/index.js";
import { type PgliteOwner, startPgliteOwner } from "../pglite/index.js";
import { LEDGER, OWNER } from "./helpers.js";

/**
 * @file The node-postgres POOL kernel (`openPostgresKernel`) and its storage ops, driven by the real
 * `pg` module against a PGlite owner's Unix socket — the same wire protocol a Postgres server
 * speaks, with no server to install. What needs a real server (two backends, `pg_terminate_backend`)
 * stays in the `*.postgres.test.ts` files.
 */

const scratch = mkdtempSync(join(tmpdir(), "pgd-"));
const dataDir = join(scratch, "data");
const socketDir = join(scratch, "s");
/** node-postgres reaches a Unix socket through `host=<dir>`; PGlite serves one database, `postgres`. */
const connectionString = `postgresql://postgres@localhost/postgres?host=${encodeURIComponent(socketDir)}`;

let owner: PgliteOwner;
let kernel: StorageKernel<unknown>;

before(async () => {
  owner = await startPgliteOwner({ ...OWNER, dataDir }, { socketDir });
  kernel = openPostgresKernel<unknown>({ pg, connectionString }, { max: 2 });
});

after(async () => {
  await kernel.close();
  await owner.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("openPostgresKernel", () => {
  test("is a pooled node-postgres kernel with every Postgres capability except file backup", async () => {
    assert.equal(kernel.dialect, "postgres");
    assert.equal(kernel.transport, "node-postgres");
    assert.deepEqual(kernel.capabilities, { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false });
    await assert.rejects(kernel.backupTo(join(scratch, "never")), /backup/);
  });

  test("a transaction commits on resolve, rolls back on throw, and lockKey works inside it", async () => {
    await kernel.execute(sql`CREATE TABLE pool_probe (id text PRIMARY KEY)`);
    await kernel.transaction(async () => {
      await kernel.lockKey("pool-probe");
      await kernel.execute(sql`INSERT INTO pool_probe VALUES ('kept')`);
    });
    await assert.rejects(
      kernel.transaction(async () => {
        await kernel.execute(sql`INSERT INTO pool_probe VALUES ('dropped')`);
        throw new Error("abort");
      }),
      /abort/
    );
    assert.deepEqual(await kernel.query(sql`SELECT id FROM pool_probe ORDER BY id`), [{ id: "kept" }]);
    await assert.rejects(kernel.lockKey("outside"), /must be called inside transaction\(\)/);
  });

  test("takes no turn lock: a run() body proceeds while another caller's transaction is open", async () => {
    let signalRunStarted!: () => void;
    const runStarted = new Promise<void>((resolve) => (signalRunStarted = resolve));
    // On a one-connection kernel the run() below would queue behind this transaction, which waits
    // for it: a deadlock. A pool has no turn lock, so both finish.
    const open = kernel.transaction(async () => {
      await runStarted;
      return "transaction";
    });
    const run = kernel.run(async () => {
      signalRunStarted();
      return "run";
    });
    assert.deepEqual(await Promise.all([open, run]), ["transaction", "run"]);
  });
});

describe("postgresOps on a node-postgres kernel", () => {
  test("copyTo is refused with the provider-backup reason", async () => {
    await assert.rejects(postgresOps(kernel, { ledgerTable: LEDGER }).copyTo(join(scratch, "copy")), (err: unknown) => {
      assert.ok(err instanceof StorageOpNotSupportedError);
      assert.equal(
        err.message,
        "storage op copyTo is not supported on the node-postgres driver: a Postgres database is backed up by its provider; use a transfer tool to copy it"
      );
      return true;
    });
  });

  test("compactAndVerify vacuums and reads the ledger back; a missing or empty ledger is a StorageOpError", async () => {
    const missing = await postgresOps(kernel, { ledgerTable: "no_such_ledger" }).compactAndVerify().then(() => null, (err: unknown) => err);
    assert.ok(missing instanceof StorageOpError);
    assert.match(missing.message, /^the migration ledger no_such_ledger cannot be read back: /);

    await kernel.execute(sql`CREATE TABLE ${sql.table(LEDGER)} (id text PRIMARY KEY)`);
    await assert.rejects(
      postgresOps(kernel, { ledgerTable: LEDGER }).compactAndVerify(),
      new StorageOpError(`the migration ledger ${LEDGER} is empty after compacting`)
    );
    await kernel.execute(sql`INSERT INTO ${sql.table(LEDGER)} VALUES ('001')`);
    await postgresOps(kernel, { ledgerTable: LEDGER }).compactAndVerify();
  });

  test("ops refuse to run inside a transaction", async () => {
    await kernel.transaction(async () => {
      await assert.rejects(postgresOps(kernel, { ledgerTable: LEDGER }).compactAndVerify(), /must be called outside a transaction/);
    });
  });
});

test("an idle pool connection the server drops is logged, not fatal, and the next query reconnects", async () => {
  const restartDir = join(scratch, "restart");
  const restartSocketDir = join(scratch, "r");
  let server = await startPgliteOwner({ ...OWNER, dataDir: restartDir }, { socketDir: restartSocketDir });
  const pooled = openPostgresKernel<unknown>({
    pg,
    connectionString: `postgresql://postgres@localhost/postgres?host=${encodeURIComponent(restartSocketDir)}`,
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    assert.deepEqual(await pooled.query(sql`SELECT 1 AS n`), [{ n: 1 }]);
    await server.close(); // drops the pool's idle connection
    await vi.waitFor(() => {
      assert.ok(warn.mock.calls.some(([line]) => String(line).startsWith("[postgres] idle pool connection dropped: ")));
    });
    server = await startPgliteOwner({ ...OWNER, dataDir: restartDir }, { socketDir: restartSocketDir });
    assert.deepEqual(await pooled.query(sql`SELECT 2 AS n`), [{ n: 2 }]);
  } finally {
    warn.mockRestore();
    await pooled.close();
    await server.close();
  }
});

test("openPgliteSocketKernel refuses a path that is not the owner's socket file", () => {
  assert.throws(
    () => openPgliteSocketKernel<unknown>({ pg, socketPath: join(socketDir, "not-the-socket") }),
    new Error(`a PGlite socket path ends in /${PGLITE_SOCKET_FILE}: ${join(socketDir, "not-the-socket")}`)
  );
});

test("a storage op error without a reason names only the op and the driver", () => {
  const err = new StorageOpNotSupportedError("compactAndVerify", "pglite");
  assert.equal(err.name, "StorageOpNotSupportedError");
  assert.equal(err.message, "storage op compactAndVerify is not supported on the pglite driver");
  assert.equal(err.op, "compactAndVerify");
  assert.equal(err.transport, "pglite");
});
