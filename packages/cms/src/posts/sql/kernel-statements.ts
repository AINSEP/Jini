import type { RawBuilder } from "kysely";

import type { PostSearchKernel } from "./search-index.contract.js";

/**
 * @file The two raw-`sql` entry points the dialect adapters need. The core `StorageKernel` only has
 * `run`; the host kernel's own `query`/`execute` are exactly these two bodies, so the adapters run a
 * `sql` statement the same way without a runtime dependency on the host's storage package.
 */

/** Runs `statement` through the kernel and returns its rows. */
export async function queryRows<Row>(kernel: PostSearchKernel, statement: RawBuilder<Row>): Promise<Row[]> {
  return (await kernel.run((db) => statement.execute(db))).rows;
}

/** Runs `statement` through the kernel, discarding its result. */
export async function executeStatement(kernel: PostSearchKernel, statement: RawBuilder<unknown>): Promise<void> {
  await kernel.run((db) => statement.execute(db));
}
