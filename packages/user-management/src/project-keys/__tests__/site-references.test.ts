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

const site: VaultIdentity = { workspaceId: "site", kind: "api-connection", ownerKey: "host", principalId: null, binding: null, id: "ref-row" };
const stores = (stored: unknown, revision: number | null = 3) => ({
  vault: { get: vi.fn().mockResolvedValue(stored === undefined ? null : { payload: { value: stored } }), put: vi.fn(), delete: vi.fn() },
  repo: { find: vi.fn().mockResolvedValue(revision === null ? null : { revision }) },
});

test("OAuth binding round-trips only a well-formed credential id", async () => {
  const identity = vi.fn(() => site);
  const make = (stored: unknown) => { const s = stores(stored); return { ...s, port: createSiteOAuthBindings({ ...s, identity, credentialFormat: "oauth-binding", invalidIdMessage: "bad id" }) }; };
  const ok = make({ credentialId: "cred-1" });
  expect(await ok.port.read({ consumerId: "mcp-1" })).toEqual({ credentialId: "cred-1" });
  expect(identity).toHaveBeenCalledWith({ consumerId: "mcp-1" });
  expect(ok.vault.get).toHaveBeenCalledWith(site);
  expect(await make(undefined).port.read({ consumerId: "mcp-1" })).toBeNull();
  expect(await make(null).port.read({ consumerId: "mcp-1" })).toBeNull();
  expect(await make("cred-1").port.read({ consumerId: "mcp-1" })).toBeNull();
  expect(await make({ other: 1 }).port.read({ consumerId: "mcp-1" })).toBeNull();
  expect(await make({ credentialId: 7 }).port.read({ consumerId: "mcp-1" })).toBeNull();
  await expect(make({ credentialId: "" }).port.read({ consumerId: "mcp-1" })).rejects.toThrow("bad id");
});

test("OAuth binding ids are validated before any store I/O", async () => {
  const s = stores(null);
  const port = createSiteOAuthBindings({ ...s, identity: () => site, credentialFormat: "oauth-binding", invalidIdMessage: "bad id" });
  await expect(port.read({ consumerId: "" })).rejects.toThrow("bad id");
  await expect(port.read({ consumerId: "x".repeat(513) })).rejects.toThrow("bad id");
  await expect(port.read({ consumerId: "a\0b" })).rejects.toThrow("bad id");
  await expect(port.set({ consumerId: "mcp-1", credentialId: "" })).rejects.toThrow("bad id");
  await expect(port.remove({ consumerId: "" })).rejects.toThrow("bad id");
  expect(s.vault.get).not.toHaveBeenCalled();
  expect(s.repo.find).not.toHaveBeenCalled();
  await expect(port.read({ consumerId: "x".repeat(512) })).resolves.toBeNull();
});

test("OAuth binding set writes a token-free row with the current revision or as new", async () => {
  for (const [revision, expected] of [[4, 4], [null, null]] as const) {
    const s = stores(null, revision);
    await createSiteOAuthBindings({ ...s, identity: () => site, credentialFormat: "oauth-binding", invalidIdMessage: "bad id" }).set({ consumerId: "mcp-1", credentialId: "cred-1" });
    expect(s.repo.find).toHaveBeenCalledWith(site);
    expect(s.vault.put).toHaveBeenCalledWith({ ...site, expectedRevision: expected, provider: null, label: "ref-row",
      meta: { credentialFormat: "oauth-binding" }, payload: { value: { credentialId: "cred-1" } } });
  }
});

test("removing a binding or reference that does not exist deletes nothing", async () => {
  const s = stores(null, null);
  await createSiteOAuthBindings({ ...s, identity: () => site, credentialFormat: "f", invalidIdMessage: "bad id" }).remove({ consumerId: "mcp-1" });
  await createSiteKeyReferences({ ...s, identity: () => site, credentialFormat: "f", invalidIdMessage: "bad id" }).remove({ credentialId: "cred-1" });
  expect(s.repo.find).toHaveBeenCalledTimes(2);
  expect(s.vault.delete).not.toHaveBeenCalled();
});

test("key reference set/has keep the exact credential id and reject bad ids", async () => {
  const identity = vi.fn(() => site);
  const s = stores({ credentialId: "cred-1" }, null);
  const refs = createSiteKeyReferences({ ...s, identity, credentialFormat: "key-ref", invalidIdMessage: "bad id" });
  await refs.set({ credentialId: "cred-1" });
  expect(identity).toHaveBeenCalledWith({ credentialId: "cred-1" });
  expect(s.vault.put).toHaveBeenCalledWith({ ...site, expectedRevision: null, provider: null, label: "ref-row",
    meta: { credentialFormat: "key-ref" }, payload: { value: { credentialId: "cred-1" } } });
  expect(await refs.has({ credentialId: "cred-1" })).toBe(true);
  expect(await refs.has({ credentialId: "cred-2" })).toBe(false);
  for (const stored of [undefined, null, "cred-1", { credentialId: 1 }]) {
    const t = stores(stored);
    expect(await createSiteKeyReferences({ ...t, identity, credentialFormat: "key-ref", invalidIdMessage: "bad id" }).has({ credentialId: "cred-1" })).toBe(false);
  }
  await expect(refs.set({ credentialId: "" })).rejects.toThrow("bad id");
  await expect(refs.has({ credentialId: "x".repeat(513) })).rejects.toThrow("bad id");
});

test("key reference set overwrites an existing row at its current revision", async () => {
  const s = stores(null, 9);
  await createSiteKeyReferences({ ...s, identity: () => site, credentialFormat: "key-ref", invalidIdMessage: "bad id" }).set({ credentialId: "cred-1" });
  expect(s.vault.put).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 9, payload: { value: { credentialId: "cred-1" } } }));
});
