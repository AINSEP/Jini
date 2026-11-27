import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { assertVersionedWrite, RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import type { PrincipalRecord, PolicyRecord, RoleRecord, UserRecord } from "@jini-ai/core/contracts/site/user-management";
import { SqlPrincipalRepo, SqlUserRepo } from "../repo.js";
import { SqlPolicyPermissionRepo, SqlPolicyRepo, SqlRoleRepo } from "../repo.authorization.js";

/** A real in-memory SQLite kernel; `events` records every lock key and kernel write in order. */
function sqliteKernel() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE principals (id TEXT PRIMARY KEY, workspace_id TEXT, kind TEXT, display_name TEXT, status TEXT, disabled_at TEXT, created_at TEXT);
    CREATE TABLE users (principal_id TEXT PRIMARY KEY, workspace_id TEXT, username TEXT, email TEXT, password_hash TEXT, last_login_at TEXT, version INTEGER);
    CREATE TABLE roles (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, is_builtin INTEGER, version INTEGER);
    CREATE TABLE policies (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, description TEXT, is_builtin INTEGER, is_frozen INTEGER, version INTEGER);
    CREATE TABLE grants (id TEXT PRIMARY KEY, workspace_id TEXT, policy_id TEXT, permission TEXT, resource_type TEXT, constraint_json TEXT);`);
  const db = new Kysely<unknown>({ dialect: new SqliteDialect({ database: sqlite }) });
  const events: string[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  const kernel = {
    dialect: "sqlite" as const, transport: "test", ready: Promise.resolve(),
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    run: async <T>(fn: (handle: Kysely<unknown>) => T | Promise<T>) => fn(db),
    transaction<T>(fn: () => Promise<T>): Promise<T> { const result = tail.then(fn); tail = result.catch(() => {}); return result; },
    lockKey: async (key: string) => { events.push(key); }, inTransaction: () => true, require: () => {}, backupTo: async () => {}, close: () => db.destroy(),
  };
  return { kernel, events };
}

const principal: PrincipalRecord = { id: "p-1", workspaceId: "ws", kind: "user", displayName: "Ada", status: "active", createdAt: "t0" };
const user: UserRecord = { principalId: "p-1", workspaceId: "ws", username: "ada", passwordHash: "hash-a", version: 1 };
const role: RoleRecord = { id: "r-1", workspaceId: "ws", name: "Editor", isBuiltin: true, version: 1 };
const policy: PolicyRecord = { id: "pol-1", workspaceId: "ws", name: "Content", isBuiltin: false, isFrozen: true, version: 1 };

async function conflictOf(promise: Promise<unknown>): Promise<RecordVersionConflictError> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(RecordVersionConflictError);
  return error as RecordVersionConflictError;
}

describe("SqlPrincipalRepo", () => {
  it("round-trips a principal under the workspace lock, mapping an absent disable stamp to undefined", async () => {
    const { kernel, events } = sqliteKernel();
    const repo = new SqlPrincipalRepo({ kernel, table: "principals" });
    await repo.save(principal);
    expect(events).toEqual(["identity:ws"]);
    expect(await repo.findById({ workspaceId: "ws", id: "p-1" })).toEqual({ ...principal, disabledAt: undefined });
    expect(await repo.findById({ workspaceId: "other", id: "p-1" })).toBeNull();
    await kernel.close();
  });

  it("upserts on the id and lists only the asked workspace", async () => {
    const { kernel } = sqliteKernel();
    const repo = new SqlPrincipalRepo({ kernel, table: "principals" });
    await repo.save(principal);
    await repo.save({ ...principal, status: "disabled", disabledAt: "t1", displayName: "Ada L" });
    await repo.save({ ...principal, id: "p-2", workspaceId: "other" });
    expect(await repo.list({ workspaceId: "ws" })).toEqual([{ ...principal, status: "disabled", disabledAt: "t1", displayName: "Ada L" }]);
    await kernel.close();
  });
});

describe("SqlUserRepo", () => {
  it("inserts at the given version, finds by id and username, and bumps the version on a basis-less re-save", async () => {
    const { kernel } = sqliteKernel();
    const repo = new SqlUserRepo({ kernel, table: "users", assertVersionedWrite });
    await repo.save(user);
    expect(await repo.findByPrincipalId({ workspaceId: "ws", principalId: "p-1" })).toEqual({ ...user, email: undefined, lastLoginAt: undefined });
    await repo.save({ ...user, email: "ada@example.test", lastLoginAt: "t2", passwordHash: "hash-b" });
    expect(await repo.findByUsername({ workspaceId: "ws", username: "ada" })).toEqual({ ...user, email: "ada@example.test", lastLoginAt: "t2", passwordHash: "hash-b", version: 2 });
    expect(await repo.findByUsername({ workspaceId: "other", username: "ada" })).toBeNull();
    expect(await repo.findByPrincipalId({ workspaceId: "ws", principalId: "nobody" })).toBeNull();
    await kernel.close();
  });

  it("records a login only on the matching workspace row and lists per workspace", async () => {
    const { kernel, events } = sqliteKernel();
    const repo = new SqlUserRepo({ kernel, table: "users", assertVersionedWrite });
    await repo.save(user);
    await repo.save({ ...user, principalId: "p-2", workspaceId: "other", username: "bob" });
    await repo.recordLogin({ workspaceId: "other", principalId: "p-1", lastLoginAt: "wrong" });
    await repo.recordLogin({ workspaceId: "ws", principalId: "p-1", lastLoginAt: "t3" });
    expect(events).toEqual(["identity:ws", "identity:other", "identity:other", "identity:ws"]);
    expect(await repo.list({ workspaceId: "ws" })).toEqual([{ ...user, email: undefined, lastLoginAt: "t3" }]);
    await kernel.close();
  });

  it("a versioned profile edit writes username and email only and advances the version", async () => {
    const { kernel } = sqliteKernel();
    const repo = new SqlUserRepo({ kernel, table: "users", assertVersionedWrite });
    await repo.save({ ...user, email: "old@example.test", lastLoginAt: "t1" });
    await repo.save({ ...user, username: "ada2", passwordHash: "ignored", lastLoginAt: "ignored" }, { expectedVersion: 1 });
    expect(await repo.findByPrincipalId({ workspaceId: "ws", principalId: "p-1" })).toEqual({ ...user, username: "ada2", email: undefined, lastLoginAt: "t1", version: 2 });
    await kernel.close();
  });

  it("a stale or vanished basis throws a conflict naming the live version", async () => {
    const { kernel } = sqliteKernel();
    const repo = new SqlUserRepo({ kernel, table: "users", assertVersionedWrite });
    await repo.save({ ...user, version: 4 });
    const stale = await conflictOf(repo.save({ ...user, username: "x" }, { expectedVersion: 3 }));
    expect([stale.recordKind, stale.recordId, stale.expectedVersion, stale.currentVersion]).toEqual(["user", "p-1", 3, 4]);
    const gone = await conflictOf(repo.save({ ...user, principalId: "ghost" }, { expectedVersion: 1 }));
    expect(gone.currentVersion).toBeNull();
    expect((await repo.findByPrincipalId({ workspaceId: "ws", principalId: "p-1" }))?.username).toBe("ada");
    await kernel.close();
  });
});

describe("SqlRoleRepo", () => {
  it("stores builtin as 0/1, finds by id and name, lists per workspace and bumps on upsert", async () => {
    const { kernel } = sqliteKernel();
    const repo = new SqlRoleRepo({ kernel, table: "roles", assertVersionedWrite });
    await repo.save(role);
    await repo.save({ ...role, id: "r-2", name: "Viewer", isBuiltin: false });
    await repo.save({ ...role, id: "r-3", workspaceId: "other" });
    expect(await repo.findById({ workspaceId: "ws", id: "r-1" })).toEqual(role);
    expect(await repo.findByName({ workspaceId: "ws", name: "Viewer" })).toEqual({ ...role, id: "r-2", name: "Viewer", isBuiltin: false });
    expect(await repo.findByName({ workspaceId: "ws", name: "Missing" })).toBeNull();
    expect(await repo.findById({ workspaceId: "other", id: "r-1" })).toBeNull();
    await repo.save({ ...role, name: "Editors" });
    expect((await repo.list({ workspaceId: "ws" })).map((r) => [r.id, r.name, r.version])).toEqual([["r-1", "Editors", 2], ["r-2", "Viewer", 1]]);
    await kernel.close();
  });

  it("renames under a basis, rejects a stale one, and deletes only within the workspace", async () => {
    const { kernel } = sqliteKernel();
    const repo = new SqlRoleRepo({ kernel, table: "roles", assertVersionedWrite });
    await repo.save(role);
    await repo.save({ ...role, name: "Writers", isBuiltin: false }, { expectedVersion: 1 });
    expect(await repo.findById({ workspaceId: "ws", id: "r-1" })).toEqual({ ...role, name: "Writers", version: 2 });
    const stale = await conflictOf(repo.save({ ...role, name: "Late" }, { expectedVersion: 1 }));
    expect([stale.recordKind, stale.currentVersion]).toEqual(["role", 2]);
    const gone = await conflictOf(repo.save({ ...role, id: "ghost" }, { expectedVersion: 1 }));
    expect(gone.currentVersion).toBeNull();
    await repo.delete({ workspaceId: "other", id: "r-1" });
    expect(await repo.findById({ workspaceId: "ws", id: "r-1" })).not.toBeNull();
    await repo.delete({ workspaceId: "ws", id: "r-1" });
    expect(await repo.findById({ workspaceId: "ws", id: "r-1" })).toBeNull();
    await kernel.close();
  });
});

describe("SqlPolicyRepo", () => {
  it("maps builtin/frozen flags and an absent description, finds by id and name, lists per workspace", async () => {
    const { kernel } = sqliteKernel();
    const repo = new SqlPolicyRepo({ kernel, table: "policies", assertVersionedWrite });
    await repo.save(policy);
    await repo.save({ ...policy, id: "pol-2", name: "Admin", description: "all", isBuiltin: true, isFrozen: false });
    await repo.save({ ...policy, id: "pol-3", workspaceId: "other" });
    expect(await repo.findById({ workspaceId: "ws", id: "pol-1" })).toEqual({ ...policy, description: undefined });
    expect(await repo.findByName({ workspaceId: "ws", name: "Admin" })).toEqual({ ...policy, id: "pol-2", name: "Admin", description: "all", isBuiltin: true, isFrozen: false });
    expect(await repo.findByName({ workspaceId: "other", name: "Admin" })).toBeNull();
    expect(await repo.findById({ workspaceId: "ws", id: "pol-3" })).toBeNull();
    await repo.save({ ...policy, description: "now described" });
    expect((await repo.list({ workspaceId: "ws" })).map((p) => [p.id, p.description, p.version])).toEqual([["pol-1", "now described", 2], ["pol-2", "all", 1]]);
    await kernel.close();
  });

  it("edits name and description under a basis, clears a removed description, rejects a stale basis, deletes scoped", async () => {
    const { kernel } = sqliteKernel();
    const repo = new SqlPolicyRepo({ kernel, table: "policies", assertVersionedWrite });
    await repo.save({ ...policy, description: "old" });
    await repo.save({ ...policy, name: "Content2", isFrozen: false }, { expectedVersion: 1 });
    expect(await repo.findById({ workspaceId: "ws", id: "pol-1" })).toEqual({ ...policy, name: "Content2", description: undefined, version: 2 });
    await repo.save({ ...policy, description: "back" }, { expectedVersion: 2 });
    expect((await repo.findById({ workspaceId: "ws", id: "pol-1" }))?.description).toBe("back");
    const stale = await conflictOf(repo.save(policy, { expectedVersion: 1 }));
    expect([stale.recordKind, stale.recordId, stale.currentVersion]).toEqual(["policy", "pol-1", 3]);
    const gone = await conflictOf(repo.save({ ...policy, id: "ghost" }, { expectedVersion: 1 }));
    expect(gone.currentVersion).toBeNull();
    await repo.delete({ workspaceId: "other", id: "pol-1" });
    expect(await repo.findById({ workspaceId: "ws", id: "pol-1" })).not.toBeNull();
    await repo.delete({ workspaceId: "ws", id: "pol-1" });
    expect(await repo.list({ workspaceId: "ws" })).toEqual([]);
    await kernel.close();
  });
});

describe("SqlPolicyPermissionRepo.delete", () => {
  it("removes one grant by id inside its workspace only, keeping its siblings", async () => {
    const { kernel, events } = sqliteKernel();
    const repo = new SqlPolicyPermissionRepo({ kernel, table: "grants" });
    const grant = { id: "g-1", workspaceId: "ws", policyId: "pol-1", permission: "read", resourceType: "page", constraintJson: "{}" };
    await repo.save(grant);
    await repo.save({ ...grant, id: "g-2", permission: "write" });
    await repo.delete({ workspaceId: "other", id: "g-1" });
    await repo.delete({ workspaceId: "ws", id: "g-1" });
    expect(events).toEqual(["identity:ws", "identity:ws", "identity:other", "identity:ws"]);
    expect(await repo.listByPolicyId({ workspaceId: "ws", policyId: "pol-1" })).toEqual([{ ...grant, id: "g-2", permission: "write" }]);
    await kernel.close();
  });
});
