import assert from "node:assert/strict";
import { afterAll, beforeEach, describe, test } from "vitest";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { sql, type Kysely } from "kysely";
import { InMemoryVaultRepo, SecretsVaultService, createVaultMetaParsers, type VaultRecord } from "@jini-ai/platform/secrets/credential-sets";
import { AesGcmSecretSealer } from "@jini-ai/platform/secrets";
import { InMemoryKeyring } from "@jini-ai/platform/secrets/testing";
import { SqlSecretsVaultRepo, type SecretsVaultDatabase } from "../secrets-vault/index.js";
import { sqliteKernel } from "../kernel/sqlite/index.js";
import { openPgliteKernel } from "../kernel/pglite/index.js";
import type { StorageKernel } from "../kernel/port.js";

// Follow kernel.test.ts's embedded-driver matrix; there is no shared vault contract harness.
const cases = [
  { name: "sqlite", kernel: sqliteKernel<SecretsVaultDatabase>(new Database(":memory:")) },
  { name: "pglite", kernel: openPgliteKernel<SecretsVaultDatabase>({ PGlite }) },
];
afterAll(async () => { for (const { kernel } of cases) await kernel.close(); });
function row(id: string, patch: Partial<VaultRecord> = {}): VaultRecord {
  return { workspaceId: "ws", id, kind: "vendor", ownerKey: "deploy", principalId: null, binding: null,
    provider: "host", label: id, isDefault: false, revision: 1, sealed: null, last4: null, tokenLength: null,
    meta: { accountLabel: null }, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z", ...patch };
}
const query = { workspaceId: "ws", kind: "vendor" as const, ownerKey: "deploy", principalId: null, provider: "host" };

for (const { name, kernel } of cases) describe(`secrets vault contract [${name}]`, () => {
  const repo = new SqlSecretsVaultRepo({ kernel });
  beforeEach(async () => {
    await kernel.run(db => db.schema.dropTable("secrets_vault").ifExists().execute());
    await kernel.run(db => db.schema.createTable("secrets_vault")
      .addColumn("workspace_id", "text", c => c.notNull()).addColumn("id", "text", c => c.notNull())
      .addColumn("kind", "text", c => c.notNull()).addColumn("owner_key", "text", c => c.notNull())
      .addColumn("principal_id", "text").addColumn("binding", "text").addColumn("provider", "text")
      .addColumn("label", "text", c => c.notNull()).addColumn("is_default", "boolean", c => c.notNull())
      .addColumn("revision", "integer", c => c.notNull()).addColumn("sealed_key_id", "text")
      .addColumn("sealed_ciphertext", "text").addColumn("sealed_nonce", "text").addColumn("sealed_alg", "text")
      .addColumn("last4", "text").addColumn("token_length", "integer")
      .addColumn("meta", kernel.dialect === "sqlite" ? "text" : "jsonb", c => c.notNull())
      .addColumn("created_at", "text", c => c.notNull()).addColumn("updated_at", "text", c => c.notNull())
      .addPrimaryKeyConstraint("vault_pk", ["workspace_id", "id"]).execute());
    // Null and empty string are distinct scopes. Flags avoid sentinel collisions in either DB.
    await kernel.execute(sql`CREATE UNIQUE INDEX vault_default ON secrets_vault
      (workspace_id, kind, owner_key, (principal_id IS NULL), coalesce(principal_id, ''),
       (provider IS NULL), coalesce(provider, '')) WHERE is_default = true`);
    await kernel.execute(sql`CREATE UNIQUE INDEX vault_label ON secrets_vault
      (workspace_id, kind, owner_key, (principal_id IS NULL), coalesce(principal_id, ''),
       (provider IS NULL), coalesce(provider, ''), label)`);
    await kernel.execute(sql`CREATE INDEX vault_lookup ON secrets_vault
      (workspace_id, kind, owner_key, principal_id, provider, is_default)`);
    await kernel.execute(kernel.dialect === "sqlite"
      ? sql`CREATE INDEX vault_promotion ON secrets_vault (workspace_id, kind, owner_key, principal_id, provider, updated_at DESC, id COLLATE BINARY DESC)`
      : sql`CREATE INDEX vault_promotion ON secrets_vault (workspace_id, kind, owner_key, principal_id, provider, updated_at DESC, id COLLATE "C" DESC)`);
  });

  test("put/default/delete/CAS match the memory adapter under a partial UNIQUE default index", async () => {
    const memory = new InMemoryVaultRepo({});
    for (const adapter of [repo, memory]) {
      const a = await adapter.put({ record: row("a"), expectedRevision: null });
      assert.equal(a.isDefault, true);
      await adapter.put({ record: row("b"), expectedRevision: null });
      await adapter.put({ record: row("c", { isDefault: true }), expectedRevision: null });
      assert.equal((await adapter.find(a))?.revision, 2);
      assert.equal((await adapter.findDefault(query))?.id, "c");
      await assert.rejects(adapter.put({ record: row("bad", { label: "a", isDefault: true }), expectedRevision: null }), { code: "conflict" });
      await assert.rejects(adapter.put({ record: row("a"), expectedRevision: null }), { code: "conflict" });
      await assert.rejects(adapter.put({ record: row("missing", { revision: 2 }), expectedRevision: 1 }), { code: "conflict" });
      await assert.rejects(adapter.put({ record: row("a", { revision: 3, binding: "other" }), expectedRevision: 2 }), { code: "context" });
      await assert.rejects(adapter.delete({ workspaceId: "ws", id: "c", expectedRevision: 0 }), { code: "conflict" });
      assert.equal(await adapter.delete({ workspaceId: "ws", id: "c", expectedRevision: 1 }), true);
      assert.equal(await adapter.delete({ workspaceId: "ws", id: "c", expectedRevision: 1 }), false);
      assert.equal((await adapter.find({ workspaceId: "ws", id: "b" }))?.isDefault, true);
      assert.equal((await adapter.findDefault(query))?.id, "b");
    }
    assert.deepEqual(await repo.list(query), await memory.list(query));
  });

  test("findDefault isolates every group dimension, distinguishes null/empty and returns independent records", async () => {
    for (const adapter of [repo, new InMemoryVaultRepo({})]) {
      assert.equal(await adapter.findDefault(query), null);
      for (const record of [row("a"), row("other", { workspaceId: "other" }), row("owner", { ownerKey: "other" }),
        row("principal", { principalId: "p" }), row("kind", { kind: "source-control" }),
        row("null", { provider: null }), row("empty", { provider: "" })]) {
        await adapter.put({ record, expectedRevision: null });
        assert.deepEqual(await adapter.findDefault({ ...record, provider: record.provider }), { ...record, isDefault: true });
      }
      const found = (await adapter.findDefault(query))!;
      found.meta.accountLabel = "alias";
      assert.equal((await adapter.findDefault(query))?.meta.accountLabel, null);
      await adapter.put({ record: row("b", { updatedAt: "2026-10-12T00:00:00Z" }), expectedRevision: null });
      await adapter.delete({ workspaceId: "ws", id: "a", expectedRevision: 1 });
      assert.equal((await adapter.findDefault(query))?.id, "b");
      assert.equal((await adapter.findDefault(query))?.revision, 2);
      await adapter.delete({ workspaceId: "ws", id: "b", expectedRevision: 2 });
      assert.equal(await adapter.findDefault(query), null);
      assert.equal((await adapter.findDefault({ ...query, provider: null }))?.id, "null");
      assert.equal((await adapter.findDefault({ ...query, provider: "" }))?.id, "empty");
    }
  });

  test("executed group queries stay narrow: existence checks, one default, and one promotion identity", async () => {
    const statements: string[] = [];
    const recordingKernel: StorageKernel<SecretsVaultDatabase> = { ...kernel,
      run<T>(body: (db: Kysely<SecretsVaultDatabase>) => T | Promise<T>): Promise<T> {
        return kernel.run(db => body(db.withPlugin({
          transformQuery(args) { statements.push(db.getExecutor().compileQuery(args.node, args.queryId).sql); return args.node; },
          async transformResult({ result }) { return result; },
        })));
      },
    };
    const measured = new SqlSecretsVaultRepo({ kernel: recordingKernel });
    await measured.put({ record: row("a"), expectedRevision: null });
    await measured.put({ record: row("b"), expectedRevision: null });
    const groupReads = statements.filter(q => q.startsWith("select") && q.includes('"kind"'));
    assert.ok(groupReads.length > 0);
    for (const statement of groupReads) { assert.match(statement, /^select "id" from/); assert.match(statement, /limit/); }
    statements.length = 0;
    assert.equal((await measured.findDefault(query))?.id, "a");
    assert.equal(statements.length, 1);
    assert.match(statements[0]!, /"provider" = .* and "is_default" = .* limit/);
    // findOne is a singleton contract, not a default/ordering selector over a vendor group.
    const singleton = await measured.put({ record: row("singleton", { kind: "site-assistant", provider: null }), expectedRevision: null });
    statements.length = 0;
    assert.deepEqual(await measured.findOne({ workspaceId: "ws", kind: "site-assistant", ownerKey: "deploy", principalId: null }), singleton);
    assert.equal(statements.length, 1);
    assert.match(statements[0]!, /"workspace_id" = .* and "kind" = .* and "owner_key" = .* and "principal_id" is null limit/);
    assert.doesNotMatch(statements[0]!, /where.*"(provider|is_default)"/);
    statements.length = 0;
    await measured.delete({ workspaceId: "ws", id: "a", expectedRevision: 1 });
    const promotion = statements.find(q => q.startsWith('select "id", "updated_at"'));
    assert.ok(promotion);
    assert.match(promotion, /order by "updated_at" desc, id COLLATE (BINARY|"C") desc limit/);
    assert.equal((await measured.findDefault(query))?.id, "b");
    statements.length = 0;
    await measured.put({ record: row("b", { isDefault: true, revision: 3 }), expectedRevision: 2 });
    assert.equal(statements.filter(q => q.startsWith("select") && q.includes('"kind"')).length, 0);
  });

  test("scope, nullable envelopes and JSON patches round-trip with no ciphertext replacement", async () => {
    const source = row("a", { sealed: { keyId: "v1", ciphertext: "cipher", nonce: "nonce", alg: "aes-256-gcm" } });
    const initial = await repo.put({ record: source, expectedRevision: null });
    const patched = await repo.patchMeta({ workspaceId: "ws", id: "a", expectedRevision: 1,
      patch: { accountLabel: "verified", lastRun: { copied: true, tableCount: 2 } }, updatedAt: "later" });
    assert.deepEqual(patched.sealed, initial.sealed);
    assert.equal(patched.isDefault, true);
    assert.equal(patched.revision, 2);
    assert.deepEqual(patched.meta, { accountLabel: "verified", lastRun: { copied: true, tableCount: 2 } });
    await assert.rejects(repo.patchMeta({ workspaceId: "ws", id: "a", expectedRevision: 1, patch: {}, updatedAt: "stale" }), { code: "conflict" });
    await repo.put({ record: { ...patched, revision: 3, sealed: null }, expectedRevision: 2 });
    assert.equal((await repo.find(initial))?.sealed, null);
    for (const record of [row("a", { workspaceId: "other" }), row("owner", { ownerKey: "other" }),
      row("principal", { principalId: "p" }), row("kind", { kind: "source-control" }),
      row("null", { provider: null }), row("empty", { provider: "" })]) {
      assert.equal((await repo.put({ record, expectedRevision: null })).isDefault, true);
    }
    assert.equal((await repo.list(query)).length, 1);
    assert.equal((await repo.list({ ...query, provider: null }))[0]?.id, "null");
    assert.equal((await repo.list({ ...query, provider: "" }))[0]?.id, "empty");
    assert.equal(await repo.find({ workspaceId: "absent", id: "a" }), null);
  });

  test("promotion chooses updatedAt then binary ID, independent of database collation", async () => {
    for (const record of [row("default"), row("z"), row("é"), row("old", { updatedAt: "2026-10-10T00:00:00Z" }), row("foreign", { provider: "other" })]) {
      await repo.put({ record, expectedRevision: null });
    }
    await repo.delete({ workspaceId: "ws", id: "default", expectedRevision: 1 });
    assert.equal((await repo.find({ workspaceId: "ws", id: "é" }))?.isDefault, true);
    assert.equal((await repo.find({ workspaceId: "ws", id: "é" }))?.revision, 2);
    assert.equal((await repo.find({ workspaceId: "ws", id: "foreign" }))?.revision, 1);
  });

  test("SQL and memory promotion agree for supplementary IDs where UTF-16 and UTF-8 orders differ", async () => {
    for (const adapter of [repo, new InMemoryVaultRepo({})]) {
      for (const id of ["default", "\uE000", "\u{10000}"]) await adapter.put({ record: row(id), expectedRevision: null });
      await adapter.delete({ workspaceId: "ws", id: "default", expectedRevision: 1 });
      assert.equal((await adapter.findDefault(query))?.id, "\u{10000}");
    }
  });

  test("writes join host transactions; rollback restores previous default and envelope", async () => {
    const original = await repo.put({ record: row("a"), expectedRevision: null });
    await assert.rejects(kernel.transaction(async () => {
      await repo.put({ record: row("b", { isDefault: true }), expectedRevision: null });
      await repo.patchMeta({ workspaceId: "ws", id: "b", expectedRevision: 1, patch: { accountLabel: "changed" }, updatedAt: "later" });
      throw new Error("rollback");
    }), /rollback/);
    assert.deepEqual(await repo.list(query), [original]);
  });

  test("concurrent same-revision replacements produce one winner and concurrent defaults remain singular", async () => {
    const original = await repo.put({ record: row("a"), expectedRevision: null });
    const results = await Promise.allSettled(["one", "two"].map(label => repo.put({ record: { ...original, label, revision: 2 }, expectedRevision: 1 })));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected").length, 1);
    await Promise.all(["b", "c"].map(id => repo.put({ record: row(id, { isDefault: true }), expectedRevision: null })));
    assert.equal((await repo.list(query)).filter(r => r.isDefault).length, 1);
  });

  test("singleton lookup ignores provider/default and supports every optional scope without aliases", async () => {
    for (const adapter of [repo, new InMemoryVaultRepo({})]) {
      const source = row("singleton", { kind: "personal-execution", principalId: "p", provider: null });
      const saved = await adapter.put({ record: source, expectedRevision: null });
      await adapter.put({ record: { ...saved, isDefault: false, revision: 2 }, expectedRevision: 1 });
      const scope = { workspaceId: "ws", kind: source.kind };
      for (const optional of [{}, { ownerKey: "deploy" }, { principalId: "p" }, { ownerKey: "deploy", principalId: "p" }]) {
        const found = (await adapter.findOne({ ...scope, ...optional }))!;
        assert.equal(found.id, "singleton");
        assert.equal(found.isDefault, false);
        found.meta.accountLabel = "alias";
        assert.equal((await adapter.findOne({ ...scope, ...optional }))?.meta.accountLabel, null);
      }
      assert.equal(await adapter.findOne({ ...scope, principalId: null }), null);
      assert.equal(await adapter.findOne({ ...scope, principalId: "" }), null);
      assert.equal(await adapter.findOne({ ...scope, ownerKey: "other" }), null);
      assert.equal(await adapter.findOne({ ...scope, workspaceId: "other" }), null);
      assert.equal(await adapter.findOne({ ...scope, kind: "site-assistant" }), null);
      await adapter.delete({ ...source, expectedRevision: 2 });
      assert.equal(await adapter.findOne(scope), null);
      await adapter.put({ record: source, expectedRevision: null });
      assert.equal((await adapter.findOne(scope))?.id, source.id);
    }
  });

  test("provider moves promote newest remaining rows and honor destination default rules without changing envelopes", async () => {
    for (const adapter of [repo, new InMemoryVaultRepo({})]) {
      const original = await adapter.put({ record: row("a", { binding: "https://bound", sealed: {
        keyId: "v1", ciphertext: "cipher", nonce: "nonce", alg: "aes-256-gcm" }, last4: "tail", tokenLength: 12 }), expectedRevision: null });
      for (const id of ["old", "\uE000", "\u{10000}"]) await adapter.put({ record: row(id, {
        updatedAt: id === "old" ? "2026-10-10T00:00:00Z" : original.updatedAt }), expectedRevision: null });
      await adapter.put({ record: row("target", { provider: "new" }), expectedRevision: null });
      const moved = await adapter.put({ record: { ...original, provider: "new", isDefault: false, revision: 2 }, expectedRevision: 1 });
      assert.deepEqual(moved.sealed, original.sealed);
      assert.equal(moved.id, original.id);
      assert.equal(moved.createdAt, original.createdAt);
      assert.equal(moved.binding, original.binding);
      assert.equal(moved.last4, original.last4);
      assert.equal(moved.tokenLength, original.tokenLength);
      assert.equal(moved.isDefault, false);
      assert.equal((await adapter.findDefault(query))?.id, "\u{10000}");
      assert.equal((await adapter.findDefault(query))?.revision, 2);
      assert.equal((await adapter.findDefault({ ...query, provider: "new" }))?.id, "target");
      const empty = await adapter.put({ record: { ...moved, provider: null, revision: 3 }, expectedRevision: 2 });
      assert.equal(empty.isDefault, true);
      const selected = await adapter.put({ record: { ...empty, provider: "new", isDefault: true, revision: 4 }, expectedRevision: 3 });
      assert.equal(selected.isDefault, true);
      assert.equal(await adapter.findDefault({ ...query, provider: null }), null);
      assert.equal((await adapter.find({ ...query, id: "target" }))?.revision, 2);
      assert.equal((await adapter.find({ ...query, id: "target" }))?.isDefault, false);
      await assert.rejects(adapter.put({ record: { ...selected, provider: "stale", revision: 4 }, expectedRevision: 3 }), { code: "conflict" });
      for (const patch of [{ kind: "source-control" as const }, { ownerKey: "other" }, { principalId: "p" }, { binding: null }, { createdAt: "other" }]) {
        await assert.rejects(adapter.put({ record: { ...selected, ...patch, provider: "another", revision: 5 }, expectedRevision: 4 }), { code: "context" });
      }
    }
  });

  test("a same-label destination collision rejects a provider move before changing either group's defaults", async () => {
    for (const adapter of [repo, new InMemoryVaultRepo({})]) {
      const a = await adapter.put({ record: row("a"), expectedRevision: null });
      await adapter.put({ record: row("b"), expectedRevision: null });
      await adapter.put({ record: row("target", { provider: "new", label: a.label }), expectedRevision: null });
      const { provider: _provider, ...scope } = query;
      const before = await adapter.list(scope);
      await assert.rejects(adapter.put({ record: { ...a, provider: "new", revision: 2 }, expectedRevision: 1 }), { code: "conflict" });
      assert.deepEqual(await adapter.list(scope), before);
    }
  });

  test("mixed batch rollback restores deletes, promotion, JSON patches, defaults and singleton indexes", async () => {
    for (const adapter of [repo, new InMemoryVaultRepo({})]) {
      await adapter.put({ record: row("a"), expectedRevision: null });
      await adapter.put({ record: row("b"), expectedRevision: null });
      const singleton = await adapter.put({ record: row("singleton", { kind: "site-assistant", provider: null }), expectedRevision: null });
      const before = await adapter.list(query);
      await assert.rejects(adapter.applyBatch({ ops: [
        { delete: { workspaceId: "ws", id: "singleton", expectedRevision: 1 } },
        { delete: { workspaceId: "ws", id: "a", expectedRevision: 1 } },
        { patchMeta: { workspaceId: "ws", id: "b", expectedRevision: 2, patch: { accountLabel: "changed" }, updatedAt: "later" } },
        { put: { record: row("c", { isDefault: true }), expectedRevision: null } },
        { delete: { workspaceId: "ws", id: "b", expectedRevision: 1 } },
      ] }), { code: "conflict" });
      assert.deepEqual(await adapter.list(query), before);
      assert.deepEqual(await adapter.findDefault(query), before.find(record => record.id === "a"));
      assert.deepEqual(await adapter.findOne({ workspaceId: "ws", kind: "site-assistant", ownerKey: "deploy", principalId: null }), singleton);
      assert.equal(await adapter.find({ ...query, id: "c" }), null);
      const results = await adapter.applyBatch({ ops: [
        { put: { record: row("c"), expectedRevision: null } },
        { patchMeta: { workspaceId: "ws", id: "c", expectedRevision: 1, patch: { accountLabel: "changed" }, updatedAt: "later" } },
        { delete: { workspaceId: "ws", id: "b", expectedRevision: 1 } },
      ] });
      assert.equal(results.length, 3);
      assert.equal(results[2], true);
      assert.equal((await adapter.find({ ...query, id: "c" }))?.meta.accountLabel, "changed");
      assert.equal((await adapter.find({ ...query, id: "c" }))?.revision, 2);
      assert.equal(await adapter.find({ ...query, id: "b" }), null);
    }
  });

  test("batch joins a host transaction and host failure rolls every operation back", async () => {
    const original = await repo.put({ record: row("a"), expectedRevision: null });
    await assert.rejects(kernel.transaction(async () => {
      await repo.applyBatch({ ops: [
        { put: { record: row("b", { isDefault: true }), expectedRevision: null } },
        { patchMeta: { workspaceId: "ws", id: "b", expectedRevision: 1, patch: { accountLabel: "changed" }, updatedAt: "later" } },
      ] });
      throw new Error("host rollback");
    }), /host rollback/);
    assert.deepEqual(await repo.list(query), [original]);
  });

  test("failed batch restores both groups after a provider move has promoted and displaced defaults", async () => {
    for (const adapter of [repo, new InMemoryVaultRepo({})]) {
      const original = await adapter.put({ record: row("a"), expectedRevision: null });
      await adapter.put({ record: row("b"), expectedRevision: null });
      await adapter.put({ record: row("target", { provider: "new" }), expectedRevision: null });
      const { provider: _provider, ...scope } = query;
      const before = await adapter.list(scope);
      await assert.rejects(adapter.applyBatch({ ops: [
        { put: { record: { ...original, provider: "new", revision: 2 }, expectedRevision: 1 } },
        { patchMeta: { workspaceId: "ws", id: "missing", expectedRevision: 1, patch: {}, updatedAt: "later" } },
      ] }), { code: "conflict" });
      assert.deepEqual(await adapter.list(scope), before);
      assert.equal((await adapter.findDefault(query))?.id, "a");
      assert.equal((await adapter.findDefault({ ...query, provider: "new" }))?.id, "target");
    }
  });

  test("prepared service writes commit inside a host transaction, reopen after a provider move and roll back late conflicts", async () => {
    const keyring = new InMemoryKeyring({ hkdfSalt: "vault-sql-contract" });
    const service = new SecretsVaultService({ repo, keyring, sealer: new AesGcmSecretSealer({ keyring }),
      metaParsers: createVaultMetaParsers({}), authorize: async () => {}, now: () => "2026-10-11T00:00:00Z", newId: () => "generated" });
    const scope = { workspaceId: "ws", kind: "vendor" as const, ownerKey: "deploy", principalId: null, binding: null };
    const input = { ...scope, expectedRevision: null, provider: "host", label: "Prepared", meta: { accountLabel: null },
      payload: { token: "abcdefghijkl" }, hintToken: "abcdefghijkl" };
    const prepared = await service.prepare(input);
    assert.equal(await repo.find(prepared), null);
    await kernel.transaction(() => service.commitPrepared({ records: [prepared], deletes: [], expectedRevisions: { generated: null } }));
    assert.deepEqual((await service.findOne(scope))?.payload, input.payload);
    assert.deepEqual((await repo.find(prepared))?.sealed, prepared.sealed);
    await service.put({ ...input, id: prepared.id, expectedRevision: 1, provider: "moved", payload: undefined });
    assert.deepEqual((await repo.find(prepared))?.sealed, prepared.sealed);
    assert.deepEqual((await service.findOne(scope))?.payload, input.payload);
    const before = await repo.find(prepared);
    const records = await Promise.all(["b", "c"].map(id => service.prepare({ ...input, id, label: "Duplicate", provider: "moved", isDefault: true })));
    await assert.rejects(service.commitPrepared({ records, deletes: [], expectedRevisions: { b: null, c: null } }), { code: "conflict" });
    assert.deepEqual(await repo.find(prepared), before);
    assert.equal(await repo.find({ ...scope, id: "b" }), null);
    assert.equal(await repo.find({ ...scope, id: "c" }), null);
  });

  test("memory polling readers see only the complete batch and concurrent mutations are retained", async () => {
    const memory = new InMemoryVaultRepo({});
    const a = await memory.put({ record: row("a"), expectedRevision: null });
    const b = await memory.put({ record: row("b"), expectedRevision: null });
    const before = memory.list(query);
    const batch = memory.applyBatch({ ops: [a, b].map(record => ({ put: {
      record: { ...record, meta: { accountLabel: "batch" }, revision: 2 }, expectedRevision: 1,
    } })) });
    const during = memory.list(query);
    const concurrent = memory.put({ record: row("concurrent"), expectedRevision: null });
    await batch;
    await concurrent;
    assert.deepEqual(await before, [a, b]);
    assert.deepEqual((await during).map(record => record.meta.accountLabel), ["batch", "batch"]);
    assert.equal((await memory.list(query)).length, 3);
    assert.deepEqual(await memory.applyBatch({ ops: [] }), []);
  });
});
