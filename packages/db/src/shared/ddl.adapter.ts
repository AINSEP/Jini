import { sql } from "kysely";
import type { StorageKernel } from "../kernel/index.js";

/**
 * Runs a `;`-separated DDL script one statement at a time; the runner owns the encompassing
 * transaction. Shared adapter so independent migration domains need no Kysely import.
 * @complexity O(statements).
 */
export async function executeDdl({ kernel, ddl }: { kernel: StorageKernel<unknown>; ddl: string }, _options = {}): Promise<void> {
  // Kysely executes one SQLite statement at a time.
  for (const statement of ddl.split(";").filter(part => part.trim())) {
    await kernel.execute(sql.raw(statement));
  }
}
