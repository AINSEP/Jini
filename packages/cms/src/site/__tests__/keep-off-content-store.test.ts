import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { openMemorySqliteKernel, sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { contentStore } from "../keep-off-content-store.js";

it("reads published HTML and drafts only the selected imported page", async () => {
  const db = sqliteKernel({ source: new Database(":memory:") });
  try {
    await db.execute(sql`CREATE TABLE posts(id TEXT, title TEXT, body_html TEXT, body_format TEXT, status TEXT)`);
    await db.execute(sql`INSERT INTO posts VALUES('html','HTML','<script>1</script>','html','published'),('doc','Doc',NULL,'doc','published')`);
    const store = contentStore({ db: db as unknown as Parameters<typeof contentStore>[0]["db"] });
    expect(await store.publishedHtmlPages()).toEqual([{ id: "html", title: "HTML", bodyHtml: "<script>1</script>" }]);
    await store.draftPage({ id: "html" });
    expect(await db.query(sql`SELECT id,status FROM posts ORDER BY id`)).toEqual([{ id: "doc", status: "published" }, { id: "html", status: "draft" }]);
  } finally { await db.close(); }
});

it("reassigns only the active theme rows matching the retired theme", async () => {
  const db = openMemorySqliteKernel({ open: () => new Database(":memory:") });
  try {
    await db.execute(sql`CREATE TABLE presentation_settings(active_theme_id TEXT)`);
    await db.execute(sql`INSERT INTO presentation_settings VALUES('retired'),('untouched'),('retired')`);
    const store = contentStore({ db: db as unknown as Parameters<typeof contentStore>[0]["db"] });
    expect((await store.activeThemeIds()).sort()).toEqual(["retired", "retired", "untouched"]);
    await store.reassignActiveTheme({ from: "retired", to: "enabled" });
    expect((await store.activeThemeIds()).sort()).toEqual(["enabled", "enabled", "untouched"]);
  } finally { await db.close(); }
});

it("reads and rewrites one menu's document without affecting other menu identities", async () => {
  const db = openMemorySqliteKernel({ open: () => new Database(":memory:") });
  try {
    await db.execute(sql`CREATE TABLE menus(id TEXT, title TEXT, doc_json TEXT)`);
    await db.execute(sql`INSERT INTO menus VALUES('main','Main','["legacy"]'),('footer','Footer','["legal"]')`);
    const store = contentStore({ db: db as unknown as Parameters<typeof contentStore>[0]["db"] });
    expect((await store.menus()).find(menu => menu.id === "main")).toEqual({ id: "main", title: "Main", docJson: '["legacy"]' });
    await store.setMenuDoc({ id: "main", docJson: '["replacement"]' });
    expect((await store.menus()).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "footer", title: "Footer", docJson: '["legal"]' }, { id: "main", title: "Main", docJson: '["replacement"]' },
    ]);
  } finally { await db.close(); }
});

it("reads form fields and disables only the selected form, then closes its database", async () => {
  const source = new Database(":memory:");
  const db = openMemorySqliteKernel({ open: () => source });
  const store = contentStore({ db: db as unknown as Parameters<typeof contentStore>[0]["db"] });
  try {
    await db.execute(sql`CREATE TABLE form_definitions(id TEXT, name TEXT, fields_json TEXT, status TEXT)`);
    await db.execute(sql`INSERT INTO form_definitions VALUES('lead','Lead','["email"]','published'),('vote','Vote','["choice"]','published')`);
    expect((await store.forms()).find(form => form.id === "lead")).toEqual({ id: "lead", name: "Lead", fieldsJson: '["email"]' });
    await store.disableForm({ id: "lead" });
    expect(await db.query(sql`SELECT id,status FROM form_definitions ORDER BY id`)).toEqual([{ id: "lead", status: "disabled" }, { id: "vote", status: "published" }]);
  } finally { await store.close(); }
  expect(source.open).toBe(false);
});
