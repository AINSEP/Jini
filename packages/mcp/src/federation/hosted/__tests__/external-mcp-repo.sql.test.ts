import { expect, it, vi } from "vitest";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery, type RawBuilder } from "kysely";
import { VaultError, type VaultRecord, type VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import { externalMcpAccessSnapshot, externalMcpVaultEnvelope } from "../index.js";
import { SqlExternalMcpServerRepo } from "../external-mcp-repo.js";
import { toRow } from "../external-mcp-repo.writes.js";

function fixture({ exists = true, pointers = { env_secret_id: null, oauth_secret_id: null } as { env_secret_id: string | null; oauth_secret_id: string | null }, joined = {} as Record<string, unknown> } = {}) {
  const record: ExternalMcpServerRecord = { workspaceId: "ws", serverId: "server", label: null, provisionedByPluginId: null,
    transport: "stdio", authMode: "none", enabled: true, command: "server", url: null, args: null, allowedToolNames: null,
    writeAllowedToolNames: null, writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: null,
    sealedEnv: null, oauthProviderId: null, oauthGrant: null, oauthClientId: null, oauthEndpointsJson: null, oauthScopesJson: null,
    oauthStatus: null, oauthExpiresAt: null, oauthTokenEnvName: null, oauthRefreshLeaseUntil: null, sealedOAuth: null,
    aadVersion: 1, oauthAadVersion: 1, createdAt: "stamp", updatedAt: "stamp", version: 1 };
  const queries: CompiledQuery[] = [];
  let affected = 0n;
  let statementFailure: Error | undefined;
  const vaultDeletes: Array<{ workspaceId: string; id: string; precedingQuery: string | undefined }> = [];
  let vaultRows = new Map<string, VaultRecord>();
  const driver = new DummyDriver();
  vi.spyOn(driver, "acquireConnection").mockResolvedValue({
    async executeQuery<R>(query: CompiledQuery) {
      queries.push(query);
      if (statementFailure && query.sql.startsWith("insert")) throw statementFailure;
      const row = { ...toRow({ record, pointers }), ...joined };
      const projection = /^select ("[^"]+"(?:, "[^"]+")*) from "servers"/.exec(query.sql)?.[1];
      const columns = projection?.split(", ").map(column => column.slice(1, -1));
      const rows = exists && /^\s*select/i.test(query.sql)
        ? [columns ? Object.fromEntries(Object.entries(row).filter(([column]) => columns.includes(column))) : row]
        : [];
      return { rows: rows as unknown as R[], numAffectedRows: affected };
    },
    async *streamQuery<R>() { yield { rows: [] as R[] }; },
  });
  const db = new Kysely<unknown>({ dialect: { createDriver: () => driver, createAdapter: () => new PostgresAdapter(),
    createIntrospector: db => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler() } });
  const vaultRepo: VaultRepoPort = {
    find: async ({ id }) => vaultRows.get(id) ?? null, list: async () => [...vaultRows.values()],
    put: async ({ record }) => { const row = { ...record, isDefault: record.isDefault ?? false }; vaultRows.set(row.id, row); return row; },
    patchMeta: async () => { throw new Error("unused"); }, delete: async ({ workspaceId, id }) => {
      vaultDeletes.push({ workspaceId, id, precedingQuery: queries.at(-1)?.sql });
      return vaultRows.delete(id);
    },
  };
  const locks: string[] = [];
  const kernel = {
    dialect: "postgres" as const, transport: "test", ready: Promise.resolve(),
    capabilities: { interactiveTransactions: true, atomicBatch: true, transactionalDdl: true, backup: false },
    run: async <T>(fn: (handle: Kysely<unknown>) => T | Promise<T>) => fn(db),
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      const before = new Map(vaultRows);
      try { return await fn(); } catch (error) { vaultRows = before; throw error; }
    },
    lockKey: async (key: string) => { locks.push(key); }, inTransaction: () => true, require: () => {},
    backupTo: async () => {}, close: async () => db.destroy(),
    query: async <Row>(statement: RawBuilder<Row>) => (await statement.execute(db)).rows,
  };
  const repo = new SqlExternalMcpServerRepo({ kernel, vaultRepo, tables: { servers: "servers", vault: "vault" },
    vaultErrors: { create: ({ code }) => new VaultError({ code }) } });
  return { record, repo, queries, locks, vaultRepo, vaultDeletes, setAffected: (value: bigint) => { affected = value; },
    failInsert: (error: Error) => { statementFailure = error; } };
}

it("a missed editor update rolls back staged envelopes", async () => {
  const f = fixture();
  const sealed = externalMcpVaultEnvelope({ record: { workspaceId: "ws", id: "staged", kind: "mcp-env", ownerKey: "server",
    principalId: null, binding: null, provider: null, label: "staged", isDefault: false, revision: 1,
    sealed: { keyId: "key", ciphertext: "cipher", nonce: "nonce", alg: "alg" }, last4: null, tokenLength: null,
    meta: {}, createdAt: "stamp", updatedAt: "stamp" } }, { staged: true });
  expect(await f.repo.updateIfVersion({ record: { ...f.record, sealedEnv: sealed }, expectedVersion: 1,
    replaces: { sealedEnv: null, sealedOAuth: null } })).toBe(false);
  expect(await f.vaultRepo.list({ workspaceId: "ws", kind: "mcp-env", ownerKey: "server", principalId: null })).toEqual([]);
  const update = f.queries.find(query => query.sql.startsWith("update"));
  expect(update?.sql.split(" where ")[1]).toMatch(/"version" = \$\d+/);
  expect(update?.parameters).toContain(1);
});

it("guarded OAuth SQL compares configuration in the write", async () => {
  const f = fixture();
  const sealed = externalMcpVaultEnvelope({ record: { workspaceId: "ws", id: "late-auth", kind: "mcp-auth", ownerKey: "server",
    principalId: null, binding: null, provider: null, label: "late-auth", isDefault: false, revision: 1,
    sealed: { keyId: "key", ciphertext: "late", nonce: "nonce", alg: "alg" }, last4: null, tokenLength: null,
    meta: {}, createdAt: "stamp", updatedAt: "stamp" } }, { staged: true });
  expect(await f.repo.updateOAuthRuntime({ key: f.record, expectedSealedOAuth: null,
    expectedConfig: { createdAt: f.record.createdAt, version: f.record.version },
    patch: { sealedOAuth: sealed, oauthStatus: "connected", oauthExpiresAt: null, oauthRefreshLeaseUntil: null,
      oauthAadVersion: 1, updatedAt: "later" } })).toBe(false);
  const pointers = f.queries.find(query => query.sql.startsWith('select "env_secret_id"'));
  expect(pointers?.sql.split(' from "servers"')[0]).toContain('"created_at"');
  const runtime = f.queries.find(query => query.sql.startsWith("update"))!;
  const where = runtime.sql.split(" where ")[1];
  expect(where).toMatch(/"oauth_secret_id" is null/);
  expect(where).toMatch(/"version" = \$\d+/);
  expect(where).toMatch(/"created_at" = \$\d+/);
  expect(runtime.parameters.slice(-2)).toEqual([1, "stamp"]);
  expect(await f.vaultRepo.list({ workspaceId: "ws", kind: "mcp-auth", ownerKey: "server", principalId: null })).toEqual([]);
  f.queries.length = 0;
  f.setAffected(1n);
  expect(await f.repo.updateIfVersion({ record: f.record, expectedVersion: 1, expectedCreatedAt: "stamp",
    replaces: { sealedEnv: null, sealedOAuth: null } })).toBe(true);
  const edit = f.queries.find(query => query.sql.startsWith("update"))!;
  expect(edit.sql.split(" where ")[1]).toMatch(/"created_at" = \$\d+/);
  expect(edit.parameters.at(-1)).toBe("stamp");
});

it("access update writes no credential columns", async () => {
  const f = fixture(); f.setAffected(1n);
  expect(await f.repo.updateAccessIfCurrent({ workspaceId: "ws", serverId: "server", expected: externalMcpAccessSnapshot({ record: f.record }),
    access: { enabled: false, allowedToolNames: "[]", writeAllowedToolNames: "[]" }, principalId: "actor", nowIso: "now" })).toBe(true);
  const update = f.queries.find(query => query.sql.startsWith("update"))?.sql.split(" where ")[0];
  expect(update).toContain('"enabled"');
  expect(update).not.toMatch(/oauth|env_secret|auth_mode|command/);
  expect(update).toContain('"write_grants_updated_by_principal_id"');
  expect(update).toContain('"write_grants_updated_at"');
  const query = f.queries.find(query => query.sql.startsWith("update"))!;
  expect(query.parameters).toContain("actor");
  expect(query.parameters).toContain("now");
  expect(f.locks).toEqual(["secrets_vault:ws"]);
});

it("only one OAuth refresh lease is acquired", async () => {
  const f = fixture(); f.setAffected(1n);
  expect(await f.repo.tryClaimOAuthRefreshLease({ workspaceId: "ws", serverId: "server", nowIso: "now", leaseUntil: "later" })).toBe(true);
  f.setAffected(0n);
  expect(await f.repo.tryClaimOAuthRefreshLease({ workspaceId: "ws", serverId: "server", nowIso: "now", leaseUntil: "later" })).toBe(false);
  expect(f.queries).toHaveLength(2);
  for (const query of f.queries) expect(query.sql).toMatch(/update .*oauth_refresh_lease_until.*where .*oauth_refresh_lease_until.*is null.*or.*oauth_refresh_lease_until.*<=/);
});

it("hydration never crosses workspaces", async () => {
  const f = fixture();
  expect((await f.repo.listByWorkspaceId("ws"))[0]?.workspaceId).toBe("ws");
  const query = f.queries[0];
  expect(query?.sql).toContain('env.workspace_id=s.workspace_id');
  expect(query?.sql).toContain('oauth.workspace_id=s.workspace_id');
  expect(query?.parameters).toContain("ws");
});

function vaultRow(id: string, kind: "mcp-env" | "mcp-auth"): VaultRecord {
  return { workspaceId: "ws", id, kind, ownerKey: "server", principalId: null, binding: null, provider: null,
    label: id, isDefault: false, revision: 2, sealed: { keyId: "wrap", nonce: "nonce", ciphertext: `cipher-${id}`, alg: "fixture" },
    last4: null, tokenLength: null, meta: {}, createdAt: "stamp", updatedAt: "stamp" };
}

const joinedEnv = {
  env_workspace_id: "ws", env_id: "env-1", env_kind: "mcp-env", env_owner_key: "server", env_principal_id: null, env_binding: null,
  env_provider: null, env_label: "env-1", env_is_default: false, env_revision: "2", env_sealed_key_id: "wrap",
  env_sealed_ciphertext: "cipher-env-1", env_sealed_nonce: "nonce", env_sealed_alg: "fixture",
  env_last4: null, env_token_length: null, env_meta: "{}", env_created_at: "stamp", env_updated_at: "stamp",
};

it("hydrates a joined vault payload without treating its pointer as the ciphertext", async () => {
  const f = fixture({ pointers: { env_secret_id: "env-1", oauth_secret_id: null }, joined: joinedEnv });
  expect(await f.repo.findByServerId({ workspaceId: "ws", serverId: "server" })).toMatchObject({
    serverId: "server", workspaceId: "ws", sealedOAuth: null,
    sealedEnv: { keyId: "wrap", nonce: "nonce", ciphertext: "cipher-env-1", alg: "fixture" },
  });
  expect(f.queries[0]?.parameters).toEqual(["ws", "server"]);
});

it.each([
  ["foreign workspace", { env_workspace_id: "other" }],
  ["foreign server", { env_owner_key: "other" }],
  ["missing joined row", { env_id: null }],
  ["wrong payload kind", { env_kind: "mcp-auth" }],
  ["person-bound payload", { env_principal_id: "person" }],
  ["binding-bound payload", { env_binding: "resource" }],
] as const)("a %s vault join fails closed instead of hydrating the credential", async (_kind, patch) => {
  const f = fixture({ pointers: { env_secret_id: "env-1", oauth_secret_id: null }, joined: { ...joinedEnv, ...patch } });
  await expect(f.repo.findByServerId({ workspaceId: "ws", serverId: "server" })).rejects.toMatchObject({ code: "context" });
});

it.each(["env_sealed_key_id", "env_sealed_ciphertext", "env_sealed_nonce", "env_sealed_alg"] as const)(
  "a joined payload missing %s reports an invalid vault record",
  async field => {
    const f = fixture({ pointers: { env_secret_id: "env-1", oauth_secret_id: null }, joined: { ...joinedEnv, [field]: null } });
    await expect(f.repo.findByServerId({ workspaceId: "ws", serverId: "server" })).rejects.toMatchObject({ code: "invalid-record" });
  },
);

it("an occupied key cannot be inserted, while a failed insert rolls back the staged envelope", async () => {
  const occupied = fixture();
  expect(await occupied.repo.insert({ record: occupied.record })).toBe(false);
  expect(occupied.queries.map(q => q.sql.split(" ", 1)[0])).toEqual(["select"]);

  const empty = fixture({ exists: false });
  const staged = externalMcpVaultEnvelope({ record: vaultRow("new-env", "mcp-env") }, { staged: true });
  const record = { ...empty.record, version: 12, sealedEnv: staged };
  const failure = new Error("insert driver unavailable");
  empty.failInsert(failure);
  await expect(empty.repo.insert({ record })).rejects.toBe(failure);
  expect(await empty.vaultRepo.find({ workspaceId: "ws", id: "new-env" })).toBeNull();
  const insert = empty.queries.find(q => q.sql.startsWith("insert"));
  expect(insert?.sql).toMatch(/"version"\) values/);
  expect(insert?.parameters.at(-1)).toBe(1);
  expect(empty.locks).toEqual(["secrets_vault:ws"]);
  const available = fixture({ exists: false });
  expect(await available.repo.insert({ record })).toBe(true);
  expect(await available.vaultRepo.find({ workspaceId: "ws", id: "new-env" })).toEqual({ ...vaultRow("new-env", "mcp-env"), revision: 1 });
  expect(available.queries.at(-1)?.parameters.at(-1)).toBe(1);
});

it("upserting new pointers unlinks old credentials before vault deletion", async () => {
  const f = fixture({ pointers: { env_secret_id: "old-env", oauth_secret_id: "old-oauth" } });
  for (const old of [vaultRow("old-env", "mcp-env"), vaultRow("old-oauth", "mcp-auth")]) await f.vaultRepo.put({ record: old });
  const newEnv = vaultRow("next-env", "mcp-env");
  await f.repo.upsert({ ...f.record, sealedEnv: externalMcpVaultEnvelope({ record: newEnv }, { staged: true }) });
  const write = f.queries.find(q => q.sql.startsWith("insert"));
  expect(write?.sql).toMatch(/on conflict \("workspace_id", "server_id"\) do update/);
  expect(write?.parameters).toContain("next-env");
  expect(write?.parameters).not.toContain("old-env");
  expect(f.vaultDeletes).toEqual(["old-env", "old-oauth"].map(id => ({ workspaceId: "ws", id, precedingQuery: write?.sql })));
  expect(await f.vaultRepo.find({ workspaceId: "ws", id: "old-env" })).toBeNull();
  expect(await f.vaultRepo.find({ workspaceId: "ws", id: "old-oauth" })).toBeNull();
  expect(await f.vaultRepo.find({ workspaceId: "ws", id: "next-env" })).toEqual({ ...newEnv, revision: 1 });
});

it("deletion unlinks the exact workspace/server pair before removing both associated envelopes", async () => {
  const key = { workspaceId: "ws", serverId: "server" };
  const absent = fixture({ exists: false });
  expect(await absent.repo.deleteByServerId(key)).toBe(false);
  expect(absent.queries.map(q => q.sql.split(" ", 1)[0])).toEqual(["select"]);
  expect(absent.vaultDeletes).toEqual([]);

  const f = fixture({ pointers: { env_secret_id: "old-env", oauth_secret_id: "old-auth" } });
  for (const old of [vaultRow("old-env", "mcp-env"), vaultRow("old-auth", "mcp-auth"), vaultRow("unrelated", "mcp-env")]) {
    await f.vaultRepo.put({ record: old });
  }
  expect(await f.repo.deleteByServerId(key)).toBe(true);
  const expectedSql = 'delete from "servers" where "workspace_id" = $1 and "server_id" = $2';
  expect(f.queries.at(-1)).toMatchObject({ sql: expectedSql, parameters: ["ws", "server"] });
  expect(f.vaultDeletes).toEqual(["old-env", "old-auth"].map(id => ({ workspaceId: "ws", id, precedingQuery: expectedSql })));
  expect((await f.vaultRepo.list({ workspaceId: "ws", kind: "mcp-env", ownerKey: "server", principalId: null })).map(row => row.id)).toEqual(["unrelated"]);
});

it("refreshing OAuth retires the old envelope and releasing a lease changes only that connection's lease", async () => {
  const f = fixture({ pointers: { env_secret_id: null, oauth_secret_id: "old-auth" } });
  f.setAffected(1n);
  const old = vaultRow("old-auth", "mcp-auth");
  const next = vaultRow("new-auth", "mcp-auth");
  await f.vaultRepo.put({ record: old });
  expect(await f.repo.updateOAuthRuntime({ key: f.record, expectedSealedOAuth: externalMcpVaultEnvelope({ record: old }),
    patch: { sealedOAuth: externalMcpVaultEnvelope({ record: next }, { staged: true }), oauthStatus: "connected", oauthExpiresAt: "later",
      oauthRefreshLeaseUntil: null, oauthAadVersion: 1, updatedAt: "now" } })).toBe(true);
  const write = f.queries.at(-1);
  expect(write?.sql.split(" where ")[1]).toBe('"workspace_id" = $6 and "server_id" = $7 and "oauth_secret_id" = $8');
  expect(write?.parameters).toEqual(["new-auth", "connected", "later", null, "now", "ws", "server", "old-auth"]);
  expect(await f.vaultRepo.find({ workspaceId: "ws", id: "old-auth" })).toBeNull();
  expect(await f.vaultRepo.find({ workspaceId: "ws", id: "new-auth" })).toEqual({ ...next, revision: 1 });
  await f.repo.releaseOAuthRefreshLease(f.record);
  expect(f.queries.at(-1)).toMatchObject({
    sql: 'update "servers" set "oauth_refresh_lease_until" = $1 where "workspace_id" = $2 and "server_id" = $3',
    parameters: [null, "ws", "server"],
  });
});
