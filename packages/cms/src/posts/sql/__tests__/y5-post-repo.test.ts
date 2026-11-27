import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { expect, test, vi } from "vitest";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import { postRevisionLockKey } from "@jini-ai/core/contracts/site/post-revision-lock";
import { bindPostRepoFor, SqlPostRepo } from "../repo.js";
import { sqlitePostSearch } from "../search-index.sqlite.js";
import { bindInMemoryPostRepo } from "../../repo.memory.js";
import { toRecord, toRow, toRevisionRow, toRevisionRecord } from "../repo.rows.js";
import { createMediaAccessEvidence } from "../../../media/site/access-evidence.js";
import { bindRevisionThinning, revisionThinningApprovalHandler, thinningCard } from "../revision-thinning.js";
import { createApprovalHandler, type ToolExecutionContext } from "@jini-ai/core";
import type { PostRecord } from "../../post.js";

const hashJsonText = (text: string) => createHash("sha256").update(text).digest("hex");
const nowIso = () => "2026-11-25T00:00:00.000Z";
const row: PostRecord = { id: "post", workspaceId: "site", title: "Post", slug: "post", kind: "post", status: "draft",
  bodyJson: { type: "doc", content: [] }, bodyFormat: "doc", bodyHtml: null, updatedAt: "2026-01-01T00:00:00.000Z", version: 1 };

async function fixture() {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  await kernel.execute(sql`CREATE TABLE posts (id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT, slug TEXT, body_json TEXT, status TEXT,
    kind TEXT DEFAULT 'post', body_format TEXT DEFAULT 'doc', body_html TEXT, updated_at TEXT, version INTEGER, seo_ext_json TEXT,
    ext TEXT DEFAULT '{}', deleted_at TEXT, template_choice TEXT, overrides_theme_page BOOLEAN, member_access_json TEXT, autosave_json TEXT,
    created_by_principal_id TEXT, created_at TEXT, publish_at TEXT, created_by_kind TEXT DEFAULT 'unknown', featured_media_id TEXT, author TEXT, show_author BOOLEAN DEFAULT 0)`);
  await kernel.execute(sql`CREATE TABLE post_revisions (id TEXT PRIMARY KEY, post_id TEXT, workspace_id TEXT, seq INTEGER, op TEXT,
    state_json TEXT, content_hash TEXT, actor_id TEXT, delegated_by_workspace_id TEXT, delegated_by_id TEXT, restored_from TEXT, recorded_at TEXT, actor_kind TEXT)`);
  await kernel.execute(sql`CREATE TABLE agent_pause_holds (workspace_id TEXT, held_since TEXT)`);
  const search = { upsert: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
  const repo = new SqlPostRepo({ kernel, search, mediaAccessEvidence: createMediaAccessEvidence(), nowIso, newId: randomUUID, hashJsonText, postRevisionLockKey });
  const InMemoryPostRepo = bindInMemoryPostRepo({ nowIso, newId: randomUUID, hashJsonText, createEvidence: createMediaAccessEvidence });
  const heldSince = vi.fn(async (): Promise<string | null> => null);
  return { kernel, repo, search, heldSince, memory: new InMemoryPostRepo({}, { agentHold: { heldSince } }) };
}

test("row codecs preserve absent ext, nullable theme override, scheduling and actor-kind writes", () => {
  const stored = toRow({ record: row });
  expect(stored).toMatchObject({ ext: "{}", overrides_theme_page: null, publish_at: null });
  const decoded = toRecord({ row: { ...stored, kind: "post", body_format: "doc", ext: "{}", created_by_kind: "unknown", show_author: 0, autosave_json: null } as Parameters<typeof toRecord>[0]["row"] });
  expect(decoded).not.toHaveProperty("ext");
  expect(decoded).not.toHaveProperty("publishAt");
  expect(decoded.overridesThemePage).toBeNull();
  expect(toRow({ record: { ...row, overridesThemePage: false } }).overrides_theme_page).toBe(false);
  const input = { workspaceId: "site", postId: "post", seq: 1, op: "create" as const, stateJson: row, actorId: "human", actorKind: "agent" as const, recordedAt: row.updatedAt };
  const revision = toRevisionRow({ input, id: "revision", hashJsonText });
  expect(revision.state_json).toBe(JSON.stringify(row));
  expect(revision.content_hash).toBe(hashJsonText(revision.state_json));
  expect(revision.actor_kind).toBe("agent");
  expect(toRevisionRecord({ row: { ...revision, actor_kind: "agent" } as Parameters<typeof toRevisionRecord>[0]["row"] }).stateJson).toEqual(row);
});

test("memory and SQL agree on saved rows, stable HTML keysets and revision/autosave CAS", async () => {
  const f = await fixture();
  try {
    for (const repo of [f.repo, f.memory]) {
      for (const id of ["c", "a", "b"]) await repo.save({ ...row, id, slug: id, bodyFormat: "html", bodyHtml: "<p>Body</p>" });
      expect((await repo.listHtmlByKind({ workspaceId: "site", kind: "post", limit: 2 })).map(post => post.id)).toEqual(["a", "b"]);
      expect((await repo.listHtmlByKind({ workspaceId: "site", kind: "post", limit: 2, before: { updatedAt: row.updatedAt, id: "b" } })).map(post => post.id)).toEqual(["c"]);
      expect(await repo.saveIfVersion({ record: { ...row, id: "a", version: 2 }, ifVersion: 3 })).toEqual({ applied: false });
      expect(await repo.writeAutosave({ workspaceId: "site", id: "a", snapshot: { baseVersion: 2 } as never })).toEqual({ applied: false });
      expect(await repo.readAutosave({ workspaceId: "site", id: "a" })).toBeNull();
      const snapshot = { baseVersion: 1, bodyFormat: "html" as const, bodyHtml: "<p>Autosave</p>", title: "Draft", slug: "a", savedAt: nowIso(), savedByPrincipalId: "human" };
      expect(await repo.writeAutosave({ workspaceId: "site", id: "a", snapshot })).toEqual({ applied: true });
      expect(await repo.readAutosave({ workspaceId: "site", id: "a" })).toEqual(snapshot);
      expect(await repo.saveIfVersion({ record: { ...row, id: "a", slug: "a", version: 2 }, ifVersion: 1 })).toEqual({ applied: true });
      expect((await repo.findById({ workspaceId: "site", id: "a" }))?.version).toBe(2);
    }
    expect((await f.repo.findById({ workspaceId: "site", id: "a" }))?.bodyHtml).toBe((await f.memory.findById({ workspaceId: "site", id: "a" }))?.bodyHtml);
  } finally { await f.kernel.close(); }
});

test("held agent schedules are absent from both bounded public reads, and null schedules remain visible", async () => {
  const f = await fixture();
  try {
    await f.kernel.execute(sql`INSERT INTO agent_pause_holds VALUES ('site','2026-02-01T00:00:00.000Z')`);
    f.heldSince.mockResolvedValue("2026-02-01T00:00:00.000Z");
    for (const record of [
      { ...row, id: "held", slug: "held", status: "published" as const, createdByKind: "agent" as const, publishAt: "2026-03-01T00:00:00.000Z" },
      { ...row, id: "owner", slug: "owner", status: "published" as const, createdByKind: "person" as const, publishAt: "2026-03-01T00:00:00.000Z" },
      { ...row, id: "unscheduled", slug: "unscheduled", status: "published" as const, createdByKind: "agent" as const },
    ]) { await f.repo.save(record); await f.memory.save(record); }
    expect((await f.repo.listPublishedPreviews({ workspaceId: "site", limit: 10 })).map(post => post.id)).toEqual(["owner", "unscheduled"]);
    expect((await f.memory.listPublishedPreviews({ workspaceId: "site", limit: 10 })).map(post => post.id)).toEqual(["owner", "unscheduled"]);
    expect((await f.repo.listGoLiveCandidates({ workspaceId: "site", nowIso: nowIso() })).map(post => post.id)).toEqual(["owner"]);
    expect((await f.memory.listGoLiveCandidates({ workspaceId: "site", nowIso: nowIso() })).map(post => post.id)).toEqual(["owner"]);
  } finally { await f.kernel.close(); }
});

test("a projection failure rolls back the row and revision append locks before its latest-row read", async () => {
  const f = await fixture();
  try {
    f.search.upsert.mockRejectedValueOnce(new Error("projection failed"));
    await expect(f.repo.save(row)).rejects.toThrow("projection failed");
    expect(await f.repo.findById({ workspaceId: "site", id: "post" })).toBeNull();
    const lock = vi.spyOn(f.kernel, "lockKey");
    const first = await f.repo.appendRevision({ workspaceId: "site", postId: "post", seq: 1, op: "create", stateJson: row, actorId: "human", recordedAt: row.updatedAt });
    const second = await f.repo.appendRevision({ workspaceId: "site", postId: "post", seq: 2, op: "update", stateJson: { ...row, version: 2 }, actorId: "human", recordedAt: row.updatedAt });
    expect(lock).toHaveBeenNthCalledWith(1, "post_revisions:site:post");
    expect(second.previousId).toBe(first.id);
    expect((await f.repo.listRevisions({ workspaceId: "site", postId: "post" })).map(revision => revision.seq)).toEqual([1, 2]);
  } finally { await f.kernel.close(); }
});

test("the bound repo erases once and writes rows and search through the same transaction", async () => {
  const f = await fixture();
  const upsert = sqlitePostSearch.upsert;
  const projection = vi.spyOn(sqlitePostSearch, "upsert");
  try {
    await f.kernel.execute(sql`CREATE TABLE post_search_document (post_id TEXT PRIMARY KEY, title TEXT, slug TEXT, body_text TEXT)`);
    const rawKernel = { database: f.kernel };
    const eraseKernel = vi.fn(({ store }: { store: typeof rawKernel }) => store.database);
    const postRepoFor = bindPostRepoFor({ eraseKernel, searchHost: { searchConfig: "simple", projectionVersionSettingId: "projection" },
      nowIso, newId: randomUUID, hashJsonText, postRevisionLockKey }, {});
    const first = postRepoFor({ kernel: rawKernel, mediaAccessEvidence: createMediaAccessEvidence() }, {});
    const second = postRepoFor({ kernel: rawKernel, mediaAccessEvidence: createMediaAccessEvidence() }, {});
    expect(eraseKernel.mock.calls).toEqual([[{ store: rawKernel }, {}], [{ store: rawKernel }, {}]]);
    await first.save(row);
    expect(projection.mock.calls[0]![0].kernel).toBe(f.kernel);
    expect(await f.kernel.query(sql`SELECT post_id, title FROM post_search_document`)).toEqual([{ post_id: "post", title: "Post" }]);
    projection.mockImplementationOnce(async required => {
      expect(required.kernel).toBe(f.kernel);
      expect((await second.findById({ workspaceId: "site", id: "failed" }))?.title).toBe("Failed");
      await upsert(required);
      throw new Error("projection failed");
    });
    await expect(second.save({ ...row, id: "failed", slug: "failed", title: "Failed" })).rejects.toThrow("projection failed");
    expect(await second.findById({ workspaceId: "site", id: "failed" })).toBeNull();
    expect(await f.kernel.query(sql`SELECT post_id, title FROM post_search_document`)).toEqual([{ post_id: "post", title: "Post" }]);
    expect(eraseKernel).toHaveBeenCalledTimes(2);
  } finally {
    projection.mockRestore();
    await f.kernel.close();
  }
});

test("protected revisions survive thinning and expired preview tokens refuse deletion", async () => {
  const f = await fixture();
  try {
    for (const seq of [1, 2]) await f.repo.appendRevision({ workspaceId: "site", postId: "post", seq, op: "update", stateJson: row, actorId: "human", recordedAt: row.updatedAt });
    let payload: Record<string, unknown> | null = null;
    const binding = bindRevisionThinning({ kernel: f.kernel, postRevisionLockKey, clock: () => Date.parse(nowIso()), authorize: async () => {},
      publishedRefs: async () => true, restoreRefs: async () => false, undoRefs: async () => false,
      previewStore: { put: input => { payload = input.payload; return { token: "preview", deadline: 100 }; }, take: () => { const taken = payload; payload = null; return taken ? { payload: taken, deadline: 100 } : null; } } });
    const scope = { workspaceId: "site", postId: "post", kind: "post" };
    const preview = await binding.preview({ principal: "owner", scope, before: "2026-06-01" });
    expect(await binding.apply({ principal: "owner", scope, previewToken: preview.previewToken, confirm: true })).toMatchObject({ deleted: [], kept: [{ reason: "isPublished" }] });
    payload = null;
    await expect(binding.apply({ principal: "owner", scope, previewToken: "expired", confirm: true })).rejects.toThrow();
    expect(await f.repo.listRevisions({ workspaceId: "site", postId: "post" })).toHaveLength(2);
  } finally { await f.kernel.close(); }
});

test("thinning approval decline never applies and the card keeps its exact warning", async () => {
  const binding = { preview: vi.fn(async () => ({ ids: ["old"], count: 1, previewToken: "preview" })), apply: vi.fn() };
  const handler = revisionThinningApprovalHandler({ binding, workspaceId: "site", surfaces: { surfaceExchanges: {} as never }, thinningCard,
    approvalToolHandler: (required, optional) => createApprovalHandler({ prepare: required.prepare,
      describe: ({ ctx, prepared }) => ({ ask: optional.ask({ prepared }), description: required.describe({ ctx, prepared }) }),
      askHuman: async () => ({ confirmed: false, reason: "declined" }), run: required.run, notConfirmed: () => ({ thinned: false }) }) });
  const ctx: ToolExecutionContext = { executionId: "e", run: { id: "run" }, principal: { id: "owner" }, signal: new AbortController().signal, input: { postId: "post", kind: "post", before: "2026-06-01" } };
  expect(await handler(ctx)).toEqual({ thinned: false });
  expect(binding.apply).not.toHaveBeenCalled();
  expect(thinningCard({ prepared: { scope: { workspaceId: "site", postId: "post", kind: "post" }, count: 1, previewToken: "preview" } })).toEqual({
    toolId: "post_thin_revisions", errorCode: "POST", title: "Delete up to 1 old revision of this post?", details: [{ label: "Revisions in preview", value: "1" }],
    warning: "This cannot be undone. The newest revision and any revision that is published, restorable or needed for undo is kept, and thinning stops there.", confirmLabel: "Delete old revisions" });
});

test("SQL list and slug lookup keep a soft-deleted row scoped and reserve its address", async () => {
  const f = await fixture();
  try {
    const other = { ...row, id: "other", workspaceId: "other", title: "Other site" };
    await f.repo.save(other);
    await f.repo.save(row);
    expect(await f.repo.findBySlug({ workspaceId: "site", slug: "missing" })).toBeNull();
    await f.repo.softDelete({ workspaceId: "site", id: "post", deletedAt: nowIso(), updatedAt: nowIso(), version: 2 });
    expect(await f.repo.findBySlug({ workspaceId: "site", slug: "post" })).toMatchObject({
      id: "post", workspaceId: "site", title: "Post", deletedAt: nowIso(), updatedAt: nowIso(), version: 2,
    });
    expect((await f.repo.list({ workspaceId: "site" })).map(post => [post.id, post.deletedAt])).toEqual([["post", nowIso()]]);
    expect(await f.repo.findBySlug({ workspaceId: "other", slug: "post" })).toMatchObject({
      id: "other", workspaceId: "other", title: "Other site", deletedAt: null, version: 1,
    });
    expect(f.search.remove).not.toHaveBeenCalled();
  } finally { await f.kernel.close(); }
});

test("SQL hard delete removes only the scoped row, revision history and search projection", async () => {
  const f = await fixture();
  try {
    await f.repo.save(row);
    await f.repo.appendRevision({ workspaceId: "site", postId: "post", seq: 1, op: "create", stateJson: row, actorId: "human", recordedAt: row.updatedAt });
    const snapshot = { baseVersion: 1, bodyFormat: "doc" as const, bodyJson: row.bodyJson,
      title: "Waiting", slug: row.slug, savedAt: nowIso(), savedByPrincipalId: "human" };
    expect(await f.repo.writeAutosave({ workspaceId: "site", id: "post", snapshot })).toEqual({ applied: true });
    await f.repo.clearAutosave({ workspaceId: "other", id: "post" });
    expect(await f.repo.readAutosave({ workspaceId: "site", id: "post" })).toEqual(snapshot);
    await f.repo.clearAutosave({ workspaceId: "site", id: "post" });
    expect(await f.repo.readAutosave({ workspaceId: "site", id: "post" })).toBeNull();
    await f.repo.writeAutosave({ workspaceId: "site", id: "post", snapshot });
    await f.repo.hardDelete({ workspaceId: "other", id: "post" });
    expect(f.search.remove).not.toHaveBeenCalled();
    expect(await f.repo.readAutosave({ workspaceId: "site", id: "post" })).toEqual(snapshot);
    expect(await f.repo.listRevisions({ workspaceId: "site", postId: "post" })).toMatchObject([{ seq: 1, stateJson: row }]);
    await f.repo.hardDelete({ workspaceId: "site", id: "post" });
    expect(await f.repo.findById({ workspaceId: "site", id: "post" })).toBeNull();
    expect(await f.repo.readAutosave({ workspaceId: "site", id: "post" })).toBeNull();
    expect(await f.repo.listRevisions({ workspaceId: "site", postId: "post" })).toEqual([]);
    expect(f.search.remove.mock.calls).toEqual([[{ kernel: f.kernel, postId: "post" }]]);
  } finally { await f.kernel.close(); }
});

test("SQL repo caller transaction rolls back prior post and revision writes when a later step fails", async () => {
  const f = await fixture();
  try {
    const failed = new Error("event storage failed");
    await expect(f.repo.transaction({ fn: async () => {
      await f.repo.save(row);
      await f.repo.appendRevision({ workspaceId: "site", postId: "post", seq: 1, op: "create", stateJson: row, actorId: "human", recordedAt: row.updatedAt });
      expect((await f.repo.findById({ workspaceId: "site", id: "post" }))?.title).toBe("Post");
      throw failed;
    } })).rejects.toBe(failed);
    expect(await f.repo.findById({ workspaceId: "site", id: "post" })).toBeNull();
    expect(await f.repo.listRevisions({ workspaceId: "site", postId: "post" })).toEqual([]);
    expect(await f.repo.transaction({ fn: async () => {
      await f.repo.save(row);
      return "written";
    } })).toBe("written");
    expect((await f.repo.findById({ workspaceId: "site", id: "post" }))?.version).toBe(1);
  } finally { await f.kernel.close(); }
});

test("legacy HTML SQL rows carry a doc placeholder without losing explicit presentation or plugin fields", () => {
  const stored = toRow({ record: { ...row, kind: "page", bodyFormat: "html", bodyHtml: "<main>Authored page</main>",
    ext: { publishing: { classification: "staff" } }, templateChoice: "", overridesThemePage: false,
    featuredMediaId: "cover", author: "Editor", showAuthor: true, publishAt: "2027-01-01T00:00:00.000Z",
    createdByPrincipalId: "author-7", createdByKind: "agent", createdAt: row.updatedAt } });
  const decoded = toRecord({ row: { ...stored, body_json: null, autosave_json: null, show_author: 1,
    overrides_theme_page: 0 } as Parameters<typeof toRecord>[0]["row"] });
  expect(decoded).toMatchObject({
    id: "post", kind: "page", bodyFormat: "html", bodyHtml: "<main>Authored page</main>", bodyJson: { type: "doc", content: [] },
    ext: { publishing: { classification: "staff" } }, templateChoice: "", overridesThemePage: false,
    author: "Editor", showAuthor: true, featuredMediaId: "cover", publishAt: "2027-01-01T00:00:00.000Z",
    createdByPrincipalId: "author-7", createdByKind: "agent", createdAt: row.updatedAt,
  });
});
