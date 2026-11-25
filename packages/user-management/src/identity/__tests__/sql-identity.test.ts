import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { SqlSessionRepo, SqlApiKeyRepo } from "../repo.authentication.js";
import { SqlPolicyPermissionRepo } from "../repo.authorization.js";
import { createIdentityTransactions } from "../repo.js";

function fixture() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT, principal_id TEXT, token_hash TEXT, created_at TEXT, expires_at TEXT, revoked_at TEXT, ip TEXT, user_agent TEXT);
    CREATE TABLE keys (id TEXT PRIMARY KEY, workspace_id TEXT, principal_id TEXT, label TEXT, key_hash TEXT, prefix TEXT, issued_policy_id TEXT, created_at TEXT, last_used_at TEXT, expires_at TEXT, revoked_at TEXT);
    CREATE TABLE grants (id TEXT PRIMARY KEY, workspace_id TEXT, policy_id TEXT, permission TEXT, resource_type TEXT, constraint_json TEXT);`);
  const db = new Kysely<unknown>({ dialect: new SqliteDialect({ database: sqlite }) });
  const events: string[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  const kernel = {
    dialect: "sqlite" as const, transport: "test", ready: Promise.resolve(),
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    run: async <T>(fn: (handle: Kysely<unknown>) => T | Promise<T>) => { events.push("write"); return fn(db); },
    transaction<T>(fn: () => Promise<T>): Promise<T> { const result = tail.then(fn); tail = result.catch(() => {}); return result; },
    lockKey: async (key: string) => { events.push(key); }, inTransaction: () => true, require: () => {}, backupTo: async () => {}, close: () => db.destroy(),
  };
  return { kernel, events };
}

it("stale saves cannot revive sessions or keys", async () => {
  const { kernel } = fixture();
  const sessions = new SqlSessionRepo({ kernel, table: "sessions", keepStoredRevocation: ({ table }) => sql`coalesce(${sql.ref(`${table}.revoked_at`)}, excluded.revoked_at)` });
  const keys = new SqlApiKeyRepo({ kernel, table: "keys" });
  const session = { id: "session", workspaceId: "ws", principalId: "actor", tokenHash: "hash", createdAt: "stamp", expiresAt: "later" };
  const key = { id: "key", workspaceId: "ws", principalId: "actor", label: "key", keyHash: "hash", prefix: "prefix", createdAt: "stamp" };
  await sessions.save(session);
  await sessions.revoke({ workspaceId: "ws", id: "session", revokedAt: "revoked" });
  await sessions.save(session);
  await keys.save({ ...key, revokedAt: "revoked" });
  await keys.save(key);
  expect((await sessions.findById({ workspaceId: "ws", id: "session" }))?.revokedAt).toBe("revoked");
  expect((await keys.findById({ workspaceId: "ws", id: "key" }))?.revokedAt).toBe("revoked");
  await kernel.close();
});

it("authorization writes serialize with the workspace guard", async () => {
  const { kernel, events } = fixture();
  const repo = new SqlPolicyPermissionRepo({ kernel, table: "grants" });
  await Promise.all([
    createIdentityTransactions({ kernel }).run({ workspaceId: "ws", execute: async () => { events.push("guard"); } }),
    repo.save({ id: "grant", workspaceId: "ws", policyId: "policy", permission: "read", resourceType: null, constraintJson: null }),
  ]);
  expect(events).toEqual(["identity:ws", "guard", "identity:ws", "write"]);
  await kernel.close();
});
