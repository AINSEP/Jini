import Database from "better-sqlite3";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { sql } from "kysely";
import { afterEach, expect, test } from "vitest";
import { sourceChecksum } from "../../migrate/checksum.js";
import { ownerStoreDdl, ownerStoreMigration } from "../migrations/0000_owner_store.js";
import { OwnerStoreRecoveryError } from "../open.js";
import { fixture, input } from "./fixture.js";

const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(async () => { for (const item of fixtures.splice(0)) await item.cleanup(); });
function setup() { const item = fixture(); fixtures.push(item); return item; }

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
  expect(await reopened.grants({})).toEqual([{ entry_id: entry.id, consumer_id: "one", created_at: expect.any(String) }]);
  const db = new Database(f.required.filePath);
  try {
    expect(db.prepare("SELECT id, checksum FROM owner_migrations").all()).toEqual([
      { id: "0000_owner_store", checksum: ownerStoreMigration.checksum },
    ]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).toEqual([
      { name: "owner_grants" }, { name: "owner_migrations" }, { name: "secrets_vault" },
    ]);
  } finally { db.close(); }
});

test("concurrent openers share one key and apply the migration exactly once", async () => {
  const f = setup();
  const [a, b] = await Promise.all([f.open(), f.open()]);
  const entry = await a.put(input);
  expect((await b.vault.get(entry))?.payload).toEqual(input.payload);
  expect(await a.kernel.query(sql`SELECT count(*) AS count FROM owner_migrations`)).toEqual([{ count: 1 }]);
  expect(readFileSync(f.required.keyFilePath, "utf8")).toMatch(/^[0-9a-f]{64}$/);
  if (process.platform !== "win32") expect(statSync(f.required.keyFilePath).mode & 0o777).toBe(0o600);
});

test("the initial migration checksum pins the exact DDL", () => {
  expect(sourceChecksum(ownerStoreDdl)).toBe(ownerStoreMigration.checksum);
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
