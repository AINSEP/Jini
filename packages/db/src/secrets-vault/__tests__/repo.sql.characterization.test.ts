import Database from "better-sqlite3";
import { sql, type Kysely } from "kysely";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { VaultPutRecord } from "@jini-ai/platform/secrets/credential-sets/contracts";
import type { StorageKernel } from "../../kernel/port.js";
import { sqliteKernel } from "../../kernel/sqlite/index.js";
import { SqlSecretsVaultRepo, type SecretsVaultDatabase } from "../repo.sql.js";

let kernel: StorageKernel<SecretsVaultDatabase>;
let repo: SqlSecretsVaultRepo;
let reads: string[];
beforeEach(async () => {
  kernel = sqliteKernel<SecretsVaultDatabase>(new Database(":memory:"));
  await kernel.execute(sql`CREATE TABLE secrets_vault (
    workspace_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, owner_key TEXT NOT NULL,
    principal_id TEXT, binding TEXT, provider TEXT, label TEXT NOT NULL, is_default BOOLEAN NOT NULL,
    revision INTEGER NOT NULL, sealed_key_id TEXT, sealed_ciphertext TEXT, sealed_nonce TEXT, sealed_alg TEXT,
    last4 TEXT, token_length INTEGER, meta TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, id))`);
  await kernel.execute(sql`CREATE UNIQUE INDEX vault_default ON secrets_vault
    (workspace_id, kind, owner_key, (principal_id IS NULL), coalesce(principal_id, ''),
     (provider IS NULL), coalesce(provider, '')) WHERE is_default = true`);
  await kernel.execute(sql`CREATE UNIQUE INDEX vault_label ON secrets_vault
    (workspace_id, kind, owner_key, (principal_id IS NULL), coalesce(principal_id, ''),
     (provider IS NULL), coalesce(provider, ''), label)`);
  reads = [];
  const recording: StorageKernel<SecretsVaultDatabase> = { ...kernel,
    run<T>(body: (db: Kysely<SecretsVaultDatabase>) => T | Promise<T>): Promise<T> {
      return kernel.run(db => body(db.withPlugin({
        transformQuery(args) {
          const text = db.getExecutor().compileQuery(args.node, args.queryId).sql;
          if (text.startsWith("select")) reads.push(text);
          return args.node;
        },
        async transformResult({ result }) { return result; },
      })));
    },
  };
  repo = new SqlSecretsVaultRepo({ kernel: recording });
});
afterEach(async () => { await kernel.close(); });
function record({ id, ...patch }: Partial<VaultPutRecord> & { id: string }, _optional = {}): VaultPutRecord {
  return { workspaceId: "ws", id, kind: "vendor", ownerKey: "deploy", principalId: null, binding: null,
    provider: "host", label: id, revision: 1, sealed: null, last4: null, tokenLength: null,
    meta: { accountLabel: null }, createdAt: "created", updatedAt: "updated", ...patch };
}
const group = { workspaceId: "ws", kind: "vendor" as const, ownerKey: "deploy", principalId: null, provider: "host" };

test("new rows check label uniqueness and auto-default only an empty destination", async () => {
  const first = await repo.put({ record: record({ id: "a" }), expectedRevision: null });
  const second = await repo.put({ record: record({ id: "b" }), expectedRevision: null });
  expect(first.isDefault).toBe(true);
  expect(second.isDefault).toBe(false);
  const before = await repo.list(group);
  await expect(repo.put({ record: record({ id: "duplicate", label: "a", isDefault: true }), expectedRevision: null })).rejects.toMatchObject({ code: "conflict" });
  expect(await repo.list(group)).toEqual(before);
});

test("an unchanged-label rotation skips uniqueness/group reads; a renamed label is checked excluding the same id", async () => {
  await repo.put({ record: record({ id: "a" }), expectedRevision: null });
  const b = await repo.put({ record: record({ id: "b" }), expectedRevision: null });
  reads.length = 0;
  const rotated = await repo.put({ record: { ...b, revision: 2 }, expectedRevision: 1 });
  expect(reads).toHaveLength(1);
  expect(reads[0]).toContain('where "workspace_id" = ? and "id" = ?');
  expect(rotated.isDefault).toBe(false);
  const renamed = await repo.put({ record: { ...rotated, label: "new label", revision: 3 }, expectedRevision: 2 });
  expect(renamed.label).toBe("new label");
  expect(reads.some(text => text.includes('"id" != ? and "label" = ?'))).toBe(true);
  await expect(repo.put({ record: { ...renamed, label: "a", revision: 4 }, expectedRevision: 3 })).rejects.toMatchObject({ code: "conflict" });
  expect(await repo.find(b)).toEqual(renamed);
});

test("a same-label provider move checks the destination before changing either default", async () => {
  const a = await repo.put({ record: record({ id: "a" }), expectedRevision: null });
  const target = await repo.put({ record: record({ id: "target", label: "a", provider: "new" }), expectedRevision: null });
  await expect(repo.put({ record: { ...a, provider: "new", revision: 2 }, expectedRevision: 1 })).rejects.toMatchObject({ code: "conflict" });
  expect(await repo.find(a)).toEqual(a);
  expect(await repo.find(target)).toEqual(target);
});

test("moving a default promotes its former group and joins the destination without taking its default", async () => {
  const a = await repo.put({ record: record({ id: "a" }), expectedRevision: null });
  await repo.put({ record: record({ id: "b" }), expectedRevision: null });
  const target = await repo.put({ record: record({ id: "target", provider: "new" }), expectedRevision: null });
  const moved = await repo.put({ record: { ...a, provider: "new", isDefault: false, revision: 2 }, expectedRevision: 1 });
  expect(moved.isDefault).toBe(false);
  expect(await repo.findDefault(group)).toEqual(record({ id: "b", isDefault: true, revision: 2 }));
  expect(await repo.findDefault({ ...group, provider: "new" })).toEqual(target);
  const empty = await repo.put({ record: { ...moved, provider: null, isDefault: undefined, revision: 3 }, expectedRevision: 2 });
  expect(empty.isDefault).toBe(true);
});

test("moving a non-default does not promote its old group; explicit defaults clear only peers in the destination", async () => {
  const a = await repo.put({ record: record({ id: "a" }), expectedRevision: null });
  const b = await repo.put({ record: record({ id: "b" }), expectedRevision: null });
  const target = await repo.put({ record: record({ id: "target", provider: null }), expectedRevision: null });
  const moved = await repo.put({ record: { ...b, provider: null, isDefault: true, revision: 2 }, expectedRevision: 1 });
  expect(moved.isDefault).toBe(true);
  expect(await repo.find(a)).toEqual(a);
  expect(await repo.find(target)).toEqual({ ...target, isDefault: false, revision: 2 });
});

test("replacement validation rejects stale revisions, invalid increments and identity changes before uniqueness reads", async () => {
  const a = await repo.put({ record: record({ id: "a" }), expectedRevision: null });
  reads.length = 0;
  await expect(repo.put({ record: a, expectedRevision: null })).rejects.toMatchObject({ code: "conflict" });
  await expect(repo.put({ record: a, expectedRevision: 1 })).rejects.toMatchObject({ code: "invalid-record" });
  await expect(repo.put({ record: { ...a, ownerKey: "other", revision: 2 }, expectedRevision: 1 })).rejects.toMatchObject({ code: "context" });
  expect(reads).toHaveLength(3);
  expect(await repo.find(a)).toEqual(a);
});

test("an update returning no row remains a conflict and rolls back the write", async () => {
  await repo.put({ record: record({ id: "a" }), expectedRevision: null });
  const b = await repo.put({ record: record({ id: "b" }), expectedRevision: null });
  const missingResult: StorageKernel<SecretsVaultDatabase> = { ...kernel,
    run<T>(body: (db: Kysely<SecretsVaultDatabase>) => T | Promise<T>): Promise<T> {
      return kernel.run(db => {
        let update = false;
        return body(db.withPlugin({
          transformQuery({ node }) { update = node.kind === "UpdateQueryNode"; return node; },
          async transformResult({ result }) { return update ? { ...result, rows: [] } : result; },
        }));
      });
    },
  };
  await expect(new SqlSecretsVaultRepo({ kernel: missingResult }).put({ record: { ...b, revision: 2 }, expectedRevision: 1 })).rejects.toMatchObject({ code: "conflict" });
  expect(await repo.find(b)).toEqual(b);
});
