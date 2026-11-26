import { expect, it } from "vitest";
import type { VaultRepoPort } from "@jini-ai/core/contracts/vault";
import { InMemoryMediaProviderCredentialRepo } from "../provider-credential-store.memory.js";
import { TurnLock } from "@jini-ai/db/kernel";

it("primitive upsert cannot enter between replacement snapshot and publication", async () => {
  const events: string[] = [];
  let publish!: () => void;
  const held = new Promise<void>(resolve => { publish = resolve; });
  let snapshot!: () => void;
  const read = new Promise<void>(resolve => { snapshot = resolve; });
  const vault: VaultRepoPort = { list: async () => { events.push("snapshot"); snapshot(); return []; },
    applyBatch: async () => { await held; events.push("publish"); return []; },
    put: async ({ record }) => { events.push("upsert"); return { ...record, isDefault: false }; },
    find: async () => null, patchMeta: async () => { throw new Error("unused"); }, delete: async () => false };
  const repo = new InMemoryMediaProviderCredentialRepo({ vault, policy: { ownerKey: "test", legacyIds: {}, parseMeta: () => ({ baseUrl: null, model: null }) }, providerWrites: new TurnLock(), idGen: { newId: () => "fresh" } });
  const replacement = repo.replaceWorkspace({ workspaceId: "w", plan: () => ({ upserts: [], tombstoneProviderIds: [] }) });
  await read;
  const primitive = repo.upsert({ workspaceId: "w", providerId: "p", baseUrl: null, model: null, sealed: null, keyTail: null, aadVersion: 0, createdAt: "now", updatedAt: "now" });
  await Promise.resolve();
  expect(events).toEqual(["snapshot"]);
  publish();
  await Promise.all([replacement, primitive]);
  expect(events).toEqual(["snapshot", "publish", "snapshot", "upsert"]);
});
