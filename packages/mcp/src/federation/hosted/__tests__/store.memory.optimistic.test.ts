/**
 * Lost-update contract of the in-memory `ExternalMcpServerRepoPort` (design S1, rules M1/M7): the
 * edit write compares `version` and both credential pointers in the write; the runtime write
 * touches only OAuth runtime columns and never advances `version`; an access approval advances it.
 */
import { describe, expect, test } from "vitest";
import type { VaultRecord, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import type { ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import { externalMcpAccessSnapshot, externalMcpVaultEnvelope, InMemoryExternalMcpServerRepo } from "../index.js";

class StubVaultError extends Error {
  constructor(readonly code: string) { super(`vault: ${code}`); }
}
function memoryVault(): VaultRepoPort {
  const rows = new Map<string, VaultRecord>();
  const key = (i: { workspaceId: string; id: string }) => `${i.workspaceId}/${i.id}`;
  return {
    find: async (i) => structuredClone(rows.get(key(i)) ?? null),
    list: async () => [...rows.values()],
    put: async ({ record }) => { const saved: VaultRecord = { ...record, isDefault: record.isDefault ?? false }; rows.set(key(record), saved); return structuredClone(saved); },
    patchMeta: async () => { throw new StubVaultError("conflict"); },
    delete: async (i) => rows.delete(key(i)),
  };
}
const ports = { vault: { createMemoryRepo: memoryVault, createService: () => { throw new Error("unused"); } }, vaultErrors: { create: ({ code }: { code: string }) => new StubVaultError(code) } };
const NOW = "2026-11-17T00:00:00.000Z";
const LATER = "2026-11-17T01:00:00.000Z";

function envelope(record: ExternalMcpServerRecord, kind: "mcp-env" | "mcp-auth", id: string, ciphertext: string) {
  return externalMcpVaultEnvelope({ record: { workspaceId: record.workspaceId, id, kind, ownerKey: record.serverId, principalId: null, binding: null,
    provider: null, label: id, isDefault: true, revision: 1, sealed: { keyId: "k", ciphertext, nonce: "bg==", alg: "toy" }, meta: {}, last4: null, tokenLength: null, createdAt: NOW, updatedAt: NOW } }, { staged: true })!;
}
function row(overrides: Partial<ExternalMcpServerRecord> = {}): ExternalMcpServerRecord {
  return { workspaceId: "ws", serverId: "linear", label: "Linear", provisionedByPluginId: null, transport: "http", authMode: "oauth", enabled: true, command: null,
    url: "https://mcp.example/mcp", args: "[]", allowedToolNames: '["a"]', writeAllowedToolNames: "[]", writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null,
    envNames: "[]", sealedEnv: null, oauthProviderId: null, oauthGrant: "authorization_code", oauthClientId: "client", oauthEndpointsJson: null, oauthScopesJson: null,
    oauthStatus: "connected", oauthExpiresAt: LATER, oauthTokenEnvName: null, oauthRefreshLeaseUntil: null, sealedOAuth: null, aadVersion: 1, oauthAadVersion: 1,
    createdAt: NOW, updatedAt: NOW, version: 1, ...overrides };
}
async function seeded() {
  const repo = new InMemoryExternalMcpServerRepo(ports);
  const base = row();
  const inserted = await repo.insert({ record: { ...base, sealedOAuth: envelope(base, "mcp-auth", "auth-1", "c1") } });
  expect(inserted).toBe(true);
  return { repo, stored: (await repo.findByServerId({ workspaceId: "ws", serverId: "linear" }))! };
}
const replaces = (r: ExternalMcpServerRecord) => ({ sealedEnv: r.sealedEnv, sealedOAuth: r.sealedOAuth });

describe("insert", () => {
  test("stores version 1 and refuses a second create of the same key without overwriting", async () => {
    const { repo, stored } = await seeded();
    expect(stored.version).toBe(1);
    expect(await repo.insert({ record: { ...row({ label: "Second" }), version: 7 } })).toBe(false);
    expect((await repo.findByServerId({ workspaceId: "ws", serverId: "linear" }))?.label).toBe("Linear");
  });
});

describe("updateIfVersion", () => {
  test("guarded OAuth edits reject a different creation time with matching version and pointers", async () => {
    const { repo, stored } = await seeded();
    expect(await repo.updateIfVersion({ record: { ...stored, oauthClientId: null }, expectedVersion: stored.version,
      expectedCreatedAt: LATER, replaces: replaces(stored) })).toBe(false);
    expect(await repo.findByServerId(stored)).toEqual(stored);
  });

  test("T-stale: a save from an old screen is refused after another save landed, and the first save stays", async () => {
    const { repo, stored } = await seeded();
    expect(await repo.updateIfVersion({ record: { ...stored, label: "Writer 1" }, expectedVersion: 1, replaces: replaces(stored) })).toBe(true);
    const afterFirst = (await repo.findByServerId({ workspaceId: "ws", serverId: "linear" }))!;
    expect(afterFirst.version).toBe(2);
    expect(await repo.updateIfVersion({ record: { ...stored, label: "Writer 2" }, expectedVersion: 1, replaces: replaces(stored) })).toBe(false);
    expect((await repo.findByServerId({ workspaceId: "ws", serverId: "linear" }))?.label).toBe("Writer 1");
  });

  test("T-cas: two saves with the same basis started together, exactly one applies", async () => {
    const { repo, stored } = await seeded();
    const results = await Promise.all(["A", "B"].map((label) => repo.updateIfVersion({ record: { ...stored, label }, expectedVersion: 1, replaces: replaces(stored) })));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await repo.findByServerId({ workspaceId: "ws", serverId: "linear" }))?.version).toBe(2);
  });

  test("a credential replaced since the read refuses the edit even though the version is unchanged", async () => {
    const { repo, stored } = await seeded();
    const refreshed = envelope(stored, "mcp-auth", "auth-2", "c2");
    expect(await repo.updateOAuthRuntime({ key: stored, expectedSealedOAuth: stored.sealedOAuth, patch: { oauthStatus: "connected", oauthExpiresAt: LATER, oauthRefreshLeaseUntil: null, sealedOAuth: refreshed, oauthAadVersion: 1, updatedAt: LATER } })).toBe(true);
    expect(await repo.updateIfVersion({ record: { ...stored, label: "Edit" }, expectedVersion: 1, replaces: replaces(stored) })).toBe(false);
  });

  test("a missing row is refused", async () => {
    const repo = new InMemoryExternalMcpServerRepo(ports);
    expect(await repo.updateIfVersion({ record: row(), expectedVersion: 1, replaces: { sealedEnv: null, sealedOAuth: null } })).toBe(false);
  });
});

describe("updateOAuthRuntime", () => {
  test.each([{ version: 2 }, { createdAt: LATER }])("guarded OAuth writes reject a moved configuration: %j", async moved => {
    const { repo, stored } = await seeded();
    await repo.upsert({ ...stored, ...moved });
    const replacement = (await repo.findByServerId(stored))!;
    expect(replacement.sealedOAuth).toEqual(stored.sealedOAuth);
    const late = envelope(stored, "mcp-auth", "auth-late", "late");
    expect(await repo.updateOAuthRuntime({ key: stored, expectedSealedOAuth: stored.sealedOAuth,
      expectedConfig: { createdAt: stored.createdAt, version: stored.version },
      patch: { oauthStatus: "connected", oauthExpiresAt: LATER, oauthRefreshLeaseUntil: null,
        sealedOAuth: late, oauthAadVersion: 1, updatedAt: LATER } })).toBe(false);
    expect(await repo.findByServerId(stored)).toEqual(replacement);
  });

  test("refresh-vs-disable: a refresh that read the row before an admin disabled it leaves the row disabled and its version alone", async () => {
    const { repo, stored: readByRefresh } = await seeded();
    const accessUpdate = { workspaceId: "ws", serverId: "linear", expected: externalMcpAccessSnapshot({ record: readByRefresh }),
      access: { enabled: false, allowedToolNames: "[]", writeAllowedToolNames: "[]" }, principalId: "admin", nowIso: LATER };
    expect(await repo.updateAccessIfCurrent(accessUpdate)).toBe(true);
    const tokens = envelope(readByRefresh, "mcp-auth", "auth-2", "c2");
    const applied = await repo.updateOAuthRuntime({ key: readByRefresh, expectedSealedOAuth: readByRefresh.sealedOAuth,
      patch: { oauthStatus: "connected", oauthExpiresAt: LATER, oauthRefreshLeaseUntil: null, sealedOAuth: tokens, oauthAadVersion: 1, updatedAt: LATER } });
    expect(applied).toBe(true);
    const now = (await repo.findByServerId({ workspaceId: "ws", serverId: "linear" }))!;
    expect(now.enabled).toBe(false);
    expect(now.allowedToolNames).toBe("[]");
    expect(now.version).toBe(2);
    expect(now.sealedOAuth?.ciphertext).toBe("c2");
  });

  test("refresh-after-credential-replaced: tokens for a credential that is gone are dropped, not written onto its replacement", async () => {
    const { repo, stored } = await seeded();
    const replacement = envelope(stored, "mcp-auth", "auth-9", "c9");
    expect(await repo.updateIfVersion({ record: { ...stored, sealedOAuth: replacement }, expectedVersion: 1, replaces: replaces(stored) })).toBe(true);
    const late = envelope(stored, "mcp-auth", "auth-2", "late");
    expect(await repo.updateOAuthRuntime({ key: stored, expectedSealedOAuth: stored.sealedOAuth, patch: { oauthStatus: "connected", oauthExpiresAt: LATER, oauthRefreshLeaseUntil: null, sealedOAuth: late, oauthAadVersion: 1, updatedAt: LATER } })).toBe(false);
    expect((await repo.findByServerId({ workspaceId: "ws", serverId: "linear" }))?.sealedOAuth?.ciphertext).toBe("c9");
  });
});

describe("updateAccessIfCurrent", () => {
  test("access-revoked-then-stale-save: the approval advances the version, so a form saved from before it is refused and the grants stay revoked", async () => {
    const { repo, stored } = await seeded();
    const accessUpdate = { workspaceId: "ws", serverId: "linear", expected: externalMcpAccessSnapshot({ record: stored }),
      access: { enabled: false, allowedToolNames: "[]", writeAllowedToolNames: "[]" }, principalId: "admin", nowIso: LATER };
    expect(await repo.updateAccessIfCurrent(accessUpdate)).toBe(true);
    expect(await repo.updateIfVersion({ record: { ...stored, label: "Stale form" }, expectedVersion: stored.version, replaces: replaces(stored) })).toBe(false);
    const now = (await repo.findByServerId({ workspaceId: "ws", serverId: "linear" }))!;
    expect(now.enabled).toBe(false);
    expect(now.version).toBe(2);
  });
});
