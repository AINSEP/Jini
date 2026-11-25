import { expect, it, vi } from "vitest";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type CompiledQuery, type RawBuilder } from "kysely";
import { VaultError, type VaultRecord, type VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import { externalMcpAccessSnapshot, externalMcpVaultEnvelope } from "../../federation/hosted/index.js";
import { SqlExternalMcpServerRepo } from "../external-mcp-repo.js";
import { toRow } from "../external-mcp-repo.writes.js";

function fixture() {
  const record: ExternalMcpServerRecord = { workspaceId: "ws", serverId: "server", label: null, provisionedByPluginId: null,
    transport: "stdio", authMode: "none", enabled: true, command: "server", url: null, args: null, allowedToolNames: null,
    writeAllowedToolNames: null, writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: null,
    sealedEnv: null, oauthProviderId: null, oauthGrant: null, oauthClientId: null, oauthEndpointsJson: null, oauthScopesJson: null,
    oauthStatus: null, oauthExpiresAt: null, oauthTokenEnvName: null, oauthRefreshLeaseUntil: null, sealedOAuth: null,
    aadVersion: 1, oauthAadVersion: 1, createdAt: "stamp", updatedAt: "stamp", version: 1 };
  const queries: CompiledQuery[] = [];
  let affected = 0n;
  let vaultRows = new Map<string, VaultRecord>();
  const driver = new DummyDriver();
  vi.spyOn(driver, "acquireConnection").mockResolvedValue({
    async executeQuery<R>(query: CompiledQuery) {
      queries.push(query);
      const rows = query.sql.startsWith("select") ? [toRow({ record, pointers: { env_secret_id: null, oauth_secret_id: null } })] : [];
      return { rows: rows as unknown as R[], numAffectedRows: affected };
    },
    async *streamQuery<R>() { yield { rows: [] as R[] }; },
  });
  const db = new Kysely<unknown>({ dialect: { createDriver: () => driver, createAdapter: () => new PostgresAdapter(),
    createIntrospector: db => new PostgresIntrospector(db), createQueryCompiler: () => new PostgresQueryCompiler() } });
  const vaultRepo: VaultRepoPort = {
    find: async ({ id }) => vaultRows.get(id) ?? null, list: async () => [...vaultRows.values()],
    put: async ({ record }) => { const row = { ...record, isDefault: record.isDefault ?? false }; vaultRows.set(row.id, row); return row; },
    patchMeta: async () => { throw new Error("unused"); }, delete: async ({ id }) => vaultRows.delete(id),
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
  return { record, repo, queries, locks, vaultRepo, setAffected: (value: bigint) => { affected = value; } };
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
  expect(f.queries.some(query => query.sql.startsWith("update"))).toBe(true);
});

it("access update writes no credential columns", async () => {
  const f = fixture(); f.setAffected(1n);
  expect(await f.repo.updateAccessIfCurrent({ workspaceId: "ws", serverId: "server", expected: externalMcpAccessSnapshot({ record: f.record }),
    access: { enabled: false, allowedToolNames: "[]", writeAllowedToolNames: "[]" }, principalId: "actor", nowIso: "now" })).toBe(true);
  const update = f.queries.find(query => query.sql.startsWith("update"))?.sql.split(" where ")[0];
  expect(update).toContain('"enabled"');
  expect(update).not.toMatch(/oauth|env_secret|auth_mode|command/);
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
