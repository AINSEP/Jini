/** @file TEST-ONLY PGlite owner on a temporary directory (`./testing/pglite-owner`). Never import from product code. */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startPgliteOwner } from "./index.js";

const loadDriver = createRequire(import.meta.url);

/**
 * Starts a PGlite owner whose data and socket live in a fresh temporary directory, which `close()`
 * removes. Connect with `openPgliteSocketTestKernel` from `./testing/postgres`.
 */
export async function startPgliteTestOwner(_required = {}, _optional = {}): Promise<{ socketPath: string; close(): Promise<void> }> {
  const { PGlite } = loadDriver("@electric-sql/pglite");
  const dir = mkdtempSync(join(tmpdir(), "db-testing-sock-"));
  const removeDir = () => rmSync(dir, { recursive: true, force: true });
  try {
    const owner = await startPgliteOwner({ PGlite, dataDir: join(dir, "data"), lockFileName: "testing.lock", runDirName: "testing" }, { socketDir: join(dir, "sock") });
    return { socketPath: owner.socketPath, close: async () => { try { await owner.close(); } finally { removeDir(); } } };
  } catch (error) {
    removeDir();
    throw error;
  }
}
