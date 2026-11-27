import { describe, it, expect, vi } from "vitest";
import { VaultError, type VaultMeta, type VaultRecord, type VaultRepoPort } from "@jini-ai/core/contracts/vault";
import {
  createPublishContentPeer, listPublishContentPeers, maskApiKey, resolvePeerCredential, VaultPublishContentPeerRepo,
  updatePublishContentPeer, getPublishContentPeerSummary, deletePublishContentPeer,
  type PeerVaultServiceOptions, type PublishContentPeerVaultBinding,
} from "../peer-registry.js";
import { PublishContentPeerSecretStoreUnconfiguredError, PublishContentPeerValidationError, PublishContentPeerDuplicateLabelError,
  PublishContentPeerCredentialMissingError, PublishContentPeerNotFoundError } from "../peers.js";

/** Minimal vault adapter: rows keyed by workspace/id, listed by the query's scope. */
function memoryVault(): VaultRepoPort {
  const rows = new Map<string, VaultRecord>();
  const key = (r: { workspaceId: string; id: string }) => `${r.workspaceId}/${r.id}`;
  return {
    async find(input: { workspaceId: string; id: string }) { return rows.get(key(input)) ?? null; },
    async list(q: { workspaceId: string; kind: string; ownerKey: string }) {
      return [...rows.values()].filter(r => r.workspaceId === q.workspaceId && r.kind === q.kind && r.ownerKey === q.ownerKey);
    },
    async put({ record, expectedRevision }: { record: VaultRecord; expectedRevision: number | null }) {
      const previous = rows.get(key(record));
      if ((previous?.revision ?? null) !== expectedRevision
        || [...rows.entries()].some(([id, stored]) => id !== key(record) && stored.workspaceId === record.workspaceId &&
          stored.kind === record.kind && stored.ownerKey === record.ownerKey && stored.label === record.label)) {
        throw new VaultError({ code: "conflict" });
      }
      rows.set(key(record), record);
    },
    async delete(input: { workspaceId: string; id: string; expectedRevision: number }) {
      if (rows.get(key(input))?.revision !== input.expectedRevision) throw new VaultError({ code: "conflict" });
      rows.delete(key(input));
    },
  } as unknown as VaultRepoPort;
}

/** Host binding fixture: a reversible "sealer" stands in for the host's lifecycle service. */
function binding(calls: { scopes: unknown[]; options?: PeerVaultServiceOptions }, failOpen = false): PublishContentPeerVaultBinding {
  return {
    kind: "publish-peer", ownerKey: "acme-host",
    parseMeta: ({ meta }) => meta as VaultMeta,
    tokenHint: ({ token }) => ({ last4: token.length >= 12 ? token.slice(-4) : null }),
    compareByLabel: (a, b) => a.label.localeCompare(b.label),
    createService: options => {
      calls.options = options;
      return {
        async put(input) {
          calls.scopes.push({ kind: input.kind, ownerKey: input.ownerKey, payload: input.payload });
          await options.authorize({ context: input });
          await options.repo.put({ record: { ...input, isDefault: false, revision: (input.expectedRevision ?? 0) + 1, createdAt: options.now(), updatedAt: options.now(),
            sealed: { keyId: "k", ciphertext: JSON.stringify(input.payload), nonce: "n", alg: "test" }, last4: input.hintToken.slice(-4), tokenLength: input.hintToken.length } as VaultRecord, expectedRevision: input.expectedRevision });
        },
        async get(input) {
          calls.scopes.push({ kind: input.kind, ownerKey: input.ownerKey });
          if (failOpen) throw new Error("auth tag mismatch: secret-ish driver text");
          const row = await options.repo.find(input);
          return row?.sealed ? { payload: JSON.parse(row.sealed.ciphertext) } : null;
        },
      };
    },
  };
}

function setup(failOpen = false) {
  const calls: { scopes: unknown[]; options?: PeerVaultServiceOptions } = { scopes: [] };
  const repo = new VaultPublishContentPeerRepo({ vault: memoryVault(), binding: binding(calls, failOpen) });
  let n = 0;
  const deps = { repo, sealer: {} as never, keyring: {} as never, clock: { nowMs: () => 0 }, idGen: { newId: () => `peer-${++n}` } };
  return { calls, repo, deps };
}
const INPUT = { workspaceId: "ws-a", label: "Live", baseUrl: "https://live.example", remoteWorkspaceId: "ws-remote", apiKey: "example-api-key-0123456789" };

describe("peer registry (host vault binding injected)", () => {
  it("seals under the host's kind and owner key, and masks with the host hint policy", async () => {
    const { calls, deps } = setup();
    const summary = await createPublishContentPeer({ deps, input: INPUT });
    expect(summary).toEqual({ id: "peer-1", label: "Live", baseUrl: "https://live.example", remoteWorkspaceId: "ws-remote", masked: "••••6789", hasCredential: true });
    expect(calls.scopes).toEqual([{ kind: "publish-peer", ownerKey: "acme-host", payload: { apiKey: INPUT.apiKey } }]);
  });

  it("resolves the key through the host service under the same scope", async () => {
    const { calls, deps } = setup();
    await createPublishContentPeer({ deps, input: INPUT });
    const resolved = await resolvePeerCredential({ deps, input: { workspaceId: "ws-a", id: "peer-1" } });
    expect(resolved.apiKey).toBe(INPUT.apiKey);
    expect(calls.scopes.at(-1)).toEqual({ kind: "publish-peer", ownerKey: "acme-host" });
  });

  it("never lets a raw open error cross out", async () => {
    const { deps } = setup(true);
    await createPublishContentPeer({ deps, input: INPUT });
    await expect(resolvePeerCredential({ deps, input: { workspaceId: "ws-a", id: "peer-1" } })).rejects.toThrow(PublishContentPeerSecretStoreUnconfiguredError);
  });

  it("the adapter's authorize refuses a context under another owner key", async () => {
    const { calls, deps } = setup();
    await createPublishContentPeer({ deps, input: INPUT });
    await expect(calls.options!.authorize({ context: { kind: "publish-peer", ownerKey: "other", principalId: null } })).rejects.toMatchObject({ code: "context" });
  });

  it("refuses to project a row stored under another owner key", async () => {
    const vault = memoryVault();
    const repo = new VaultPublishContentPeerRepo({ vault, binding: binding({ scopes: [] }) });
    await vault.put({ record: { workspaceId: "ws-a", id: "x", kind: "publish-peer", ownerKey: "other", principalId: null, binding: null, provider: null,
      label: "L", meta: { baseUrl: "https://x.example", remoteWorkspaceId: "r" }, sealed: null, isDefault: false, revision: 1, last4: null, tokenLength: null,
      createdAt: "t", updatedAt: "t" } as VaultRecord, expectedRevision: null });
    await expect(repo.findById({ workspaceId: "ws-a", id: "x" })).rejects.toMatchObject({ code: "context" });
  });

  it("lists in the host's label order and validates input before sealing", async () => {
    const { calls, deps } = setup();
    await createPublishContentPeer({ deps, input: { ...INPUT, label: "Zeta" } });
    await createPublishContentPeer({ deps, input: { ...INPUT, label: "Alpha" } });
    expect((await listPublishContentPeers({ deps, input: { workspaceId: "ws-a" } })).map(p => p.label)).toEqual(["Alpha", "Zeta"]);
    await expect(createPublishContentPeer({ deps, input: { ...INPUT, label: " " } })).rejects.toThrow(PublishContentPeerValidationError);
    expect(calls.scopes).toHaveLength(2);
  });

  it("maskApiKey shows only the host hint suffix", () => {
    expect(maskApiKey({ apiKey: "short", binding: binding({ scopes: [] }) })).toBe("••••");
  });
});

it("metadata edits preserve opaque credentials and update the stored revision without reopening the key", async () => {
  const { repo, deps, calls } = setup();
  await createPublishContentPeer({ deps, input: INPUT });
  const target = { workspaceId: "ws-a", id: "peer-1" };
  const prior = await repo.vault.find(target);
  expect(await updatePublishContentPeer({ deps, input: { ...target, label: "  Production  ", baseUrl: "https://new.example/", remoteWorkspaceId: "new-ws" } }))
    .toEqual({ id: "peer-1", label: "Production", baseUrl: "https://new.example", remoteWorkspaceId: "new-ws", masked: "••••6789", hasCredential: true });
  expect(calls.scopes).toHaveLength(1);
  expect(await repo.vault.find(target)).toMatchObject({
    label: "Production", meta: { baseUrl: "https://new.example", remoteWorkspaceId: "new-ws" }, sealed: prior?.sealed,
    revision: 2, last4: "6789", tokenLength: INPUT.apiKey.length,
  });
  expect(await resolvePeerCredential({ deps, input: target })).toEqual({
    id: "peer-1", label: "Production", baseUrl: "https://new.example", remoteWorkspaceId: "new-ws", apiKey: INPUT.apiKey,
  });
});

it("reseals an explicit replacement but preserves other peer fields when omitted", async () => {
  const { deps, calls } = setup();
  await createPublishContentPeer({ deps, input: INPUT });
  const target = { workspaceId: "ws-a", id: "peer-1" };
  const replacement = "fixture-replacement-9876";
  expect(await updatePublishContentPeer({ deps, input: { ...target, apiKey: replacement } })).toEqual({
    id: "peer-1", label: "Live", baseUrl: "https://live.example", remoteWorkspaceId: "ws-remote", masked: "••••9876", hasCredential: true,
  });
  expect(calls.scopes.at(-1)).toEqual({ kind: "publish-peer", ownerKey: "acme-host", payload: { apiKey: replacement } });
  expect(await getPublishContentPeerSummary({ deps, input: target })).toMatchObject({ masked: "••••9876", hasCredential: true });
  expect((await resolvePeerCredential({ deps, input: target })).apiKey).toBe(replacement);
});

it("never overwrites a duplicate label through create, metadata edit or credential replacement", async () => {
  const { deps } = setup();
  await createPublishContentPeer({ deps, input: INPUT });
  const second = await createPublishContentPeer({ deps, input: { ...INPUT, label: "Preview" } });
  const target = { workspaceId: "ws-a", id: second.id };
  const duplicate = new PublishContentPeerDuplicateLabelError({ message: "a peer labelled 'Live' already exists in this workspace" });
  await expect(createPublishContentPeer({ deps, input: INPUT })).rejects.toThrow(duplicate);
  await expect(updatePublishContentPeer({ deps, input: { ...target, label: "Live" } })).rejects.toThrow(duplicate);
  await expect(updatePublishContentPeer({ deps, input: { ...target, label: "Live", apiKey: "fixture-replacement" } })).rejects.toThrow(duplicate);
  expect(await getPublishContentPeerSummary({ deps, input: target })).toEqual(second);
});

it("deletes only the peer in the requested workspace and makes repeated deletion a no-op", async () => {
  const { deps } = setup();
  const peer = await createPublishContentPeer({ deps, input: INPUT });
  await deletePublishContentPeer({ deps, input: { id: peer.id, workspaceId: "other-ws" } });
  const target = { workspaceId: "ws-a", id: peer.id };
  expect(await getPublishContentPeerSummary({ deps, input: target })).toEqual(peer);
  await deletePublishContentPeer({ deps, input: target });
  await deletePublishContentPeer({ deps, input: target });
  expect(await getPublishContentPeerSummary({ deps, input: target })).toBeNull();
  await expect(updatePublishContentPeer({ deps, input: target })).rejects.toThrow(
    new PublishContentPeerNotFoundError({ message: "peer 'peer-1' was not found" }),
  );
});

it("projects a metadata-only destination as uncredentialed and refuses to open a missing key", async () => {
  const { repo, deps, calls } = setup();
  await repo.insert({ record: {
    workspaceId: "ws-a", id: "connected", label: "Connected", baseUrl: "https://other.example",
    remoteWorkspaceId: "other", sealed: null, masked: null, aadVersion: 1, createdAt: "t", updatedAt: "t",
  } });
  const target = { workspaceId: "ws-a", id: "connected" };
  expect(await getPublishContentPeerSummary({ deps, input: target })).toEqual({
    id: "connected", label: "Connected", baseUrl: "https://other.example", remoteWorkspaceId: "other", masked: null, hasCredential: false,
  });
  await expect(resolvePeerCredential({ deps, input: target })).rejects.toThrow(
    new PublishContentPeerCredentialMissingError({ message: "peer 'Connected' has no saved credential; add one before pushing or pulling" }),
  );
  expect(calls.scopes).toEqual([]);
});

it("accepts a 512-character field but refuses a 513-character one before asking the vault to seal", async () => {
  const { deps, calls } = setup();
  const label = "a".repeat(512);
  expect((await createPublishContentPeer({ deps, input: { ...INPUT, label } })).label).toBe(label);
  await expect(createPublishContentPeer({ deps, input: { ...INPUT, label: label + "a" } })).rejects.toThrow(
    new PublishContentPeerValidationError({ message: "'label' must be at most 512 characters" }),
  );
  expect(calls.scopes).toHaveLength(1);
});

it("distinguishes a same-peer revision conflict from another peer holding the label", async () => {
  const { deps, repo } = setup();
  const original = await createPublishContentPeer({ deps, input: INPUT });
  const target = { workspaceId: INPUT.workspaceId, id: original.id };
  const conflict = new VaultError({ code: "conflict" });
  const put = vi.spyOn(repo.vault, "put").mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict);
  try {
    await expect(updatePublishContentPeer({ deps, input: { ...target, baseUrl: "https://new.example" } })).rejects.toBe(conflict);
    await expect(updatePublishContentPeer({ deps, input: { ...target, apiKey: "replacement-key" } })).rejects.toBe(conflict);
    expect(await getPublishContentPeerSummary({ deps, input: target })).toEqual(original);
    expect((await resolvePeerCredential({ deps, input: target })).apiKey).toBe(INPUT.apiKey);
  } finally {
    put.mockRestore();
  }
});

it("returns a credential-store refusal without writing a peer when the vault fails unexpectedly", async () => {
  const { deps, repo } = setup();
  const put = vi.spyOn(repo.vault, "put").mockRejectedValueOnce(new Error("fixture driver unavailable"));
  try {
    await expect(createPublishContentPeer({ deps, input: INPUT })).rejects.toSatisfy((error: unknown) =>
      error instanceof PublishContentPeerSecretStoreUnconfiguredError && error.message === "publish-content peer secret store is unconfigured");
    expect(await listPublishContentPeers({ deps, input: { workspaceId: INPUT.workspaceId } })).toEqual([]);
  } finally {
    put.mockRestore();
  }
});
