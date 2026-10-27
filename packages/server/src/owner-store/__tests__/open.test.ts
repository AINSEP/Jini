import Database from "better-sqlite3";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { sql } from "kysely";
import { afterEach, expect, test, vi } from "vitest";
import { sourceChecksum } from "@jini-ai/db/migrate";
import { ownerRevocationsDdl, ownerRevocationsMigration, ownerStoreDdl, ownerStoreMigration } from "@jini-ai/db/owner-store";
import { openOwnerStore, OwnerStoreRecoveryError } from "../open.js";
import { fixture, input, target } from "./fixture.js";

const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(async () => { for (const item of fixtures.splice(0)) await item.cleanup(); });
function setup() { const item = fixture(); fixtures.push(item); return item; }

test.each(["win32", "darwin", "linux"])("rejects resolved path aliases before opening a database on %s", async platform => {
  const f = setup();
  const open = vi.fn(f.required.open);
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    await expect(openOwnerStore({ ...f.required, open, keyFilePath: relative(process.cwd(), f.required.filePath) }))
      .rejects.toThrow("Owner database and key paths must differ");
  } finally { Object.defineProperty(process, "platform", original); }
  expect(open).not.toHaveBeenCalled();
  expect(existsSync(f.required.filePath)).toBe(false);
});

test.each(["win32", "darwin"])("rejects case-only database/key aliases before creating files on %s", async platform => {
  const f = setup();
  const keyFilePath = join(f.directory, "OWNER.DB");
  const open = vi.fn(f.required.open);
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    await expect(openOwnerStore({ ...f.required, open, keyFilePath })).rejects.toThrow("Owner database and key paths must differ");
  } finally { Object.defineProperty(process, "platform", original); }
  expect(open).not.toHaveBeenCalled();
  expect(existsSync(f.required.filePath)).toBe(false);
  expect(existsSync(keyFilePath)).toBe(false);
});

test.each([
  ["linux", "OWNER.DB"], ["win32", "owner.db.key"], ["darwin", "owner.db.key"],
])("allows distinct %s paths through to the opener (%s)", async (platform, keyName) => {
  const f = setup();
  const stopped = new Error("opener reached");
  // Stop before native I/O so Linux case sensitivity is verified even on a macOS host.
  const open = vi.fn(() => { throw stopped; });
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    await expect(openOwnerStore({ ...f.required, open, keyFilePath: join(f.directory, keyName) })).rejects.toBe(stopped);
  } finally { Object.defineProperty(process, "platform", original); }
  expect(open).toHaveBeenCalledOnce();
});

test("real-file reopen keeps credentials, grants, independent ledger and WAL", async () => {
  const f = setup();
  const store = await f.open();
  const entry = await store.put(input);
  await store.grant({ entryId: entry.id, consumerId: "one" });
  expect(await store.kernel.query(sql`PRAGMA journal_mode`)).toEqual([{ journal_mode: "wal" }]);
  await f.close();
  const reopened = await f.open();
  expect(await reopened.list({})).toEqual([entry]);
  expect((await reopened.vault.get(entry))?.payload).toEqual(input.payload);
  expect(await reopened.grants({})).toEqual([{ entry_id: entry.id, consumer_id: "one", workspace_id: null, created_at: expect.any(String) }]);
  const db = new Database(f.required.filePath);
  try {
    expect(db.prepare("SELECT id, checksum FROM owner_migrations").all()).toEqual([
      { id: "0000_owner_store", checksum: ownerStoreMigration.checksum },
      { id: "0001_owner_revocations", checksum: ownerRevocationsMigration.checksum },
    ]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).toEqual([
      { name: "owner_grants" }, { name: "owner_migrations" }, { name: "owner_revocations" }, { name: "owner_unreconciled" }, { name: "secrets_vault" },
    ]);
  } finally { db.close(); }
});

test("concurrent openers share one key and apply the migration exactly once", async () => {
  const f = setup();
  const [a, b] = await Promise.all([f.open(), f.open()]);
  const entry = await a.put(input);
  expect((await b.vault.get(entry))?.payload).toEqual(input.payload);
  expect(await a.kernel.query(sql`SELECT count(*) AS count FROM owner_migrations`)).toEqual([{ count: 2 }]);
  expect(readFileSync(f.required.keyFilePath, "utf8")).toMatch(/^[0-9a-f]{64}$/);
  if (process.platform !== "win32") expect(statSync(f.required.keyFilePath).mode & 0o777).toBe(0o600);
});

test("P2 legacy: upgrading a store whose grants predate destination binding marks those entries unreconciled", async () => {
  const f = setup();
  const store = await f.open();
  const granted = await store.put(input);
  const ungranted = await store.put({ ...input, label: "Never granted" });
  await store.grant({ entryId: granted.id, consumerId: "one" });
  await f.close();
  // Roll the file back to the published 0000-only shape, then let open apply 0001 for real.
  const db = new Database(f.required.filePath);
  try {
    db.exec("DROP TABLE owner_unreconciled; DROP TABLE owner_revocations; ALTER TABLE owner_grants DROP COLUMN workspace_id;"
      + " DELETE FROM owner_migrations WHERE id = '0001_owner_revocations';");
  } finally { db.close(); }
  const upgraded = await f.open();
  await upgraded.revoke({ entryId: granted.id, target: target("one") });
  await expect(upgraded.delete({ entryId: granted.id, expectedRevision: granted.revision })).rejects.toMatchObject({ name: "OwnerUnreconciledError" });
  expect(await upgraded.delete({ entryId: ungranted.id, expectedRevision: ungranted.revision })).toBe(true);
});

test("each migration checksum pins its exact DDL", () => {
  expect(sourceChecksum(ownerStoreDdl)).toBe(ownerStoreMigration.checksum);
  expect(sourceChecksum(ownerRevocationsDdl)).toBe(ownerRevocationsMigration.checksum);
});

test.each(["checksum", "newer"])("refuses %s migration history without changing data", async mode => {
  const f = setup();
  const store = await f.open();
  const entry = await store.put(input);
  if (mode === "checksum") await store.kernel.execute(sql`UPDATE owner_migrations SET checksum = ${"0".repeat(64)}`);
  else await store.kernel.execute(sql`INSERT INTO owner_migrations VALUES ('9999_future', ${"0".repeat(64)}, 'now')`);
  await f.close();
  await expect(f.open()).rejects.toThrow(mode === "checksum" ? /checksum/ : /newer owner store/);
  const db = new Database(f.required.filePath);
  try { expect(db.prepare("SELECT id FROM secrets_vault").all()).toEqual([{ id: entry.id }]); }
  finally { db.close(); }
});

test.each(["missing", "invalid", "different"])("%s owner key produces recovery guidance and never replaces it", async mode => {
  const f = setup();
  const store = await f.open();
  await store.put(input);
  await f.close();
  if (mode === "missing") unlinkSync(f.required.keyFilePath);
  else writeFileSync(f.required.keyFilePath, mode === "invalid" ? "invalid" : "55".repeat(32));
  await expect(f.open()).rejects.toBeInstanceOf(OwnerStoreRecoveryError);
  if (mode === "missing") expect(existsSync(f.required.keyFilePath)).toBe(false);
  else expect(readFileSync(f.required.keyFilePath, "utf8")).toBe(mode === "invalid" ? "invalid" : "55".repeat(32));
});

test("metadata-only entries also forbid regenerating a missing key", async () => {
  const f = setup();
  const store = await f.open();
  await store.put({ ...input, payload: null });
  await f.close();
  unlinkSync(f.required.keyFilePath);
  await expect(f.open()).rejects.toBeInstanceOf(OwnerStoreRecoveryError);
  expect(existsSync(f.required.keyFilePath)).toBe(false);
});
