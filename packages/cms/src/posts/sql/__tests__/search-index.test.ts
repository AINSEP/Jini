import { PGlite } from "@electric-sql/pglite";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { expect, test } from "vitest";
import { openPgliteKernel } from "@jini-ai/db/kernel/pglite";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import {
  backfillPostSearchIndex, postSearchFor, postSearchIndexFor, preparePostSearchIndex,
} from "../search-index.js";
import { toPostSearchHit, type PostSearchKernel } from "../search-index.contract.js";

const config = { searchConfig: "simple", projectionVersionSettingId: "cms.test.post-search" };
const time = "2026-11-26T00:00:00Z";
const query = { workspaceId: "site", terms: ["cafe", "pear"], limit: 10 };

async function schema(kernel: PostSearchKernel) {
  const execute = (statement: ReturnType<typeof sql>) => kernel.run(db => statement.execute(db));
  const bodyType = kernel.dialect === "sqlite" ? sql`TEXT` : sql`JSONB`;
  const vector = kernel.dialect === "sqlite" ? sql`` : sql`, search TSVECTOR`;
  await execute(sql`CREATE TABLE posts (id TEXT PRIMARY KEY, workspace_id TEXT, kind TEXT, status TEXT,
    deleted_at TEXT, updated_at TEXT, title TEXT, slug TEXT, body_format TEXT, body_html TEXT, body_json ${bodyType})`);
  await execute(sql`CREATE TABLE post_search_document (post_id TEXT PRIMARY KEY, title TEXT, slug TEXT, body_text TEXT ${vector})`);
  await execute(sql`CREATE TABLE setting_values_global (setting_id TEXT PRIMARY KEY, value_json ${bodyType},
    state TEXT, def_version INTEGER, seq INTEGER, updated_by TEXT, updated_at TEXT, origin_plugin_id TEXT)`);
  if (kernel.dialect === "sqlite") {
    await execute(sql`CREATE VIRTUAL TABLE post_search_fts USING fts5(title, slug, body_text, content='post_search_document')`);
    await execute(sql`CREATE TRIGGER search_insert AFTER INSERT ON post_search_document BEGIN
      INSERT INTO post_search_fts(rowid,title,slug,body_text) VALUES(new.rowid,new.title,new.slug,new.body_text); END`);
    await execute(sql`CREATE TRIGGER search_delete AFTER DELETE ON post_search_document BEGIN
      INSERT INTO post_search_fts(post_search_fts,rowid,title,slug,body_text)
      VALUES('delete',old.rowid,old.title,old.slug,old.body_text); END`);
    await execute(sql`CREATE TRIGGER search_update AFTER UPDATE ON post_search_document BEGIN
      INSERT INTO post_search_fts(post_search_fts,rowid,title,slug,body_text)
      VALUES('delete',old.rowid,old.title,old.slug,old.body_text);
      INSERT INTO post_search_fts(rowid,title,slug,body_text) VALUES(new.rowid,new.title,new.slug,new.body_text); END`);
  }
  return execute;
}

async function verifyDialect(kernel: PostSearchKernel) {
  const execute = await schema(kernel);
  // Both query terms occur in the same number of indexed documents (the excluded rows carry both,
  // the filler rows neither), so SQLite's bm25 IDF is equal for them and the title > body column
  // weighting alone decides that the title hit outranks the body hit — as Postgres' ts_rank does.
  const both = { title: "Café", bodyText: "Harvest the pear fruit." };
  const filler = { title: "Notebook", bodyText: "Plain filler text." };
  for (const [id, workspace, kind, status, deleted, text] of [
    ["cafe", "site", "post", "published", null, { title: "Café", bodyText: "Serve the coffee warm." }],
    ["pear", "site", "page", "draft", null, { title: "Orchard", bodyText: "Harvest the pear fruit." }],
    ["other", "elsewhere", "post", "published", null, both],
    ["trash", "site", "post", "published", time, both],
    ["template", "site", "email-template", "published", null, both],
    ...[1, 2, 3, 4, 5, 6].map(n => [`filler-${n}`, "site", "post", "draft", null, filler] as const),
  ] as const) {
    await execute(sql`INSERT INTO posts VALUES (${id},${workspace},${kind},${status},${deleted},${time},
      ${id}, ${id + "-slug"}, 'doc', NULL, NULL)`);
    await postSearchFor(kernel, config).upsert({ kernel, document: { postId: id, slug: id + "-slug", ...text } });
  }

  const index = postSearchIndexFor({ kernel, config });
  const hits = await index.search(query);
  expect(hits.map(({ id }) => id)).toEqual(["cafe", "pear"]);
  expect(hits[0]).toMatchObject({
    id: "cafe", kind: "post", title: "cafe", slug: "cafe-slug", status: "published",
    updatedAt: time, snippet: "Serve the coffee warm.",
  });
  expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  expect(hits[1]!.score).toBeGreaterThan(0);
  expect((await index.search({ ...query, limit: 1 })).map(({ id }) => id)).toEqual(["cafe"]);
  expect((await index.search({ ...query, kind: "page" })).map(({ id }) => id)).toEqual(["pear"]);
  expect((await index.search({ ...query, status: "published" })).map(({ id }) => id)).toEqual(["cafe"]);
  await execute(sql`UPDATE posts SET status = 'published' WHERE id = 'pear'`);
  expect((await index.search({ ...query, kind: "page", status: "published" })).map(({ id }) => id)).toEqual(["pear"]);

  await postSearchFor(kernel, config).upsert({ kernel, document: {
    postId: "cafe", title: "Orange", slug: "orange", bodyText: "Orange zest.",
  } });
  expect((await index.search(query)).map(({ id }) => id)).toEqual(["pear"]);
  expect((await index.search({ ...query, terms: ["orange"] })).map(({ id }) => id)).toEqual(["cafe"]);
  await postSearchFor(kernel, config).remove({ kernel, postId: "pear" });
  expect(await index.search(query)).toEqual([]);
  if (kernel.dialect === "postgres") {
    expect(await index.search({ ...query, terms: ["\u0301"] })).toEqual([]);
  }
}

test("SQLite FTS ranks, filters live rows, and reflects projection upsert and removal", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  try { await verifyDialect(kernel); }
  finally { await kernel.close(); }
});

test("Postgres vectors rank, filter live rows, and reflect projection upsert and removal", { timeout: 20_000 }, async () => {
  const kernel = openPgliteKernel<unknown>({ PGlite }, {});
  try {
    await verifyDialect(kernel);
    const doc = JSON.stringify({ type: "text", text: "Legacy plain text" });
    await kernel.execute(sql`UPDATE posts SET body_json = ${doc}::jsonb WHERE id = 'cafe'`);
    expect(await preparePostSearchIndex({ kernel, config }, { batchSize: 2 })).toEqual({ reindexed: 11, backfilled: 0 }); // every posts row: 5 named + 6 filler
    expect((await postSearchIndexFor({ kernel, config }).search({ ...query, terms: ["legacy"] })).map(({ id }) => id)).toEqual(["cafe"]);
  } finally { await kernel.close(); }
});

test("boot repairs stale and malformed projections in batches before filling warm-site gaps", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  try {
    const execute = await schema(kernel);
    await execute(sql`INSERT INTO posts VALUES
      ('a','site','page','published',NULL,${time},'Article','article','html','<p>Tamarind chutney</p>','{}'),
      ('b','site','post','draft',NULL,${time},'Damaged','damaged',NULL,NULL,'not JSON'),
      ('c','site','post','draft',NULL,${time},'Legacy','legacy','doc',NULL,'{"type":"text","text":"Mulberry jam"}')`);
    await postSearchFor(kernel, config).upsert({ kernel, document: {
      postId: "a", title: "Article", slug: "article", bodyText: "obsolete",
    } });
    await execute(sql`INSERT INTO setting_values_global (setting_id,value_json) VALUES (${config.projectionVersionSettingId}, 'invalid json')`);
    expect(await preparePostSearchIndex({ kernel, config }, { batchSize: 1 })).toEqual({ reindexed: 3, backfilled: 0 });
    expect(await kernel.query(sql`SELECT post_id, body_text FROM post_search_document ORDER BY post_id`)).toEqual([
      { post_id: "a", body_text: "Tamarind chutney" },
      { post_id: "b", body_text: "" },
      { post_id: "c", body_text: "Mulberry jam" },
    ]);
    expect(await kernel.query(sql`SELECT setting_id, value_json, updated_by FROM setting_values_global`)).toEqual([
      { setting_id: "cms.test.post-search", value_json: "2", updated_by: "system:post-search-reindex" },
    ]);
    await postSearchFor(kernel, config).remove({ kernel, postId: "c" });
    expect(await preparePostSearchIndex({ kernel, config })).toEqual({ reindexed: 0, backfilled: 1 });
    expect(await backfillPostSearchIndex({ kernel, config })).toBe(0);
    expect((await postSearchIndexFor({ kernel, config }).search({ ...query, terms: ["mulberry"] })).map(({ id }) => id)).toEqual(["c"]);
  } finally { await kernel.close(); }
});

test("search waits until the boot projection is ready", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  let resolve!: () => void;
  const ready = new Promise<void>(done => { resolve = done; });
  try {
    const pending = postSearchIndexFor({ kernel, config }, { ready }).search(query);
    // Attach the observer immediately in case a regression searches the not-yet-created tables.
    const outcome = pending.then(hits => ({ hits }), (error: unknown) => ({ error }));
    const execute = await schema(kernel);
    await execute(sql`INSERT INTO posts VALUES ('pear','site','post','draft',NULL,${time},'Pear','fruit','doc',NULL,NULL)`);
    await backfillPostSearchIndex({ kernel, config });
    resolve();
    const result = await outcome;
    expect(result).toMatchObject({ hits: [{ id: "pear", title: "Pear" }] });
  } finally { resolve(); await kernel.close(); }
});

test("search hit projection normalizes the driver's score and renames the timestamp", () => {
  // Some drivers expose decimal SQL values as strings despite the SQL row's numeric type.
  const driverScore = "0.25" as unknown as number;
  expect(toPostSearchHit({ id: "page", kind: "page", title: "Archive", slug: "archive", status: "draft",
    updated_at: time, snippet: "Find older posts.", score: driverScore }))
    .toEqual({ id: "page", kind: "page", title: "Archive", slug: "archive", status: "draft",
      updatedAt: time, snippet: "Find older posts.", score: 0.25 });
});
