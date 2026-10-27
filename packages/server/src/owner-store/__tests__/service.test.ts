import { afterEach, expect, test, vi } from "vitest";
import { OWNER_REVOCATION_AUTO_ATTEMPTS, ownerContext } from "../service.js";
import { fixture, input, target } from "./fixture.js";

const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(async () => { for (const item of fixtures.splice(0)) await item.cleanup(); });
function setup() { const item = fixture(); fixtures.push(item); return item; }

test("put delegates CAS and label uniqueness, and inventory never contains plaintext or envelopes", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  await expect(store.put(input)).rejects.toMatchObject({ code: "conflict" });
  await expect(store.put({ ...input, id: entry.id, expectedRevision: 99 })).rejects.toMatchObject({ code: "conflict" });
  const inventory = await store.list({});
  expect(inventory).toEqual([entry]);
  expect(JSON.stringify(inventory)).not.toContain(input.payload.token);
  expect(inventory[0]).not.toHaveProperty("sealed");
  expect(inventory[0]).not.toHaveProperty("payload");
});

test("two selected sites receive the same immutable ID and replacements overwrite both copies", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  const sites = [target("one"), target("two")];
  const unselected = target("other");
  for (const site of sites) {
    await store.grant({ entryId: entry.id, consumerId: site.consumerId });
    await store.grant({ entryId: entry.id, consumerId: site.consumerId });
    expect(await store.syncTo({ target: site })).toEqual([{ kind: "vendor", id: entry.id, status: "copied" }]);
    const identity = { ...ownerContext(entry), workspaceId: site.workspaceId, id: entry.id };
    expect((await site.vault.get(identity))?.payload).toEqual(input.payload);
    const source = await store.repo.find(entry);
    const copied = await site.repo.find(identity);
    expect(copied?.sealed?.ciphertext).not.toBe(source?.sealed?.ciphertext);
  }
  expect(await store.syncTo({ target: unselected })).toEqual([]);
  const updated = await store.put({ ...input, id: entry.id, expectedRevision: entry.revision, payload: { token: "replacement" } });
  for (const site of sites) {
    await store.syncTo({ target: site });
    const copied = await site.vault.get({ ...ownerContext(updated), workspaceId: site.workspaceId, id: entry.id });
    expect(copied?.payload).toEqual({ token: "replacement" });
    expect(copied?.summary.revision).toBe(2);
  }
  expect(await store.grants({})).toHaveLength(2);
});

test("revoke removes only the selected consumer's copied ID and subsequent sync does not restore it", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  const a = target("one"), b = target("two");
  for (const site of [a, b]) {
    await store.grant({ entryId: entry.id, consumerId: site.consumerId });
    await store.syncTo({ target: site });
  }
  await expect(store.delete({ entryId: entry.id, expectedRevision: entry.revision })).rejects.toMatchObject({ code: "conflict" });
  await store.revoke({ entryId: entry.id, target: a });
  await store.revoke({ entryId: entry.id, target: a });
  expect(await store.syncTo({ target: a })).toEqual([]);
  expect(await a.repo.find({ workspaceId: a.workspaceId, id: entry.id })).toBeNull();
  expect((await b.vault.get({ ...ownerContext(entry), workspaceId: b.workspaceId, id: entry.id }))?.payload).toEqual(input.payload);
  expect((await store.grants({})).map(grant => grant.consumer_id)).toEqual(["two"]);
});

test("target cleanup failure still commits central revocation and can be retried", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  const site = target("one");
  await store.grant({ entryId: entry.id, consumerId: site.consumerId });
  await store.syncTo({ target: site });
  const failure = vi.spyOn(site.vault, "delete").mockRejectedValueOnce(new Error("site unavailable"));
  await expect(store.revoke({ entryId: entry.id, target: site })).rejects.toThrow("site unavailable");
  expect(await store.grants({})).toEqual([]);
  expect(await store.syncTo({ target: site })).toEqual([]);
  failure.mockRestore();
  await store.revoke({ entryId: entry.id, target: site });
  expect(await site.repo.find({ workspaceId: site.workspaceId, id: entry.id })).toBeNull();
});

test("P2: refuses owner deletion while revoked target cleanup remains incomplete", async () => {
  const f = setup();
  const store = await f.open();
  const entry = await store.put(input);
  const site = target("one");
  const identity = { ...ownerContext(entry), workspaceId: site.workspaceId, id: entry.id };
  await store.grant({ entryId: entry.id, consumerId: site.consumerId });
  expect(await store.syncTo({ target: site })).toEqual([{ kind: "vendor", id: entry.id, status: "copied" }]);
  const failure = vi.spyOn(site.repo, "delete").mockRejectedValueOnce(new Error("site unavailable"));
  try {
    await expect(store.revoke({ entryId: entry.id, target: site })).rejects.toThrow("site unavailable");
  } finally { failure.mockRestore(); }
  // Central access is revoked, but the target still holds the copied secret.
  expect(await store.grants({})).toEqual([]);
  expect((await site.vault.get(identity))?.payload).toEqual(input.payload);
  // The pending cleanup is durable: a restart must not forget the untracked copy.
  await f.close();
  const reopened = await f.open();
  await expect(reopened.delete({ entryId: entry.id, expectedRevision: entry.revision })).rejects.toMatchObject({
    code: "conflict", name: "OwnerRevocationPendingError", message: expect.stringContaining('consumer "one"') });
  expect(await reopened.pendingRevocations({})).toEqual([{ entry_id: entry.id, consumer_id: "one", workspace_id: "site-one",
    attempts: 1, updated_at: expect.any(String) }]);
  expect(await reopened.repo.find(entry)).not.toBeNull();
  await reopened.revoke({ entryId: entry.id, target: site });
  expect(await site.repo.find(identity)).toBeNull();
  expect(await reopened.pendingRevocations({})).toEqual([]);
  expect(await reopened.delete({ entryId: entry.id, expectedRevision: entry.revision })).toBe(true);
});

test("P2: the next sync to a revoked site retries cleanup, a bounded number of times", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  const site = target("one");
  await store.grant({ entryId: entry.id, consumerId: site.consumerId });
  await store.syncTo({ target: site });
  const outage = vi.spyOn(site.vault, "list").mockRejectedValue(new Error("site unavailable"));
  await expect(store.revoke({ entryId: entry.id, target: site })).rejects.toThrow("site unavailable");
  // The contract is literally five failures (the revoke plus four sync retries), not whatever the constant says.
  expect(OWNER_REVOCATION_AUTO_ATTEMPTS).toBe(5);
  // Sync keeps working while the outage persists and reports the outstanding cleanup every time,
  // including after retries stop at the cap, so exhaustion is never silent.
  const outstanding = { kind: "vendor", id: entry.id, status: "failed", reasonCode: "conflict" };
  for (let sync = 0; sync < 7; sync++) expect(await store.syncTo({ target: site })).toEqual([outstanding]);
  expect(outage).toHaveBeenCalledTimes(5);
  expect(await store.pendingRevocations({})).toMatchObject([{ attempts: 5 }]);
  await expect(store.delete({ entryId: entry.id, expectedRevision: entry.revision })).rejects.toMatchObject({ code: "conflict" });
  // Past the cap only an explicit revoke retries; once the site recovers, so does a later sync.
  await expect(store.revoke({ entryId: entry.id, target: site })).rejects.toThrow("site unavailable");
  expect(outage).toHaveBeenCalledTimes(6);
  outage.mockRestore();
  await store.revoke({ entryId: entry.id, target: site });
  expect(await site.repo.find({ workspaceId: site.workspaceId, id: entry.id })).toBeNull();
  expect(await store.delete({ entryId: entry.id, expectedRevision: entry.revision })).toBe(true);
});

test("P2: a sync after a transient outage removes the leftover copy without an explicit revoke", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  const site = target("one");
  await store.grant({ entryId: entry.id, consumerId: site.consumerId });
  await store.syncTo({ target: site });
  vi.spyOn(site.vault, "delete").mockRejectedValueOnce(new Error("site unavailable"));
  await expect(store.revoke({ entryId: entry.id, target: site })).rejects.toThrow("site unavailable");
  expect(await store.syncTo({ target: site })).toEqual([]);
  expect(await site.repo.find({ workspaceId: site.workspaceId, id: entry.id })).toBeNull();
  expect(await store.pendingRevocations({})).toEqual([]);
  expect(await store.delete({ entryId: entry.id, expectedRevision: entry.revision })).toBe(true);
});

test("P2 hole: a different workspace with the same consumer id cannot settle a pending cleanup", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  const site = target("one");
  const identity = { ...ownerContext(entry), workspaceId: site.workspaceId, id: entry.id };
  await store.grant({ entryId: entry.id, consumerId: site.consumerId });
  await store.syncTo({ target: site });
  vi.spyOn(site.vault, "delete").mockRejectedValueOnce(new Error("site unavailable"));
  await expect(store.revoke({ entryId: entry.id, target: site })).rejects.toThrow("site unavailable");
  // Same consumer id, but another workspace that never held the copy: its empty lookup proves nothing.
  const elsewhere = { ...target("one"), workspaceId: "another-workspace" };
  await expect(store.revoke({ entryId: entry.id, target: elsewhere })).rejects.toMatchObject({ code: "context" });
  expect(await store.syncTo({ target: elsewhere })).toEqual([{ kind: "vendor", id: entry.id, status: "failed", reasonCode: "conflict" }]);
  expect(await store.pendingRevocations({})).toEqual([{ entry_id: entry.id, consumer_id: "one", workspace_id: "site-one",
    attempts: 1, updated_at: expect.any(String) }]);
  await expect(store.delete({ entryId: entry.id, expectedRevision: entry.revision })).rejects.toMatchObject({ name: "OwnerRevocationPendingError" });
  expect((await site.vault.get(identity))?.payload).toEqual(input.payload);
  // The recorded destination still settles it.
  await store.revoke({ entryId: entry.id, target: site });
  expect(await site.repo.find(identity)).toBeNull();
  expect(await store.delete({ entryId: entry.id, expectedRevision: entry.revision })).toBe(true);
});

test("P2 binding: a revoke naming another workspace is refused, so the synced copy stays tracked", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  const a = target("one");
  const b = { ...target("one"), workspaceId: "site-b" };
  await store.grant({ entryId: entry.id, consumerId: a.consumerId });
  await store.syncTo({ target: a });
  // B never held the copy: its empty lookup must not stand in for cleaning A.
  await expect(store.revoke({ entryId: entry.id, target: b })).rejects.toMatchObject({ code: "context" });
  expect(await store.grants({})).toEqual([{ entry_id: entry.id, consumer_id: "one", workspace_id: "site-one", created_at: expect.any(String) }]);
  await expect(store.delete({ entryId: entry.id, expectedRevision: entry.revision })).rejects.toMatchObject({ code: "conflict" });
  expect((await a.vault.get({ ...ownerContext(entry), workspaceId: a.workspaceId, id: entry.id }))?.payload).toEqual(input.payload);
  await store.revoke({ entryId: entry.id, target: a });
  expect(await a.repo.find({ workspaceId: a.workspaceId, id: entry.id })).toBeNull();
  expect(await store.delete({ entryId: entry.id, expectedRevision: entry.revision })).toBe(true);
});

test("P2 binding: a grant copies to one workspace only, so revoking it leaves no untracked copy", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  const a = target("one");
  const b = { ...target("one"), workspaceId: "site-b" };
  await store.grant({ entryId: entry.id, consumerId: a.consumerId });
  expect(await store.syncTo({ target: a })).toEqual([{ kind: "vendor", id: entry.id, status: "copied" }]);
  expect(await store.syncTo({ target: b })).toEqual([{ kind: "vendor", id: entry.id, status: "failed", reasonCode: "context" }]);
  expect(await b.repo.find({ workspaceId: b.workspaceId, id: entry.id })).toBeNull();
  await store.revoke({ entryId: entry.id, target: a });
  expect(await a.repo.find({ workspaceId: a.workspaceId, id: entry.id })).toBeNull();
  expect(await store.delete({ entryId: entry.id, expectedRevision: entry.revision })).toBe(true);
});

test("P2 binding: rebinding waits for the old destination's cleanup, then binds afresh", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  const a = target("one");
  const b = { ...target("one"), workspaceId: "site-b" };
  await store.grant({ entryId: entry.id, consumerId: a.consumerId });
  await store.syncTo({ target: a });
  vi.spyOn(a.vault, "delete").mockRejectedValueOnce(new Error("site unavailable"));
  await expect(store.revoke({ entryId: entry.id, target: a })).rejects.toThrow("site unavailable");
  // A fresh grant could bind B while the pending record still names A, and B's copy would then be untracked.
  await expect(store.grant({ entryId: entry.id, consumerId: a.consumerId })).rejects.toMatchObject({ name: "OwnerRevocationPendingError" });
  expect(await store.grants({})).toEqual([]);
  await store.revoke({ entryId: entry.id, target: a });
  await store.grant({ entryId: entry.id, consumerId: a.consumerId });
  expect(await store.syncTo({ target: b })).toEqual([{ kind: "vendor", id: entry.id, status: "copied" }]);
  expect(await store.grants({})).toMatchObject([{ workspace_id: "site-b" }]);
});

test("P2 legacy: an unreconciled entry stays undeletable until every named site is cleaned, and reconcile waits for revocation", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  const one = target("one"), two = target("two");
  const sites = [one, two];
  for (const site of sites) {
    await store.grant({ entryId: entry.id, consumerId: site.consumerId });
    await store.syncTo({ target: site });
  }
  // What a store restored from a destination-less snapshot (or upgraded with unbound grants) holds.
  await store.kernel.run(db => db.insertInto("owner_unreconciled").values({ entry_id: entry.id }).execute());
  await expect(store.reconcile({ entryId: entry.id, targets: sites })).rejects.toMatchObject({ code: "conflict" });
  // A snapshot without destination records restores no grants, yet the copies remain on the sites.
  await store.kernel.run(db => db.deleteFrom("owner_grants").execute());
  await expect(store.delete({ entryId: entry.id, expectedRevision: entry.revision })).rejects.toMatchObject({
    code: "conflict", name: "OwnerUnreconciledError" });
  const outage = vi.spyOn(two.vault, "list").mockRejectedValueOnce(new Error("site unavailable"));
  await expect(store.reconcile({ entryId: entry.id, targets: sites })).rejects.toThrow("site unavailable");
  outage.mockRestore();
  expect(await one.repo.find({ workspaceId: one.workspaceId, id: entry.id })).toBeNull();
  await expect(store.delete({ entryId: entry.id, expectedRevision: entry.revision })).rejects.toMatchObject({ name: "OwnerRevocationPendingError" });
  // Settling that one site is not a full pass over the named sites, so the mark stays.
  await store.revoke({ entryId: entry.id, target: two });
  await expect(store.delete({ entryId: entry.id, expectedRevision: entry.revision })).rejects.toMatchObject({ name: "OwnerUnreconciledError" });
  await store.reconcile({ entryId: entry.id, targets: sites });
  for (const site of sites) expect(await site.repo.find({ workspaceId: site.workspaceId, id: entry.id })).toBeNull();
  expect(await store.delete({ entryId: entry.id, expectedRevision: entry.revision })).toBe(true);
});

test("revoke deletes a copy the target can no longer decrypt", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  const site = target("one");
  await store.grant({ entryId: entry.id, consumerId: site.consumerId });
  await store.syncTo({ target: site });
  // Same rows, replaced site key: the sealed copy still exists but no longer opens.
  const rekeyed = target("one", { repo: site.repo, keyHex: "77".repeat(32) });
  await expect(rekeyed.vault.get({ ...ownerContext(entry), workspaceId: site.workspaceId, id: entry.id })).rejects.toThrow();
  await store.revoke({ entryId: entry.id, target: rekeyed });
  expect(await site.repo.find({ workspaceId: site.workspaceId, id: entry.id })).toBeNull();
});

test("revocation waits for an in-flight copy then removes it before any later sync", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  const site = target("one");
  await store.grant({ entryId: entry.id, consumerId: site.consumerId });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const copy = site.vault.copyToSite.bind(site.vault);
  vi.spyOn(site.vault, "copyToSite").mockImplementationOnce(async args => {
    entered();
    await gate;
    return copy(args);
  });
  const syncing = store.syncTo({ target: site });
  await started;
  const revoking = store.revoke({ entryId: entry.id, target: site });
  release();
  await syncing;
  await revoking;
  expect(await store.grants({})).toEqual([]);
  expect(await store.syncTo({ target: site })).toEqual([]);
  expect(await site.repo.find({ workspaceId: site.workspaceId, id: entry.id })).toBeNull();
});

test("noncopyable credentials and grants for nonexistent entries are refused", async () => {
  const store = await setup().open();
  await expect(store.put({ ...input, kind: "custom" })).rejects.toMatchObject({ code: "context" });
  await expect(store.grant({ entryId: "missing", consumerId: "site" })).rejects.toMatchObject({ code: "context" });
  expect(await store.grants({})).toEqual([]);
});

test("deleting an ungranted entry keeps the vault's revision guard", async () => {
  const store = await setup().open();
  const entry = await store.put(input);
  await expect(store.delete({ entryId: entry.id, expectedRevision: entry.revision + 1 })).rejects.toMatchObject({ code: "conflict" });
  expect(await store.delete({ entryId: entry.id, expectedRevision: entry.revision })).toBe(true);
  expect(await store.delete({ entryId: entry.id, expectedRevision: entry.revision })).toBe(false);
  expect(await store.list({})).toEqual([]);
});
