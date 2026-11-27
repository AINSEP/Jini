import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { SqlApiKeyRepo, SqlSessionRepo } from "../repo.authentication.js";

const open: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of open.splice(0)) await close(); });

/** Real SQLite (in memory) behind a minimal kernel; transactions run inline and locks are no-ops. */
function repos() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT, principal_id TEXT, token_hash TEXT, created_at TEXT, expires_at TEXT, revoked_at TEXT, ip TEXT, user_agent TEXT);
    CREATE TABLE keys (id TEXT PRIMARY KEY, workspace_id TEXT, principal_id TEXT, label TEXT, key_hash TEXT, prefix TEXT, issued_policy_id TEXT, created_at TEXT, last_used_at TEXT, expires_at TEXT, revoked_at TEXT);`);
  const db = new Kysely<unknown>({ dialect: new SqliteDialect({ database: sqlite }) });
  const kernel = {
    dialect: "sqlite" as const, transport: "test", ready: Promise.resolve(),
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    run: async <T>(fn: (handle: Kysely<unknown>) => T | Promise<T>) => fn(db),
    transaction: <T>(fn: () => Promise<T>): Promise<T> => fn(),
    lockKey: async () => {}, inTransaction: () => true, require: () => {}, backupTo: async () => {}, close: () => db.destroy(),
  };
  open.push(() => db.destroy());
  return {
    sessions: new SqlSessionRepo({ kernel, table: "sessions", keepStoredRevocation: ({ table }) => sql`coalesce(${sql.ref(`${table}.revoked_at`)}, excluded.revoked_at)` }),
    keys: new SqlApiKeyRepo({ kernel, table: "keys" }),
  };
}

const session = { id: "s-1", workspaceId: "ws", principalId: "p-1", tokenHash: "th-1", createdAt: "t0", expiresAt: "t9" };
const key = { id: "k-1", workspaceId: "ws", principalId: "p-1", label: "ci", keyHash: "kh-1", prefix: "pre-1", createdAt: "t0" };

describe("SqlSessionRepo", () => {
  it("round-trips ip and user agent and finds a session by token hash only within its workspace", async () => {
    const { sessions } = repos();
    await sessions.save({ ...session, ip: "10.0.0.1", userAgent: "ua" });
    await sessions.save({ ...session, id: "s-other", workspaceId: "ws-2", tokenHash: "th-1" });
    expect(await sessions.findByTokenHash({ workspaceId: "ws", tokenHash: "th-1" })).toEqual({ ...session, ip: "10.0.0.1", userAgent: "ua" });
    expect(await sessions.findByTokenHash({ workspaceId: "ws", tokenHash: "missing" })).toBeNull();
    expect(await sessions.findById({ workspaceId: "ws-2", id: "s-1" })).toBeNull();
  });

  it("lists a principal's sessions in its workspace, omitting absent optional columns", async () => {
    const { sessions } = repos();
    await sessions.save(session);
    await sessions.save({ ...session, id: "s-2", tokenHash: "th-2" });
    await sessions.save({ ...session, id: "s-3", tokenHash: "th-3", principalId: "p-2" });
    await sessions.save({ ...session, id: "s-4", tokenHash: "th-4", workspaceId: "ws-2" });
    const listed = await sessions.listByPrincipalId({ workspaceId: "ws", principalId: "p-1" });
    expect(listed.sort((a, b) => a.id.localeCompare(b.id))).toEqual([session, { ...session, id: "s-2", tokenHash: "th-2" }]);
  });
});

describe("SqlApiKeyRepo", () => {
  it("round-trips every optional column and finds a key by prefix within its workspace", async () => {
    const { keys } = repos();
    const full = { ...key, issuedPolicyId: "pol-1", lastUsedAt: "t1", expiresAt: "t9" };
    await keys.save(full);
    expect(await keys.findByPrefix({ workspaceId: "ws", prefix: "pre-1" })).toEqual(full);
    expect(await keys.findByPrefix({ workspaceId: "ws-2", prefix: "pre-1" })).toBeNull();
    expect(await keys.findById({ workspaceId: "ws", id: "nope" })).toBeNull();
  });

  it("updates a live key in place and lists a principal's keys without optional columns", async () => {
    const { keys } = repos();
    await keys.save(key);
    await keys.save({ ...key, lastUsedAt: "t2" });
    await keys.save({ ...key, id: "k-2", prefix: "pre-2", principalId: "p-2" });
    expect(await keys.listByPrincipalId({ workspaceId: "ws", principalId: "p-1" })).toEqual([{ ...key, lastUsedAt: "t2" }]);
    expect(await keys.listByPrincipalId({ workspaceId: "ws", principalId: "p-2" })).toEqual([{ ...key, id: "k-2", prefix: "pre-2", principalId: "p-2" }]);
  });
});
