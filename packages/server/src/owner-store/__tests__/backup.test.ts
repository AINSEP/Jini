import { readFileSync } from "node:fs";
import { openWithPassphrase, sealWithPassphrase } from "@jini-ai/platform/secrets";
import { afterEach, expect, test, vi } from "vitest";
import { exportOwnerStore, restoreOwnerStore } from "../backup.js";
import { ownerContext } from "../service.js";
import { fixture, input, target } from "./fixture.js";

const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(async () => { for (const item of fixtures.splice(0)) await item.cleanup(); });
function setup() { const item = fixture(); fixtures.push(item); return item; }

test("backup restores under a different owner key with its active grants and without exporting key material", async () => {
  const sourceFixture = setup(), destinationFixture = setup();
  const source = await sourceFixture.open(), store = await destinationFixture.open();
  const entry = await source.put({ ...input, hintToken: input.payload.token });
  await source.grant({ entryId: entry.id, consumerId: "one" });
  const envelope = await exportOwnerStore({ store: source, passphrase: "recovery" });
  expect(envelope).not.toContain(input.payload.token);
  const payload = await openWithPassphrase({ envelope, passphrase: "recovery" });
  expect(payload).not.toContain(readFileSync(sourceFixture.required.keyFilePath, "utf8"));
  expect(payload).not.toContain("sealed");
  expect(payload).not.toContain("consumer_id");
  expect(JSON.parse(payload).entries[0]).toMatchObject({ last4: "cape", tokenLength: input.payload.token.length });
  expect(readFileSync(destinationFixture.required.keyFilePath, "utf8")).not.toBe(readFileSync(sourceFixture.required.keyFilePath, "utf8"));
  expect(await restoreOwnerStore({ store, envelope, passphrase: "recovery" })).toEqual({ restored: 1 });
  expect((await store.vault.get({ ...ownerContext(entry), id: entry.id }))?.payload).toEqual(input.payload);
  expect((await store.list({}))[0]).toMatchObject({ last4: "cape", tokenLength: input.payload.token.length });
  expect((await store.repo.find(entry))?.sealed?.ciphertext).not.toBe((await source.repo.find(entry))?.sealed?.ciphertext);
  expect(await store.grants({})).toEqual(await source.grants({}));
  const site = target("one");
  expect(await store.syncTo({ target: site })).toEqual([{ kind: "vendor", id: entry.id, status: "copied", last4: "cape" }]);
});

test("restore keeps each host-selected hint, short-token length and hintless payload policy", async () => {
  const source = await setup().open(), store = await setup().open();
  const selected = "host-selected-credential";
  await source.put({ ...input, label: "Selected", payload: { selected, token: "unrelated-value" }, hintToken: selected });
  await source.put({ ...input, label: "Short", hintToken: "short" });
  await source.put({ ...input, label: "Unselected" });
  await source.put({ ...input, label: "Unconfigured", payload: null, hintToken: selected });
  await source.put({ ...input, label: "Database", kind: "database-destination", meta: {}, hintToken: selected });
  const envelope = await exportOwnerStore({ store: source, passphrase: "recovery" });
  expect(await restoreOwnerStore({ store, envelope, passphrase: "recovery" })).toEqual({ restored: 5 });
  expect((await store.list({})).map(({ label, last4, tokenLength }) => ({ label, last4, tokenLength }))
    .sort((a, b) => a.label.localeCompare(b.label))).toEqual([
    { label: "Database", last4: null, tokenLength: null },
    { label: "Selected", last4: "tial", tokenLength: selected.length },
    { label: "Short", last4: null, tokenLength: 5 },
    { label: "Unconfigured", last4: null, tokenLength: null },
    { label: "Unselected", last4: null, tokenLength: null },
  ]);
});

test("snapshots without hint fields still restore without guessing a token", async () => {
  const source = await setup().open(), store = await setup().open();
  const entry = await source.put({ ...input, hintToken: input.payload.token });
  const original = await exportOwnerStore({ store: source, passphrase: "recovery" });
  const snapshot = JSON.parse(await openWithPassphrase({ envelope: original, passphrase: "recovery" }));
  delete snapshot.entries[0].last4;
  delete snapshot.entries[0].tokenLength;
  const envelope = await sealWithPassphrase({ payload: JSON.stringify(snapshot), passphrase: "recovery" });
  expect(await restoreOwnerStore({ store, envelope, passphrase: "recovery" })).toEqual({ restored: 1 });
  expect((await store.list({}))[0]).toMatchObject({ id: entry.id, last4: null, tokenLength: null });
  expect((await store.vault.get(entry))?.payload).toEqual(input.payload);
});

/** A source store whose only entry was revoked from a site that was down, so its copy is still there. */
async function pendingSource() {
  const source = await setup().open();
  const entry = await source.put(input);
  const site = target("one");
  await source.grant({ entryId: entry.id, consumerId: site.consumerId });
  await source.syncTo({ target: site });
  vi.spyOn(site.vault, "delete").mockRejectedValueOnce(new Error("site unavailable"));
  await expect(source.revoke({ entryId: entry.id, target: site })).rejects.toThrow("site unavailable");
  return { source, entry, site };
}

test("P2 hole: a pending cleanup survives backup and restore, so deletion stays refused", async () => {
  const { source, entry, site } = await pendingSource();
  const store = await setup().open();
  const envelope = await exportOwnerStore({ store: source, passphrase: "recovery" });
  expect(await restoreOwnerStore({ store, envelope, passphrase: "recovery" })).toEqual({ restored: 1 });
  expect(await store.pendingRevocations({})).toEqual(await source.pendingRevocations({}));
  await expect(store.delete({ entryId: entry.id, expectedRevision: 1 })).rejects.toMatchObject({ name: "OwnerRevocationPendingError" });
  // The restored record still names the site's workspace, so the original copy is the one cleaned up.
  await store.revoke({ entryId: entry.id, target: site });
  expect(await site.repo.find({ workspaceId: site.workspaceId, id: entry.id })).toBeNull();
  expect(await store.delete({ entryId: entry.id, expectedRevision: 1 })).toBe(true);
});

test("P2 hole: an active grant survives backup and restore, so the synced copy stays tracked", async () => {
  const source = await setup().open(), store = await setup().open();
  const entry = await source.put(input);
  const site = target("one");
  await source.grant({ entryId: entry.id, consumerId: site.consumerId });
  await source.syncTo({ target: site });
  const envelope = await exportOwnerStore({ store: source, passphrase: "recovery" });
  expect(await restoreOwnerStore({ store, envelope, passphrase: "recovery" })).toEqual({ restored: 1 });
  expect(await store.grants({})).toEqual(await source.grants({}));
  await expect(store.delete({ entryId: entry.id, expectedRevision: 1 })).rejects.toMatchObject({ code: "conflict" });
  await store.revoke({ entryId: entry.id, target: site });
  expect(await site.repo.find({ workspaceId: site.workspaceId, id: entry.id })).toBeNull();
  expect(await store.delete({ entryId: entry.id, expectedRevision: 1 })).toBe(true);
});

/** A source store with one entry granted to two sites. */
async function grantedSource() {
  const source = await setup().open();
  const entry = await source.put(input);
  await source.grant({ entryId: entry.id, consumerId: "one" });
  await source.grant({ entryId: entry.id, consumerId: "two" });
  return source;
}

test.each([
  ["missing list", (s: GrantSnapshot) => { s.grants = undefined as never; }],
  ["unknown entry", (s: GrantSnapshot) => { s.grants[1].entryId = "absent"; }],
  ["duplicate pair", (s: GrantSnapshot) => { s.grants.push({ ...s.grants[0] }); }],
  ["missing time", (s: GrantSnapshot) => { delete s.grants[1].createdAt; }],
  ["empty consumer", (s: GrantSnapshot) => { s.grants[1].consumerId = ""; }],
  ["extra field", (s: GrantSnapshot) => { s.grants[1].sealed = {}; }],
  ["missing destination", (s: GrantSnapshot) => { delete s.grants[1].workspaceId; }],
  ["empty destination", (s: GrantSnapshot) => { s.grants[1].workspaceId = ""; }],
])("rejects a grant with a %s before restoring any rows", async (_name, patch) => {
  const source = await grantedSource(), store = await setup().open();
  const original = await exportOwnerStore({ store: source, passphrase: "recovery" });
  const snapshot = JSON.parse(await openWithPassphrase({ envelope: original, passphrase: "recovery" }));
  patch(snapshot);
  const envelope = await sealWithPassphrase({ payload: JSON.stringify(snapshot), passphrase: "recovery" });
  await expect(restoreOwnerStore({ store, envelope, passphrase: "recovery" })).rejects.toMatchObject({ code: "invalid-backup" });
  expect(await store.list({})).toEqual([]);
  expect(await store.grants({})).toEqual([]);
});
type GrantSnapshot = { grants: [Record<string, unknown>, Record<string, unknown>, ...Record<string, unknown>[]] };

/** The document @jini-ai/db 0.6.12 actually exported: entries only, no hints, grants or cleanup records. */
async function publishedV1Envelope({ source }: { source: Awaited<ReturnType<ReturnType<typeof setup>["open"]>> }) {
  const original = await exportOwnerStore({ store: source, passphrase: "recovery" });
  const { entries } = JSON.parse(await openWithPassphrase({ envelope: original, passphrase: "recovery" }));
  const legacy = entries.map(({ last4: _last4, tokenLength: _length, ...entry }: Record<string, unknown>) => entry);
  return sealWithPassphrase({ payload: JSON.stringify({ format: "jini-owner-store", version: 1, entries: legacy }), passphrase: "recovery" });
}

test("P2 legacy: a published version-1 backup restores, but deletion waits until each site is reconciled", async () => {
  const source = await setup().open();
  const entry = await source.put(input);
  const site = target("one");
  await source.grant({ entryId: entry.id, consumerId: site.consumerId });
  await source.syncTo({ target: site });
  const store = await setup().open();
  expect(await restoreOwnerStore({ store, envelope: await publishedV1Envelope({ source }), passphrase: "recovery" })).toEqual({ restored: 1 });
  expect((await store.vault.get({ ...ownerContext(entry), id: entry.id }))?.payload).toEqual(input.payload);
  expect(await store.grants({})).toEqual([]);
  // The snapshot never said where the entry was copied, so an empty ledger proves nothing.
  await expect(store.delete({ entryId: entry.id, expectedRevision: 1 })).rejects.toMatchObject({ name: "OwnerUnreconciledError" });
  // The mark survives a further backup cycle.
  const again = await setup().open();
  await restoreOwnerStore({ store: again, envelope: await exportOwnerStore({ store, passphrase: "recovery" }), passphrase: "recovery" });
  await expect(again.delete({ entryId: entry.id, expectedRevision: 1 })).rejects.toMatchObject({ name: "OwnerUnreconciledError" });
  await again.reconcile({ entryId: entry.id, targets: [site] });
  expect(await site.repo.find({ workspaceId: site.workspaceId, id: entry.id })).toBeNull();
  expect(await again.delete({ entryId: entry.id, expectedRevision: 1 })).toBe(true);
});

test("P2 binding: a restored grant keeps its destination, so a revoke naming another workspace is still refused", async () => {
  const source = await setup().open(), store = await setup().open();
  const entry = await source.put(input);
  const site = target("one");
  await source.grant({ entryId: entry.id, consumerId: site.consumerId });
  await source.syncTo({ target: site });
  await restoreOwnerStore({ store, envelope: await exportOwnerStore({ store: source, passphrase: "recovery" }), passphrase: "recovery" });
  expect(await store.grants({})).toEqual([{ entry_id: entry.id, consumer_id: "one", workspace_id: "site-one", created_at: expect.any(String) }]);
  await expect(store.revoke({ entryId: entry.id, target: { ...target("one"), workspaceId: "site-b" } })).rejects.toMatchObject({ code: "context" });
  await expect(store.delete({ entryId: entry.id, expectedRevision: 1 })).rejects.toMatchObject({ code: "conflict" });
});

test.each([
  ["missing list", (s: { unreconciled?: unknown[] }) => { delete s.unreconciled; }],
  ["unknown entry", (s: { unreconciled?: unknown[] }) => { s.unreconciled = ["absent"]; }],
  ["duplicate entry", (s: { unreconciled?: unknown[] }) => { s.unreconciled!.push(s.unreconciled![0]); }],
])("rejects an unreconciled list with a %s before restoring any rows", async (_name, patch) => {
  const source = await setup().open(), store = await setup().open();
  await source.put(input);
  const restored = await setup().open();
  await restoreOwnerStore({ store: restored, envelope: await publishedV1Envelope({ source }), passphrase: "recovery" });
  const snapshot = JSON.parse(await openWithPassphrase({ envelope: await exportOwnerStore({ store: restored, passphrase: "recovery" }), passphrase: "recovery" }));
  patch(snapshot);
  const envelope = await sealWithPassphrase({ payload: JSON.stringify(snapshot), passphrase: "recovery" });
  await expect(restoreOwnerStore({ store, envelope, passphrase: "recovery" })).rejects.toMatchObject({ code: "invalid-backup" });
  expect(await store.list({})).toEqual([]);
});

test.each([
  ["missing list", (s: Snapshot) => { s.revocations = undefined as never; }],
  ["unknown entry", (s: Snapshot) => { s.revocations[0].entryId = "absent"; }],
  ["duplicate pair", (s: Snapshot) => { s.revocations.push({ ...s.revocations[0] }); }],
  ["missing workspace", (s: Snapshot) => { delete s.revocations[0].workspaceId; }],
  ["empty consumer", (s: Snapshot) => { s.revocations[0].consumerId = ""; }],
  ["zero attempts", (s: Snapshot) => { s.revocations[0].attempts = 0; }],
  ["extra field", (s: Snapshot) => { s.revocations[0].sealed = {}; }],
])("rejects a pending cleanup with a %s before restoring any rows", async (_name, patch) => {
  const { source } = await pendingSource();
  const store = await setup().open();
  const original = await exportOwnerStore({ store: source, passphrase: "recovery" });
  const snapshot = JSON.parse(await openWithPassphrase({ envelope: original, passphrase: "recovery" }));
  patch(snapshot);
  const envelope = await sealWithPassphrase({ payload: JSON.stringify(snapshot), passphrase: "recovery" });
  await expect(restoreOwnerStore({ store, envelope, passphrase: "recovery" })).rejects.toMatchObject({ code: "invalid-backup" });
  expect(await store.list({})).toEqual([]);
  expect(await store.pendingRevocations({})).toEqual([]);
});
type Snapshot = { revocations: [Record<string, unknown>, ...Record<string, unknown>[]] };

test.each([
  ["suffix type", { last4: 1234, tokenLength: 12 }],
  ["suffix length", { last4: "too-long", tokenLength: 12 }],
  ["length type", { last4: null, tokenLength: "12" }],
  ["negative length", { last4: null, tokenLength: -1 }],
  ["fractional length", { last4: null, tokenLength: 12.5 }],
  ["short-token suffix", { last4: "tail", tokenLength: 11 }],
  ["missing length", { last4: "tail", tokenLength: null }],
  ["unconfigured hint", { last4: "tail", tokenLength: 12, payload: null }],
  ["database hint", { last4: "tail", tokenLength: 12, kind: "database-destination", meta: {} }],
])("rejects an invalid %s before restoring any rows", async (_name, patch) => {
  const source = await setup().open(), store = await setup().open();
  await source.put(input);
  const original = await exportOwnerStore({ store: source, passphrase: "recovery" });
  const snapshot = JSON.parse(await openWithPassphrase({ envelope: original, passphrase: "recovery" }));
  snapshot.entries.push({ ...snapshot.entries[0], id: "second", label: "Other", ...patch });
  const envelope = await sealWithPassphrase({ payload: JSON.stringify(snapshot), passphrase: "recovery" });
  await expect(restoreOwnerStore({ store, envelope, passphrase: "recovery" })).rejects.toMatchObject({ code: "invalid-backup" });
  expect(await store.list({})).toEqual([]);
});

test("wrong passphrase leaves an empty store unchanged; a nonempty store refuses restore", async () => {
  const source = await setup().open(), store = await setup().open();
  await source.put(input);
  const envelope = await exportOwnerStore({ store: source, passphrase: "right" });
  await expect(restoreOwnerStore({ store, envelope, passphrase: "wrong" })).rejects.toThrow(/authentication/);
  expect(await store.list({})).toEqual([]);
  const existing = await store.put({ ...input, label: "Keep me" });
  await expect(restoreOwnerStore({ store, envelope, passphrase: "right" })).rejects.toMatchObject({ code: "not-empty" });
  expect(await store.list({})).toEqual([existing]);
});

test("a second row rejected by the real vault rolls back the first resealed row", async () => {
  const source = await setup().open(), store = await setup().open();
  await source.put(input);
  const envelope = await exportOwnerStore({ store: source, passphrase: "recovery" });
  const snapshot = JSON.parse(await openWithPassphrase({ envelope, passphrase: "recovery" }));
  snapshot.entries.push({ ...snapshot.entries[0], id: "second", label: "Other", meta: { credentialType: "invalid" } });
  const malformed = await sealWithPassphrase({ payload: JSON.stringify(snapshot), passphrase: "recovery" });
  await expect(restoreOwnerStore({ store, envelope: malformed, passphrase: "recovery" })).rejects.toMatchObject({ code: "invalid-meta" });
  expect(await store.list({})).toEqual([]);
  expect(await store.grants({})).toEqual([]);
  expect(await store.kernel.run(db => db.selectFrom("secrets_vault").selectAll().execute())).toEqual([]);
});

test.each(["duplicate", "version", "extra-field"])("rejects an authenticated but invalid %s snapshot before writes", async mode => {
  const source = await setup().open(), store = await setup().open();
  await source.put(input);
  const original = await exportOwnerStore({ store: source, passphrase: "recovery" });
  const snapshot = JSON.parse(await openWithPassphrase({ envelope: original, passphrase: "recovery" }));
  if (mode === "duplicate") snapshot.entries.push(snapshot.entries[0]);
  if (mode === "version") snapshot.version = 3;
  if (mode === "extra-field") snapshot.entries[0].sealed = {};
  const envelope = await sealWithPassphrase({ payload: JSON.stringify(snapshot), passphrase: "recovery" });
  await expect(restoreOwnerStore({ store, envelope, passphrase: "recovery" })).rejects.toMatchObject({ code: "invalid-backup" });
  expect(await store.list({})).toEqual([]);
});
