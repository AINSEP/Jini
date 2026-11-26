import Database from "better-sqlite3";
import { sql } from "kysely";
import { expect, test } from "vitest";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import type { DomainEvent } from "@jini-ai/core/contracts/events";
import { KernelUserPurge } from "../kernel-user-purge.js";

const COUNTED = ["principal_roles", "principal_policies", "sessions", "api_keys", "setting_values_user", "secrets_vault", "identity_users"];

async function seeded() {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  for (const table of COUNTED) {
    await kernel.execute(sql.raw(`CREATE TABLE ${table} (workspace_id TEXT, principal_id TEXT)`));
    await kernel.execute(sql.raw(`INSERT INTO ${table} VALUES ('site','gone'),('site','gone'),('site','kept'),('other','gone')`));
  }
  await kernel.execute(sql`CREATE TABLE principals (workspace_id TEXT, id TEXT)`);
  await kernel.execute(sql`INSERT INTO principals VALUES ('site','gone'),('site','kept'),('other','gone')`);
  await kernel.execute(sql`CREATE TABLE outbox_events (type TEXT, payload TEXT)`);
  return kernel;
}

test("purges only the scoped principal's rows, counts them, and appends one outbox event in the same transaction", async () => {
  const kernel = await seeded();
  try {
    const purge = new KernelUserPurge({ kernel, eventValues: (event) => ({ type: event.name, payload: JSON.stringify(event.payload) }) });
    const removed = await purge.purgeUser({ workspaceId: "site", principalId: "gone",
      buildEvent: ({ removed: counts }) => ({ id: "evt", name: "user.purged", occurredAt: "2026-11-26T00:00:00Z", workspaceId: "site", payload: { ...counts } }) satisfies DomainEvent });
    expect(removed).toEqual({ roles: 2, policies: 2, sessions: 2, apiKeys: 2, userSettings: 2 });
    for (const table of COUNTED) {
      expect(await kernel.query(sql.raw(`SELECT workspace_id, principal_id FROM ${table} ORDER BY workspace_id, principal_id`)), table)
        .toEqual([{ workspace_id: "other", principal_id: "gone" }, { workspace_id: "site", principal_id: "kept" }]);
    }
    expect(await kernel.query(sql`SELECT workspace_id, id FROM principals ORDER BY workspace_id, id`))
      .toEqual([{ workspace_id: "other", id: "gone" }, { workspace_id: "site", id: "kept" }]);
    expect(await kernel.query(sql`SELECT type, payload FROM outbox_events`))
      .toEqual([{ type: "user.purged", payload: JSON.stringify(removed) }]);
  } finally { await kernel.close(); }
});

test("a failing outbox append rolls the whole purge back", async () => {
  const kernel = await seeded();
  try {
    const purge = new KernelUserPurge({ kernel, eventValues: () => ({ no_such_column: 1 }) });
    await expect(purge.purgeUser({ workspaceId: "site", principalId: "gone",
      buildEvent: () => ({ id: "evt", name: "user.purged", occurredAt: "2026-11-26T00:00:00Z", workspaceId: "site", payload: {} }) satisfies DomainEvent })).rejects.toThrow();
    expect(await kernel.query(sql`SELECT COUNT(*) AS n FROM sessions`)).toEqual([{ n: 4 }]);
    expect(await kernel.query(sql`SELECT COUNT(*) AS n FROM principals`)).toEqual([{ n: 3 }]);
  } finally { await kernel.close(); }
});
