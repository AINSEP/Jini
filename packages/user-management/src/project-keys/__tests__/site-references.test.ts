import { expect, test, vi } from "vitest";
import type { VaultIdentity } from "@jini-ai/core/contracts/vault";
import { createSiteKeyReferences, createSiteOAuthBindings } from "../site-references.js";

test("existing reference etag is used for removal", async () => {
  const identity: VaultIdentity = { workspaceId: "site", kind: "api-connection", ownerKey: "host", principalId: null, binding: null, id: "reference" };
  const remove = vi.fn().mockResolvedValue(undefined);
  const repo = { find: vi.fn().mockResolvedValue({ revision: 7 }) };
  const vault = { get: vi.fn(), put: vi.fn(), delete: remove };
  await createSiteKeyReferences({ vault, repo, identity: () => identity, credentialFormat: "reference", invalidIdMessage: "invalid" }).remove({ credentialId: "key" });
  await createSiteOAuthBindings({ vault, repo, identity: () => identity, credentialFormat: "reference", invalidIdMessage: "invalid" }).remove({ consumerId: "consumer" });
  expect(remove.mock.calls).toEqual([[{ ...identity, expectedRevision: 7 }], [{ ...identity, expectedRevision: 7 }]]);
});
