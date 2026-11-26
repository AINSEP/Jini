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
