/** @file TEST-ONLY in-memory PGlite kernel (`./testing/pglite`). The driver is this package's own copy. Never import from product code. */
import { createRequire } from "node:module";

import { sql } from "kysely";

import { pgTestKernel, type PgTestKernel } from "../testing.js";
import { openPgliteKernel } from "./driver.js";

const loadDriver = createRequire(import.meta.url);

/** An in-memory PGlite kernel that ran `ddl` (one statement each). Closing it closes the embedded database. */
export async function openPgliteTestKernel<DB>(_required = {}, optional: { ddl?: readonly string[] } = {}): Promise<PgTestKernel<DB>> {
  const { PGlite } = loadDriver("@electric-sql/pglite");
  const kernel = openPgliteKernel<DB>({ PGlite });
  try {
    for (const statement of optional.ddl ?? []) await kernel.execute(sql.raw(statement));
    return pgTestKernel({ kernel, close: () => kernel.close() });
  } catch (error) {
    await kernel.close();
    throw error;
  }
}
