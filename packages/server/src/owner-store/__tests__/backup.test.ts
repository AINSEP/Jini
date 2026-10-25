import { readFileSync } from "node:fs";
import { openWithPassphrase, sealWithPassphrase } from "@jini-ai/platform/secrets";
import { afterEach, expect, test } from "vitest";
import { exportOwnerStore, restoreOwnerStore } from "../backup.js";
import { ownerContext } from "../service.js";
import { fixture, input, target } from "./fixture.js";

const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(async () => { for (const item of fixtures.splice(0)) await item.cleanup(); });
function setup() { const item = fixture(); fixtures.push(item); return item; }

test("backup restores under a different owner key without activating grants or exporting key material", async () => {
  const sourceFixture = setup(), destinationFixture = setup();
  const source = await sourceFixture.open(), store = await destinationFixture.open();
  const entry = await source.put(input);
  await source.grant({ entryId: entry.id, consumerId: "one" });
  const envelope = await exportOwnerStore({ store: source, passphrase: "recovery" });
  expect(envelope).not.toContain(input.payload.token);
  const payload = await openWithPassphrase({ envelope, passphrase: "recovery" });
  expect(payload).not.toContain(readFileSync(sourceFixture.required.keyFilePath, "utf8"));
  expect(payload).not.toContain("sealed");
  expect(payload).not.toContain("consumer_id");
  expect(readFileSync(destinationFixture.required.keyFilePath, "utf8")).not.toBe(readFileSync(sourceFixture.required.keyFilePath, "utf8"));
  expect(await restoreOwnerStore({ store, envelope, passphrase: "recovery" })).toEqual({ restored: 1 });
  expect((await store.vault.get({ ...ownerContext(entry), id: entry.id }))?.payload).toEqual(input.payload);
  expect((await store.repo.find(entry))?.sealed?.ciphertext).not.toBe((await source.repo.find(entry))?.sealed?.ciphertext);
  expect(await store.grants({})).toEqual([]);
  const site = target("one");
  expect(await store.syncTo({ target: site })).toEqual([]);
  await store.grant({ entryId: entry.id, consumerId: site.consumerId });
  expect(await store.syncTo({ target: site })).toEqual([{ kind: "vendor", id: entry.id, status: "copied" }]);
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
  if (mode === "version") snapshot.version = 2;
  if (mode === "extra-field") snapshot.entries[0].sealed = {};
  const envelope = await sealWithPassphrase({ payload: JSON.stringify(snapshot), passphrase: "recovery" });
  await expect(restoreOwnerStore({ store, envelope, passphrase: "recovery" })).rejects.toMatchObject({ code: "invalid-backup" });
  expect(await store.list({})).toEqual([]);
});
