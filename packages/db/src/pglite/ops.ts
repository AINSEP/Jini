import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { sql } from "kysely";

import {
  outsideTransactionOf,
  type StorageKernel,
  type StorageOps,
  verifyLedgerReadBack,
} from "../kernel/index.js";
import type { PgliteClass } from "./types.js";

/**
 * @file The storage ops for PGlite: an in-process kernel (`openPgliteKernel`), or a socket client
 * whose owner runs in this process. The copy is a data-dir dump restored into a new data dir;
 * compacting is `VACUUM` + `CHECKPOINT`, then a read-back of the consumer's migration ledger. A
 * socket client reaches the dump only through its owner's exclusive window ({@link PgliteExclusive});
 * without one, use `@jini-ai/db/postgres`'s `postgresOps`, which refuses the copy.
 */

/** A PGlite owner's exclusive window (`PgliteOwner.runExclusive`): the one way to dump a served data dir. */
export interface PgliteExclusive {
  runExclusive<T>(fn: (db: PGlite) => Promise<T>): Promise<T>;
}

/** What restoring a dump needs: the consumer's `PGlite` class and the owner lock file to drop from the copy. */
export interface PgliteRestore {
  readonly PGlite: PgliteClass;
  /** The owner's pid lock file name; the dump carries the source owner's lock, the copy has no owner yet. */
  readonly ownerLockFileName?: string;
}

/**
 * The ops for a PGlite kernel. Must be used outside a transaction (Postgres cannot `VACUUM` inside one).
 *
 * @param required.ledgerTable the migration ledger the compaction reads back (no default).
 * @param optional.pgliteOwner the owner serving the data dir `kernel` is a socket client of.
 * @throws {Error} a kernel that is neither in-process PGlite nor a socket client given its owner.
 * @complexity each op is one full pass over the data dir, O(size).
 */
export function pgliteOps<DB>(
  kernel: StorageKernel<DB>,
  required: PgliteRestore & { ledgerTable: string },
  optional: { pgliteOwner?: PgliteExclusive } = {}
): StorageOps {
  const owner = optional.pgliteOwner;
  const ownedSocket = kernel.transport === "pglite-socket" && owner !== undefined;
  if (kernel.transport !== "pglite" && !ownedSocket) {
    throw new Error(`pgliteOps: a ${kernel.transport} kernel is not PGlite in this process (a socket client needs pgliteOwner)`);
  }
  const outsideTransaction = outsideTransactionOf(kernel as StorageKernel<unknown>);
  return {
    async copyTo(targetPath) {
      outsideTransaction("copyTo");
      if (owner !== undefined) return copyServedPgliteTo(owner, targetPath, required);
      await restoreDataDir(targetPath, required, async () => {
        const tarball = `${targetPath}.${randomUUID()}.tar`;
        try {
          await kernel.backupTo(tarball);
          return new Blob([await readFile(tarball)]);
        } finally {
          rmSync(tarball, { force: true });
        }
      });
    },
    async compactAndVerify() {
      outsideTransaction("compactAndVerify");
      if (owner !== undefined) {
        // Two calls: a multi-statement string runs as one implicit transaction, which VACUUM refuses.
        await owner.runExclusive(async (db) => {
          await db.exec("VACUUM");
          await db.exec("CHECKPOINT");
        });
      } else {
        await kernel.execute(sql`VACUUM`);
        await kernel.execute(sql`CHECKPOINT`);
      }
      await verifyLedgerReadBack(kernel as StorageKernel<unknown>, required.ledgerTable);
    },
  };
}

/**
 * `copyTo` for a PGlite data dir served by `owner` (in this process): the dump is taken inside the
 * owner's exclusive window, then restored into `targetPath` (which must not exist).
 */
export async function copyServedPgliteTo(owner: PgliteExclusive, targetPath: string, required: PgliteRestore): Promise<void> {
  await restoreDataDir(targetPath, required, () => owner.runExclusive((db) => db.dumpDataDir("none")));
}

/** Restores `dump()` into a new PGlite data dir at `targetPath`; removes a partial dir on failure. */
async function restoreDataDir(targetPath: string, required: PgliteRestore, dump: () => Promise<Blob | File>): Promise<void> {
  if (existsSync(targetPath)) throw new Error(`storage op copyTo: ${targetPath} already exists`);
  const data = await dump();
  try {
    const restored = await required.PGlite.create({ dataDir: targetPath, loadDataDir: data });
    await restored.close();
    if (required.ownerLockFileName !== undefined) rmSync(join(targetPath, required.ownerLockFileName), { force: true });
  } catch (err) {
    rmSync(targetPath, { recursive: true, force: true });
    throw err;
  }
}
