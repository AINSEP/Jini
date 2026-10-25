import { afterEach, expect, test, vi } from "vitest";
import { ownerContext } from "../service.js";
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
