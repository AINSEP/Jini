import type { Kysely, RawBuilder } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
export type { RawBuilder } from "kysely";

/**
 * @file `@jini-ai/db`'s kernel: the neutral `@jini-ai/core/contracts/storage` {@link StorageKernel} bound to a Kysely
 * handle, plus raw statements. Hosts that chose Kysely type their kernels with this; domain packages see only the core
 * contract (`StorageKernel<Kysely<DB>, DB>` in their SQL adapter subpaths) and never import this package.
 * Package: `@jini-ai/db/kernel` (no driver is imported here; each driver lives in its own subpath).
 *
 * - {@link KyselyKernel.query} — a portable Kysely `sql` statement returning rows. For dialect
 *   helpers, migrations and introspection (`dialect.ts`), not for repos.
 */

/** The connections this package's drivers open (core's `StorageTransport` is open-ended). */
export type DbTransport = "better-sqlite3" | "pglite" | "node-postgres" | "pglite-socket";

export interface KyselyKernel<DB> extends StorageKernel<Kysely<DB>, DB> {
  readonly transport: DbTransport;
  query<Row>(statement: RawBuilder<Row>): Promise<Row[]>;
  /** {@link query} for a statement that returns no rows (DDL, a write without `RETURNING`). */
  execute(statement: RawBuilder<unknown>): Promise<void>;
}
