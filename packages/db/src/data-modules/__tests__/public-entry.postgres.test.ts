import { test } from "vitest";
import pg from "pg";
import { createPgFixture } from "@jini-ai/db/testing/pg-fixture";
import { openPostgresKernel } from "@jini-ai/db/kernel/postgres";
import type { PluginCoreTables } from "@jini-ai/db/data-modules";
import { exerciseDataModules } from "./public-proof.js";

test("public data-modules entry preserves persisted names and provenance on Postgres", async () => {
  const host = process.env.PGHOST ?? "/tmp";
  const user = process.env.PGUSER ?? "agent";
  const port = process.env.PGPORT ?? "5432";
  const database = "jini_more_jini1_fixture";
  const fixture = createPgFixture({ host, user, port });
  fixture.recreateDatabase({ database });
  const connectionString = `postgresql://${encodeURIComponent(user)}@localhost:${port}/${database}?host=${encodeURIComponent(host)}`;
  const store = openPostgresKernel<PluginCoreTables>({ pg, connectionString });
  try { await exerciseDataModules({ store }); }
  finally { await store.close(); fixture.dropDatabase({ database }); }
});
