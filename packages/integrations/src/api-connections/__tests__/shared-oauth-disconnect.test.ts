import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { KeyAttachments } from "@jini-ai/core/contracts/site/project-key-attachments";
import { disconnectSharedOAuth, inspectSharedOAuthDisconnect, type SharedOAuthDisconnectContext, type SharedOAuthDisconnectStorage } from "../shared-oauth-disconnect.js";
import { KEY, connectedRecord, seedRecord, tokens, unitDeps } from "./fixtures/unit-deps.js";
import { memoryTokenStore } from "./fixtures/harness.js";

async function fixture() {
  const tokenStore = memoryTokenStore();
  tokenStore.entries.set(KEY, tokens("alice"));
  const deps = unitDeps({ tokens: tokenStore });
  await seedRecord(deps, connectedRecord());
  let sites = [{ siteId: "a", siteName: "A" }];
  let inTransaction = false;
  const attachments: KeyAttachments = {
    keysFor: vi.fn(), attach: vi.fn(), detach: vi.fn(), isAttached: vi.fn(), renameSite: vi.fn(),
    usersOf: async () => sites,
    removeKey: async () => { expect(inTransaction).toBe(true); sites = []; },
  };
  const context = { identity: { pluginId: deps.descriptor.pluginId, connectionId: deps.descriptor.connectionId }, descriptor: deps.descriptor };
  const tokensFor = vi.fn(({ context: actual }: { context: SharedOAuthDisconnectContext }) => { expect(actual).toBe(context); return tokenStore; });
  const storage: SharedOAuthDisconnectStorage = { readContext: async () => context, records: deps.records, tokensFor };
  const required = { storage, attachments, credentialId: KEY, clock: deps.clock, ownerWorkspaceId: "ws-1",
    digest: ({ text }: { text: string }) => createHash("sha256").update(text).digest("hex"),
    copy: { changed: "grants changed", revocationUnavailable: "unavailable" },
    transaction: async <T>({ run }: { run: () => Promise<T> }) => { inTransaction = true; try { return await run(); } finally { inTransaction = false; } },
  };
  return { required, deps, tokensFor, tokenStore, changeGrants: () => { sites = [...sites, { siteId: "b", siteName: "B" }]; }, inTransaction: () => inTransaction };
}

it("a grant change blocks the disconnect before tokens or provider I/O", async () => {
  const f = await fixture();
  const { report } = await inspectSharedOAuthDisconnect(f.required);
  f.changeGrants();
  const revoke = vi.fn();
  await expect(disconnectSharedOAuth({ ...f.required, expectedRevision: report.revision, expectedDigest: report.sourceDigest }, { revoke })).rejects.toMatchObject({ code: "storage-conflict" });
  expect(f.tokensFor).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
  expect((await f.deps.records.read({ key: KEY }))?.generation).toBe(1);
  expect(await f.required.attachments.usersOf({ keyId: KEY })).toHaveLength(2);
});

it("inspect reads no token", async () => {
  const f = await fixture();
  f.tokensFor.mockImplementation(() => { throw new Error("tokens opened"); });
  const { report } = await inspectSharedOAuthDisconnect(f.required);
  expect(report.sites).toEqual(["A"]);
  expect(report.sourceDigest).toBe(f.required.digest({ text: JSON.stringify({ credentialId: KEY, revision: report.revision, sites: [{ siteId: "a", siteName: "A" }] }) }));
  expect(f.tokensFor).not.toHaveBeenCalled();
});

it("grants are removed before any provider call", async () => {
  const f = await fixture();
  const { report } = await inspectSharedOAuthDisconnect(f.required);
  const revoke = vi.fn(async () => {
    expect(f.inTransaction()).toBe(false);
    expect(await f.required.attachments.usersOf({ keyId: KEY })).toEqual([]);
    expect((await f.deps.records.read({ key: KEY }))?.status).toBe("revocation-pending");
    throw new Error("refused");
  });
  const result = await disconnectSharedOAuth({ ...f.required, expectedRevision: report.revision, expectedDigest: report.sourceDigest }, { revoke });
  expect(revoke).toHaveBeenCalledTimes(1);
  expect(result.remoteRevocation).toBe("pending");
  expect(f.tokenStore.entries.has(KEY)).toBe(true);
});

it("retry of an already revocation-pending connection does not advance generation or revision a second time", async () => {
  const f = await fixture();
  const first = await inspectSharedOAuthDisconnect(f.required);
  await disconnectSharedOAuth({ ...f.required, expectedRevision: first.report.revision, expectedDigest: first.report.sourceDigest }, { revoke: async () => { throw new Error("refused"); } });
  const next = await inspectSharedOAuthDisconnect(f.required);
  const result = await disconnectSharedOAuth({ ...f.required, expectedRevision: next.report.revision, expectedDigest: next.report.sourceDigest }, { revoke: async () => {} });
  const record = await f.deps.records.read({ key: KEY });
  expect(record?.generation).toBe(next.record.generation);
  expect(record?.revision).toBe(next.record.revision + 1);
  expect(result.remoteRevocation).toBe("confirmed");
  expect(f.tokenStore.entries.has(KEY)).toBe(false);
});


it("refuses another owner's credential before CAS, grant removal or token access", async () => {
  const f = await fixture();
  const compareAndSet = vi.spyOn(f.required.storage.records, "compareAndSet");
  const removeKey = vi.spyOn(f.required.attachments, "removeKey");
  const { report } = await inspectSharedOAuthDisconnect(f.required);
  await expect(disconnectSharedOAuth({ ...f.required, ownerWorkspaceId: "other-owner", expectedRevision: report.revision, expectedDigest: report.sourceDigest })).rejects.toMatchObject({ code: "storage-conflict" });
  expect(compareAndSet).not.toHaveBeenCalled();
  expect(removeKey).not.toHaveBeenCalled();
  expect(f.tokensFor).not.toHaveBeenCalled();
});


it("changed reviewed grants refuse CAS and grant removal", async () => {
  const f = await fixture();
  const { report } = await inspectSharedOAuthDisconnect(f.required);
  const compareAndSet = vi.spyOn(f.required.storage.records, "compareAndSet");
  const removeKey = vi.spyOn(f.required.attachments, "removeKey");
  f.changeGrants();
  await expect(disconnectSharedOAuth({ ...f.required, expectedRevision: report.revision, expectedDigest: report.sourceDigest })).rejects.toMatchObject({ code: "storage-conflict" });
  expect(compareAndSet).not.toHaveBeenCalled();
  expect(removeKey).not.toHaveBeenCalled();
  expect(f.tokensFor).not.toHaveBeenCalled();
});

it("a concurrent owner write between review and stop refuses before grants or tokens are touched", async () => {
  const f = await fixture();
  const { report } = await inspectSharedOAuthDisconnect(f.required);
  const compareAndSet = vi.spyOn(f.required.storage.records, "compareAndSet").mockResolvedValueOnce(false);
  const removeKey = vi.spyOn(f.required.attachments, "removeKey");
  await expect(disconnectSharedOAuth({ ...f.required, expectedRevision: report.revision, expectedDigest: report.sourceDigest })).rejects.toMatchObject({ code: "storage-conflict", message: "grants changed" });
  expect(compareAndSet).toHaveBeenCalledWith(expect.objectContaining({ key: KEY, expectedRevision: report.revision }));
  expect(removeKey).not.toHaveBeenCalled();
  expect(f.tokensFor).not.toHaveBeenCalled();
  expect((await f.deps.records.read({ key: KEY }))?.status).toBe("connected");
});

it("without a loaded revoke hook the stop applies, remote revocation stays pending and tokens are kept for a retry", async () => {
  const f = await fixture();
  const { report } = await inspectSharedOAuthDisconnect(f.required);
  const result = await disconnectSharedOAuth({ ...f.required, expectedRevision: report.revision, expectedDigest: report.sourceDigest });
  expect(result).toMatchObject({ applied: true, remoteRevocation: "pending", sites: ["A"] });
  expect(f.tokenStore.entries.has(KEY)).toBe(true);
  const record = await f.deps.records.read({ key: KEY });
  expect(record?.status).toBe("revocation-pending");
  expect(record?.revocationFailure).toBe("provider-unreachable");
});
