import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { countLegacyOwnerStore, OwnerStoreRecoveryError, readLegacyOwnerStore } from "../legacy.js";
import { input, legacyStore, open } from "./fixture.js";

const stores: Awaited<ReturnType<typeof legacyStore>>[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.cleanup(); });
async function setup(options: Parameters<typeof legacyStore>[0] = {}) { const store = await legacyStore(options); stores.push(store); return store; }
const digest = (filePath: string) => createHash("sha256").update(readFileSync(filePath)).digest("hex");
function ledger(filePath: string) {
  const db = new Database(filePath, { readonly: true });
  try {
    return { steps: db.prepare("SELECT id FROM owner_migrations ORDER BY id").all(),
      tables: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() };
  } finally { db.close(); }
}

test("counts an empty published-0000 store without its key, leaving the file and its ledger unchanged", async () => {
  const store = await setup();
  rmSync(store.keyFilePath);
  const before = digest(store.filePath);
  expect(await countLegacyOwnerStore({ filePath: store.filePath, open })).toEqual({ entries: 0, grants: 0 });
  expect(digest(store.filePath)).toBe(before);
  expect(ledger(store.filePath).steps).toEqual([{ id: "0000_owner_store" }]);
  expect(existsSync(store.keyFilePath)).toBe(false);
});

test("counts entries and grants of a used store", async () => {
  const store = await setup({ entries: [input, { ...input, label: "Second" }], grants: [{ entryIndex: 0, consumerId: "/sites/one" }] });
  expect(await countLegacyOwnerStore({ filePath: store.filePath, open })).toEqual({ entries: 2, grants: 1 });
});

test("reads decrypted entries and grants read-only, never migrating a 0000 store to 0001", async () => {
  const store = await setup({ entries: [input], grants: [{ entryIndex: 0, consumerId: "/sites/one" }] });
  const before = digest(store.filePath);
  const snapshot = await readLegacyOwnerStore({ filePath: store.filePath, keyFilePath: store.keyFilePath, open });
  expect(snapshot.entries).toEqual([{ id: store.saved[0]!.id, kind: "vendor", ownerKey: "plugin", binding: null, provider: "provider",
    label: "Shared API key", isDefault: true, meta: input.meta, payload: input.payload }]);
  expect(snapshot.grants).toEqual([{ entryId: store.saved[0]!.id, consumerId: "/sites/one" }]);
  expect(snapshot.revocations).toEqual([]);
  expect(digest(store.filePath)).toBe(before);
  const { steps, tables } = ledger(store.filePath);
  expect(steps).toEqual([{ id: "0000_owner_store" }]);
  expect(tables).not.toContainEqual({ name: "owner_revocations" });
});

test("a store past the unpublished 0001 step also lists its pending cleanups", async () => {
  const store = await setup({ entries: [input] });
  const db = new Database(store.filePath);
  db.exec("CREATE TABLE owner_revocations (entry_id TEXT NOT NULL, consumer_id TEXT NOT NULL, workspace_id TEXT NOT NULL, attempts INTEGER NOT NULL, updated_at TEXT NOT NULL)");
  db.prepare("INSERT INTO owner_revocations VALUES (?, '/sites/old', 'ws-old', 1, 'now')").run(store.saved[0]!.id);
  db.close();
  const snapshot = await readLegacyOwnerStore({ filePath: store.filePath, keyFilePath: store.keyFilePath, open });
  expect(snapshot.revocations).toEqual([{ entryId: store.saved[0]!.id, consumerId: "/sites/old" }]);
});

test.each(["missing", "different"])("a %s owner key is a recovery error and never creates a key file", async mode => {
  const store = await setup({ entries: [input] });
  if (mode === "missing") rmSync(store.keyFilePath);
  else writeFileSync(store.keyFilePath, "11".repeat(32));
  await expect(readLegacyOwnerStore({ filePath: store.filePath, keyFilePath: store.keyFilePath, open })).rejects.toBeInstanceOf(OwnerStoreRecoveryError);
  expect(existsSync(store.keyFilePath)).toBe(mode === "different");
});

test("reading a missing owner.db fails without creating it", async () => {
  const store = await setup();
  store.cleanup();
  await expect(countLegacyOwnerStore({ filePath: store.filePath, open })).rejects.toThrow();
  expect(existsSync(store.filePath)).toBe(false);
});
