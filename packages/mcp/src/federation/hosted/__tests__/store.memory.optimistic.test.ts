/**
 * Lost-update contract of the in-memory `ExternalMcpServerRepoPort` (design S1, rules M1/M7): the
 * edit write compares `version` and both credential pointers in the write; the runtime write
 * touches only OAuth runtime columns and never advances `version`; an access approval advances it.
 */
import { describe, expect, test, vi } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import type { FederatedCallTarget } from "../../ports.js";
import { createHostedMcpConnectionGate, type HostedMcpConnectionGatePorts } from "../connection-gate.js";
import { rosterRefusalFor } from "../revocation.js";
import { commitExternalMcpSave } from "../store.save.js";
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
    const edit = { ...stored, oauthClientId: null, label: "Reviewed" };
    expect(await repo.updateIfVersion({ record: edit, expectedVersion: stored.version,
      expectedCreatedAt: LATER, replaces: replaces(stored) })).toBe(false);
    expect(await repo.findByServerId(stored)).toEqual(stored);
    expect(await repo.updateIfVersion({ record: edit, expectedVersion: stored.version,
      expectedCreatedAt: stored.createdAt, replaces: replaces(stored) })).toBe(true);
    expect((await repo.findByServerId(stored))?.label).toBe("Reviewed");
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
    const patch = { oauthStatus: "connected" as const, oauthExpiresAt: LATER, oauthRefreshLeaseUntil: null,
      sealedOAuth: late, oauthAadVersion: 1, updatedAt: LATER };
    expect(await repo.updateOAuthRuntime({ key: stored, expectedSealedOAuth: stored.sealedOAuth,
      expectedConfig: { createdAt: stored.createdAt, version: stored.version }, patch })).toBe(false);
    expect(await repo.findByServerId(stored)).toEqual(replacement);
    expect(await repo.updateOAuthRuntime({ key: replacement, expectedSealedOAuth: replacement.sealedOAuth,
      expectedConfig: { createdAt: replacement.createdAt, version: replacement.version }, patch })).toBe(true);
    expect((await repo.findByServerId(replacement))?.sealedOAuth).toEqual({
      keyId: "k", ciphertext: "late", nonce: "bg==", alg: "toy",
    });
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

test("deleting a server removes its row and leaves the same id in another workspace untouched", async () => {
  const { repo, stored } = await seeded();
  const other = row({ workspaceId: "other", label: "Other site" });
  await repo.upsert(other);
  expect(await repo.deleteByServerId({ workspaceId: "absent", serverId: "linear" })).toBe(false);
  expect(await repo.findByServerId(stored)).toStrictEqual(stored);
  expect(await repo.deleteByServerId(stored)).toBe(true);
  expect(await repo.findByServerId(stored)).toBeNull();
  expect(await repo.findByServerId(other)).toStrictEqual(other);
  expect(await repo.deleteByServerId(stored)).toBe(false);
});

test("an OAuth refresh lease blocks a second claimant until expiration or explicit release", async () => {
  const { repo, stored } = await seeded();
  const key = { workspaceId: stored.workspaceId, serverId: stored.serverId };
  const next = "2026-11-17T02:00:00.000Z";
  const missing = { ...key, serverId: "unknown" };
  expect(await repo.tryClaimOAuthRefreshLease({ ...missing, nowIso: NOW, leaseUntil: LATER })).toBe(false);
  await repo.releaseOAuthRefreshLease(missing);
  expect(await repo.findByServerId(missing)).toBeNull();
  expect(await repo.tryClaimOAuthRefreshLease({ ...key, nowIso: NOW, leaseUntil: LATER })).toBe(true);
  expect(await repo.tryClaimOAuthRefreshLease({ ...key, nowIso: NOW, leaseUntil: next })).toBe(false);
  expect((await repo.findByServerId(key))?.oauthRefreshLeaseUntil).toBe(LATER);
  expect(await repo.tryClaimOAuthRefreshLease({ ...key, nowIso: LATER, leaseUntil: next })).toBe(true);
  expect((await repo.findByServerId(key))?.oauthRefreshLeaseUntil).toBe(next);
  await repo.releaseOAuthRefreshLease(key);
  expect(await repo.findByServerId(key)).toStrictEqual(stored);
  expect(await repo.tryClaimOAuthRefreshLease({ ...key, nowIso: LATER, leaseUntil: next })).toBe(true);
});

function admitted(record: ExternalMcpServerRecord): FederatedCallTarget {
  return { remoteName: "edit", declaredAnnotations: { readOnlyHint: false },
    origin: { kind: "roster", admissionRevision: externalMcpAccessSnapshot({ record }).admissionRevision } };
}
function hostedGate(repo: HostedMcpConnectionGatePorts["repo"], overrides: Partial<HostedMcpConnectionGatePorts> = {}) {
  const reauthRequired = vi.fn<HostedMcpConnectionGatePorts["reauthRequired"]>().mockReturnValue(new Error("Reconnect the saved server"));
  const revoked = vi.fn<HostedMcpConnectionGatePorts["revoked"]>(({ reason }) => new Error(`MCP refused: ${reason}`));
  const logUnreadableRow = vi.fn<HostedMcpConnectionGatePorts["logUnreadableRow"]>();
  const recovery = {
    accessHint: vi.fn<HostedMcpConnectionGatePorts["recovery"]["accessHint"]>().mockReturnValue("Review plugin access"),
    pluginOff: vi.fn<HostedMcpConnectionGatePorts["recovery"]["pluginOff"]>().mockReturnValue("Enable the provisioning plugin"),
  };
  const gate = createHostedMcpConnectionGate({ repo, workspaceId: "ws", reauthRequired, revoked, logUnreadableRow, recovery,
    isPluginEnabled: async () => true, ...overrides });
  return { gate, reauthRequired, revoked, logUnreadableRow, recovery };
}

test("the hosted gate rereads current grants and distinguishes tool removal, write removal, and disconnection", async () => {
  const { repo, stored } = await seeded();
  const granted = { ...stored, allowedToolNames: '["read","edit"]', writeAllowedToolNames: '["edit"]' };
  const call = admitted(granted);
  const { gate, revoked } = hostedGate(repo);
  await repo.upsert(granted);
  await expect(gate("linear", call)).resolves.toBe("current-grants-checked");

  await repo.upsert({ ...granted, writeAllowedToolNames: "[]" });
  await expect(gate("linear", call)).rejects.toThrow("MCP refused: write-not-allowed");
  await repo.upsert({ ...granted, allowedToolNames: '["read"]', writeAllowedToolNames: "[]" });
  await expect(gate("linear", call)).rejects.toThrow("MCP refused: tool-not-allowed");
  await repo.upsert({ ...granted, oauthStatus: "disconnected" });
  await expect(gate("linear", call)).rejects.toThrow("MCP refused: disconnected");
  expect(revoked.mock.calls).toEqual(["write-not-allowed", "tool-not-allowed", "disconnected"].map(reason =>
    [{ serverId: "linear", label: "Linear", remoteName: "edit", reason }]));
});

test("the hosted gate treats a missing preset differently from a missing roster row", async () => {
  const { repo, stored } = await seeded();
  const { gate, revoked } = hostedGate(repo);
  const call = admitted(stored);
  await expect(gate("missing", { ...call, origin: { kind: "preset" } })).resolves.toBeUndefined();
  await expect(gate("missing", call)).rejects.toThrow("MCP refused: removed");
  expect(revoked.mock.calls).toEqual([[{ serverId: "missing", label: null, remoteName: "edit", reason: "removed" }]]);
  expect(rosterRefusalFor({ record: stored, call: { ...call, origin: undefined } })).toBe("unverifiable");
  expect(rosterRefusalFor({ record: stored, call: { ...call, origin: { kind: "preset" } } })).toBe("unverifiable");
});

test("an unreadable row reports the driver error only to operator diagnostics", async () => {
  const error = new Error("private driver path");
  const findByServerId = vi.fn<HostedMcpConnectionGatePorts["repo"]["findByServerId"]>().mockRejectedValue(error);
  const { gate, logUnreadableRow, revoked } = hostedGate({ findByServerId });
  await expect(gate("linear", admitted(row()))).rejects.toThrow(new Error("MCP refused: unverifiable"));
  expect(findByServerId.mock.calls).toEqual([[{ workspaceId: "ws", serverId: "linear" }]]);
  expect(logUnreadableRow.mock.calls).toEqual([[{ connectionId: "linear", error }]]);
  expect(revoked.mock.calls).toEqual([[{ serverId: "linear", label: null, remoteName: "", reason: "unverifiable" }]]);
});

test("shared authorization bypasses legacy reauth, but not a changed roster identity", async () => {
  const { repo, stored } = await seeded();
  const granted = { ...stored, oauthStatus: "needs_reauth", allowedToolNames: '["edit"]', writeAllowedToolNames: '["edit"]' };
  await repo.upsert(granted);
  const assertSharedAuthorized = vi.fn<NonNullable<HostedMcpConnectionGatePorts["assertSharedAuthorized"]>>()
    .mockResolvedValueOnce(false).mockResolvedValue(true);
  const { gate, reauthRequired } = hostedGate(repo, { assertSharedAuthorized });
  const call = admitted(granted);
  await expect(gate("linear", call)).rejects.toThrow("Reconnect the saved server");
  expect(reauthRequired.mock.calls).toEqual([[{ serverId: "linear", label: "Linear" }]]);
  await expect(gate("linear", call)).resolves.toBe("current-grants-checked");
  await repo.upsert({ ...granted, url: "https://other.example/mcp" });
  await expect(gate("linear", call)).rejects.toThrow("MCP refused: changed");
  expect(assertSharedAuthorized.mock.calls).toEqual([[{ serverId: "linear" }], [{ serverId: "linear" }]]);
});

test.each(["off", "unreadable", "on"] as const)("plugin status %s cannot skip access review", async status => {
  const { repo, stored } = await seeded();
  const pluginRow = { ...stored, provisionedByPluginId: "docs-plugin", allowedToolNames: '["edit"]', writeAllowedToolNames: "[]" };
  await repo.upsert(pluginRow);
  const isPluginEnabled = vi.fn<HostedMcpConnectionGatePorts["isPluginEnabled"]>(async () => {
    if (status === "unreadable") throw new Error("activation store unavailable");
    return status === "on";
  });
  const { gate, recovery, revoked } = hostedGate(repo, { isPluginEnabled });
  await expect(gate("linear", admitted(pluginRow))).rejects.toThrow(new ToolInputError({
    message: status === "on" ? "Review plugin access" : "Enable the provisioning plugin",
  }));
  expect(isPluginEnabled.mock.calls).toEqual([["docs-plugin"]]);
  expect(recovery.pluginOff.mock.calls).toEqual(status === "on" ? [] : [[{ pluginId: "docs-plugin" }]]);
  expect(recovery.accessHint.mock.calls).toEqual(status === "on" ?
    [[{ pluginId: "docs-plugin", serverId: "linear", refusal: "write-not-allowed" }]] : []);
  expect(revoked.mock.calls).toEqual([]);
});

test("the roster gate refuses a switched-off row even when its identity and grants still match", async () => {
  const { repo, stored } = await seeded();
  const granted = { ...stored, enabled: true, allowedToolNames: '["edit"]', writeAllowedToolNames: '["edit"]' };
  await repo.upsert(granted);
  const { gate, revoked } = hostedGate(repo);
  const call = admitted(granted);
  await expect(gate("linear", call)).resolves.toBe("current-grants-checked");
  await repo.upsert({ ...granted, enabled: false });
  await expect(gate("linear", call)).rejects.toThrow("MCP refused: turned-off");
  expect(revoked).toHaveBeenCalledExactlyOnceWith({ serverId: "linear", label: "Linear", remoteName: "edit", reason: "turned-off" });
});

test("an editor refuses two write misses at the same basis instead of retrying a third time", async () => {
  const { repo, stored } = await seeded();
  const key = { workspaceId: stored.workspaceId, serverId: stored.serverId };
  const updateIfVersion = vi.fn<typeof repo.updateIfVersion>().mockResolvedValue(false);
  const build = vi.fn(async (existing: ExternalMcpServerRecord | null) => {
    if (!existing) throw new Error("missing edit basis");
    return { ...existing, label: "Changed" };
  });
  await expect(commitExternalMcpSave({
    repo: { findByServerId: repo.findByServerId.bind(repo), insert: repo.insert.bind(repo), updateIfVersion },
    key, expectedVersion: stored.version, build,
  })).rejects.toMatchObject({ name: "RecordVersionConflictError", expectedVersion: 1, currentVersion: 1 });
  expect(build.mock.calls).toEqual([[stored], [stored]]);
  expect(updateIfVersion.mock.calls).toEqual(Array.from({ length: 2 }, () => [{
    expectedVersion: 1, replaces: replaces(stored), record: { ...stored, label: "Changed" },
  }]));
  expect(await repo.findByServerId(key)).toEqual(stored);
});
