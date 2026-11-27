import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createKeyAttachments, type AttachmentPolicy, type AttachmentSqlPort } from "../sql/attachments.js";

const policy: AttachmentPolicy = { ownerWorkspaceId: "owner", customKind: "custom", vendorKind: "vendor", vendorCredentialType: "custom", maxGrants: 2, tooManyKeys: "over cap", ambiguousLabel: "duplicate", noSiteId: "no site" };
let db: Kysely<unknown>;
let attachments: ReturnType<typeof createKeyAttachments>;
beforeEach(async () => {
  db = new Kysely({ dialect: new SqliteDialect({ database: new Database(":memory:") }) });
  await sql`CREATE TABLE vault (id TEXT PRIMARY KEY, workspace_id TEXT, kind TEXT, label TEXT, meta TEXT)`.execute(db);
  await sql`CREATE TABLE grants (site_id TEXT, key_id TEXT, site_name TEXT, attached_at TEXT, PRIMARY KEY(site_id, key_id))`.execute(db);
  const port: AttachmentSqlPort = {
    dialect: "sqlite",
    query: async <Row>(statement: Parameters<AttachmentSqlPort["query"]>[0]) => (await db.executeQuery<Row>(statement.compile(db))).rows,
    execute: async statement => { await statement.execute(db); },
  };
  attachments = createKeyAttachments({ sql: port, tables: { attachments: "grants", vault: "vault" }, nowIso: () => "now", policy,
    credentialTypeText: ({ column }) => sql<string | null>`json_extract(${column}, '$.credentialType')`,
  });
});
afterEach(async () => { await db.destroy(); });

it("a detached key stops matching its worksFor label on the next lookup", async () => {
  await sql`INSERT INTO vault VALUES ('key', 'owner', 'custom', 'Name', '{"worksFor":["alias"]}')`.execute(db);
  await attachments.attach({ siteId: "a", keyId: "key", siteName: "A" });
  await attachments.attach({ siteId: "a", keyId: "key", siteName: "A" });
  expect(await attachments.keyForLabel?.({ siteId: "a", label: "alias" })).toBe("key");
  expect(await attachments.keysFor({ siteId: "a" })).toEqual(["key"]);
  await attachments.detach({ siteId: "a", keyId: "key" });
  expect(await attachments.keyForLabel?.({ siteId: "a", label: "alias" })).toBeNull();
});

it("refuses duplicate labels within the bounded grant set", async () => {
  for (const id of ["one", "two"]) {
    await sql`INSERT INTO vault VALUES (${id}, 'owner', 'custom', 'Name', '{}')`.execute(db);
    await attachments.attach({ siteId: "a", keyId: id, siteName: "A" });
  }
  await expect(attachments.keyForLabel?.({ siteId: "a", label: "Name" })).rejects.toThrow("duplicate");
});

it("refuses over-cap grants before matching a label", async () => {
  for (const id of ["one", "two", "three"]) {
    await sql`INSERT INTO vault VALUES (${id}, 'owner', 'custom', ${id}, '{}')`.execute(db);
    await attachments.attach({ siteId: "a", keyId: id, siteName: "A" });
  }
  await expect(attachments.keyForLabel?.({ siteId: "a", label: "one" })).rejects.toThrow("over cap");
  await expect(attachments.keysFor({ siteId: "a" })).rejects.toThrow("over cap");
});

it("excludes wrong-site, wrong-owner and ineligible credential rows", async () => {
  await sql`INSERT INTO vault VALUES ('other-site', 'owner', 'custom', 'Label', '{}'), ('other-owner', 'foreign', 'custom', 'Label', '{}'), ('wrong-kind', 'owner', 'oauth', 'Label', '{}'), ('wrong-subtype', 'owner', 'vendor', 'Label', '{"credentialType":"oauth"}')`.execute(db);
  await attachments.attach({ siteId: "b", keyId: "other-site", siteName: "B" });
  for (const keyId of ["other-owner", "wrong-kind", "wrong-subtype"]) await attachments.attach({ siteId: "a", keyId, siteName: "A" });
  expect(await attachments.keyForLabel?.({ siteId: "a", label: "Label" })).toBeNull();
});


it("refuses duplicate granted worksFor aliases", async () => {
  for (const id of ["one", "two"]) {
    await sql`INSERT INTO vault VALUES (${id}, 'owner', 'custom', ${id}, '{"worksFor":["alias"]}')`.execute(db);
    await attachments.attach({ siteId: "a", keyId: id, siteName: "A" });
  }
  await expect(attachments.keyForLabel?.({ siteId: "a", label: "alias" })).rejects.toThrow("duplicate");
});

it("isAttached, usersOf, renameSite and removeKey read and write the grant rows", async () => {
  await attachments.attach({ siteId: "b", keyId: "key", siteName: "Beta" });
  await attachments.attach({ siteId: "a", keyId: "key", siteName: "Alpha" });
  await attachments.attach({ siteId: "a", keyId: "other", siteName: "Alpha" });
  expect(await attachments.isAttached({ siteId: "a", keyId: "key" })).toBe(true);
  expect(await attachments.isAttached({ siteId: "c", keyId: "key" })).toBe(false);
  expect(await attachments.isAttached({ siteId: "", keyId: "key" })).toBe(false);
  expect(await attachments.usersOf({ keyId: "key" })).toEqual([{ siteId: "a", siteName: "Alpha" }, { siteId: "b", siteName: "Beta" }]);
  await attachments.renameSite({ siteId: "a", siteName: "Zulu" });
  expect(await attachments.usersOf({ keyId: "key" })).toEqual([{ siteId: "b", siteName: "Beta" }, { siteId: "a", siteName: "Zulu" }]);
  await attachments.removeKey({ keyId: "key" });
  expect(await attachments.usersOf({ keyId: "key" })).toEqual([]);
  expect(await attachments.usersOf({ keyId: "other" })).toEqual([{ siteId: "a", siteName: "Zulu" }]);
});

it("attach without a site id is refused and writes nothing", async () => {
  await expect(attachments.attach({ siteId: "", keyId: "key", siteName: "A" })).rejects.toThrow("no site");
  expect(await attachments.usersOf({ keyId: "key" })).toEqual([]);
});

it("an empty site id has no keys and no label matches, without querying", async () => {
  await sql`INSERT INTO vault VALUES ('key', 'owner', 'custom', 'Name', '{}')`.execute(db);
  await attachments.attach({ siteId: "a", keyId: "key", siteName: "A" });
  expect(await attachments.keysFor({ siteId: "" })).toEqual([]);
  expect(await attachments.keyForLabel?.({ siteId: "", label: "Name" })).toBeNull();
  expect(await attachments.keyForLabel?.({ siteId: "a", label: "Name" })).toBe("key");
});

it("object-shaped meta (Postgres) and meta without worksFor both match by label only", async () => {
  const objectMeta: AttachmentSqlPort = {
    dialect: "sqlite",
    query: async <Row>(statement: Parameters<AttachmentSqlPort["query"]>[0]) => (await db.executeQuery<Row & { meta?: unknown }>(statement.compile(db))).rows
      .map(row => (typeof row.meta === "string" ? { ...row, meta: JSON.parse(row.meta) } : row) as Row),
    execute: async statement => { await statement.execute(db); },
  };
  const pg = createKeyAttachments({ sql: objectMeta, tables: { attachments: "grants", vault: "vault" }, nowIso: () => "now", policy,
    credentialTypeText: ({ column }) => sql<string | null>`json_extract(${column}, '$.credentialType')` });
  await sql`INSERT INTO vault VALUES ('one', 'owner', 'custom', 'One', '{"worksFor":["alias"]}'), ('two', 'owner', 'custom', 'Two', '{"worksFor":"not-a-list"}')`.execute(db);
  await pg.attach({ siteId: "a", keyId: "one", siteName: "A" });
  await pg.attach({ siteId: "a", keyId: "two", siteName: "A" });
  expect(await pg.keyForLabel?.({ siteId: "a", label: "alias" })).toBe("one");
  expect(await pg.keyForLabel?.({ siteId: "a", label: "not-a-list" })).toBeNull();
  expect(await pg.keyForLabel?.({ siteId: "a", label: "Two" })).toBe("two");
});

it("rejects table names that are not plain identifiers", () => {
  const port: AttachmentSqlPort = { dialect: "sqlite", query: async () => [], execute: async () => undefined };
  for (const tables of [{ attachments: "grants; DROP", vault: "vault" }, { attachments: "grants", vault: "1vault" }]) {
    expect(() => createKeyAttachments({ sql: port, tables, nowIso: () => "now", policy, credentialTypeText: ({ column }) => sql<string | null>`${column}` })).toThrow("Invalid attachment table identifier.");
  }
});
