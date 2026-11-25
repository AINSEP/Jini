import { describe, it, expect } from "vitest";
import type { VaultMeta, VaultRecord, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import {
  createPublishContentPeer, listPublishContentPeers, maskApiKey, resolvePeerCredential, VaultPublishContentPeerRepo,
  type PeerVaultServiceOptions, type PublishContentPeerVaultBinding,
} from "../peer-registry.js";
import { PublishContentPeerSecretStoreUnconfiguredError, PublishContentPeerValidationError } from "../peers.js";

/** Minimal vault adapter: rows keyed by workspace/id, listed by the query's scope. */
function memoryVault(): VaultRepoPort {
  const rows = new Map<string, VaultRecord>();
  const key = (r: { workspaceId: string; id: string }) => `${r.workspaceId}/${r.id}`;
  return {
    async find(input: { workspaceId: string; id: string }) { return rows.get(key(input)) ?? null; },
    async list(q: { workspaceId: string; kind: string; ownerKey: string }) {
      return [...rows.values()].filter(r => r.workspaceId === q.workspaceId && r.kind === q.kind && r.ownerKey === q.ownerKey);
    },
    async put({ record }: { record: VaultRecord }) { rows.set(key(record), record); },
    async delete(input: { workspaceId: string; id: string }) { rows.delete(key(input)); },
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
          await options.repo.put({ record: { ...input, isDefault: false, revision: 1, createdAt: options.now(), updatedAt: options.now(),
            sealed: { keyId: "k", ciphertext: JSON.stringify(input.payload), nonce: "n", alg: "test" }, last4: input.hintToken.slice(-4), tokenLength: input.hintToken.length } as VaultRecord, expectedRevision: null });
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
