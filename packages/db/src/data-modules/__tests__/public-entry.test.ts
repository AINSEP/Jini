import { test } from "vitest";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { openMemorySqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { openPgliteKernel } from "@jini-ai/db/kernel/pglite";
import type { PluginCoreTables } from "@jini-ai/db/data-modules";
import { exerciseDataModules } from "./public-proof.js";

for (const [name, open] of [
  ["SQLite", () => openMemorySqliteKernel<PluginCoreTables>({ open: (file, options) => new Database(file, options) })],
  ["PGlite", () => openPgliteKernel<PluginCoreTables>({ PGlite })],
] as const) {
  test(`public data-modules entry preserves persisted names and provenance on ${name}`, async () => {
    const store = open();
    try { await exerciseDataModules({ store }); }
    finally { await store.close(); }
  });
}
