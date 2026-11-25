import { expect, it, vi } from "vitest";
import { VaultError, type VaultRecord, type VaultContext } from "@jini-ai/core/contracts/vault";
import { InMemoryVaultRepo } from "@jini-ai/platform/secrets/credential-sets";
import { SealedDatabaseDestinationStore } from "../destination-store.js";

it("a non-default migrated singleton is readable", async () => {
  const repo = new InMemoryVaultRepo({});
  const scope = { kind: "database-destination", ownerKey: "host", principalId: null, provider: null, binding: null } as const;
  const record: VaultRecord = { ...scope, workspaceId: "ws", id: "legacy", label: "Destination", isDefault: false,
    revision: 1, sealed: null, last4: null, tokenLength: null, meta: {}, createdAt: "stamp", updatedAt: "stamp" };
  await repo.put({ record, expectedRevision: null });
  const vault = { findOne: vi.fn(async (input: VaultContext) => {
    const found = await repo.findOne(input);
    return found ? { summary: { ...found, configured: true }, payload: { connectionString: "private" } } : null;
  }), put: vi.fn(), patchMeta: vi.fn() } satisfies ConstructorParameters<typeof SealedDatabaseDestinationStore>[0]["vault"];
  const store = new SealedDatabaseDestinationStore({ repo, vault, scope, parseMeta: () => ({}), normalizeAddress: ({ value }) => value });
  expect((await store.get("ws"))?.connectionString).toBe("private");
  expect(vault.findOne).toHaveBeenCalledWith({ ...scope, workspaceId: "ws" });
});

it("a run finishing after replacement cannot patch the replacement", async () => {
  const repo = new InMemoryVaultRepo({});
  const scope = { kind: "database-destination", ownerKey: "host", principalId: null, provider: null, binding: null } as const;
  const original: VaultRecord = { ...scope, workspaceId: "ws", id: "old", label: "Destination", isDefault: false,
    revision: 1, sealed: null, last4: null, tokenLength: null, meta: {}, createdAt: "stamp", updatedAt: "stamp" };
  await repo.put({ record: original, expectedRevision: null });
  const patchMeta = vi.fn(async () => {
    await repo.delete({ workspaceId: "ws", id: "old", expectedRevision: 1 });
    await repo.put({ record: { ...original, id: "replacement" }, expectedRevision: null });
    throw new VaultError({ code: "conflict" });
  });
  const store = new SealedDatabaseDestinationStore({ repo, scope, vault: { findOne: vi.fn(), put: vi.fn(), patchMeta },
    parseMeta: () => ({}), normalizeAddress: ({ value }) => value });
  await store.recordRun("ws", { copied: true, snapshotAt: "stamp", tableCount: 1, rowCount: 1 });
  expect(patchMeta).toHaveBeenCalledTimes(1);
  expect((await repo.findOne({ ...scope, workspaceId: "ws" }))?.id).toBe("replacement");
});
