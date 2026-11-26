import Database from "better-sqlite3";
import { sql } from "kysely";
import { expect, test, vi } from "vitest";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { createUserTrashAdapter } from "../user-trash-adapter.js";

/**
 * Real-SQLite companion to `user-trash-adapter.test.ts`: a policy refusal during purge must leave the
 * principal row and its sessions exactly as they were. Moved here from `@jini-ai/cms`'s
 * `trash/site/__tests__/marker-adapters.test.ts` (merge-25) so `@jini-ai/cms` no longer needs a
 * dev dependency on `@jini-ai/user-management` (that edge closed an admin -> cms -> user-management
 * workspace cycle and pnpm refused to install).
 */
const input = { workspaceId: "site", entityId: "member", at: "2026-11-25T00:00:00Z", expectedVersion: 1 };

test("a blocked user purge leaves the identity and sessions untouched", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE principals (id TEXT, workspace_id TEXT, status TEXT, display_name TEXT, disabled_at TEXT)`);
    await kernel.execute(sql`CREATE TABLE sessions (principal_id TEXT, workspace_id TEXT)`);
    await kernel.execute(sql`INSERT INTO principals VALUES ('member','site','disabled','Owner','old')`);
    await kernel.execute(sql`INSERT INTO sessions VALUES ('member','site')`);
    const purgeUser = vi.fn();
    const adapter = createUserTrashAdapter({ store: {
      underPrincipalLock: ({ run }) => kernel.transaction(async () => { await kernel.lockKey("trash:user:site:member"); return run(); }),
      readPrincipal: async () => ({ status: "disabled", displayName: "Owner" }),
      readDisplayUsername: vi.fn(), compareAndSetStatus: vi.fn(), revokeSessions: vi.fn(), appendEvent: vi.fn(),
    }, policy: { entityType: "user", assertAccountAction: async () => { throw new Error("protected owner"); } },
      purge: { purgeUser }, idGen: { next: () => "event" }, clock: { nowIso: () => "now" } });
    await expect(adapter.purge(input)).rejects.toThrow("protected owner");
    expect(purgeUser).not.toHaveBeenCalled();
    expect(await kernel.query(sql`SELECT status, disabled_at FROM principals`)).toEqual([{ status: "disabled", disabled_at: "old" }]);
    expect(await kernel.query(sql`SELECT * FROM sessions`)).toHaveLength(1);
  } finally { await kernel.close(); }
});

