import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
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
