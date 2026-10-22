import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import type { PGlite } from "@electric-sql/pglite";
import { Kysely } from "kysely";

import { PG_PARSERS } from "../../core/index.js";
import { buildKernel, postgresLockKey, type StorageKernel } from "../index.js";
import { PgliteDialect } from "./dialect.js";
import type { PgliteClass } from "../../pglite/types.js";

/**
 * @file The PGlite driver: one in-process Postgres (WASM) per data directory, behind the same
 * Kysely query bodies as every other driver.
 *
 * PGlite holds one connection: a repo that kept using the base handle inside a transaction would
 * wait on itself forever. The kernel's transaction scope hands the open transaction to every
 * `run()` inside it, which is what makes that safe.
 *
 * Only ONE process may open a data dir; to share one, run an owner (`startPgliteOwner`) and connect
 * through its socket.
 */

export type PgKernel<DB> = StorageKernel<DB>;

/**
 * Opens (and on first use creates) a PGlite database. Synchronous so it fits the synchronous
 * composition root; the async setup runs behind `ready`, which every kernel call awaits.
 *
 * @param required.PGlite the consumer's `PGlite` class (this package never imports it).
 * @param optional.dataDir absent = in-memory (tests).
 * @param optional.prepare runs once after open, before any call (e.g. schema creation).
 */
export function openPgliteKernel<DB>(
  required: { PGlite: PgliteClass },
  optional: { dataDir?: string; prepare?: (client: PGlite) => Promise<void> } = {}
): PgKernel<DB> {
  if (optional.dataDir !== undefined) mkdirSync(optional.dataDir, { recursive: true });
  // One options object: PGlite drops the second argument when the first (dataDir) is undefined.
  const client = new required.PGlite({ ...(optional.dataDir === undefined ? {} : { dataDir: optional.dataDir }), parsers: PG_PARSERS });
  const base = new Kysely<DB>({ dialect: new PgliteDialect(client) });
  const ready = (async () => {
    await client.waitReady;
    await optional.prepare?.(client);
  })();
  // Surfaced by every call that awaits `ready`; this only stops an unhandled-rejection crash when
  // nothing has called in yet.
  ready.catch(() => {});
  return buildKernel<DB>({
    dialect: "postgres",
    transport: "pglite",
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: true },
    ready,
    base,
    oneConnection: true,
    begin: (body) => base.transaction().execute((tx) => body(tx)),
    lockKey: postgresLockKey,
    async backup(destPath) {
      const dump = await client.dumpDataDir("none");
      await writeFile(destPath, Buffer.from(await dump.arrayBuffer()));
    },
    async close() {
      await ready.catch(() => {});
      await client.close();
    },
  });
}
