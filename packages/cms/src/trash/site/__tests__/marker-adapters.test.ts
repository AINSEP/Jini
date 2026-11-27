import { createRedirectTrashAdapter } from "../adapters/redirect.js";
import { createMemberTrashAdapter as createSqlMemberAdapter } from "../adapters/member-credential-sql.js";
import { expect, test, vi } from "vitest";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { openMemorySqliteKernel, sqliteKernel } from "@jini-ai/db/kernel/sqlite";
import type { TrashAdapter } from "../../index.js";
import { createMemberTrashAdapter } from "../adapters/member.js";
import { createPostTrashAdapter } from "../adapters/post.js";
import { createMediaTrashAdapter } from "../adapters/media.js";

const input = { workspaceId: "site", entityId: "member", at: "2026-11-25T00:00:00Z", expectedVersion: 1 };

test("member restore cannot resurrect a pre-trash credential", async () => {
  const calls: string[] = [];
  let fence = "before";
  let inside = false;
  const adapter: TrashAdapter = { entityType: "member", hide: vi.fn(), unhide: async () => { expect(inside).toBe(true); calls.push("marker"); return { ok: true, version: 3 }; }, purge: vi.fn() };
  const revokeSessions = vi.fn();
  const consumeSignInLinks = vi.fn();
  const member = createMemberTrashAdapter({ adapter, transaction: async ({ run }) => { inside = true; try { return await run(); } finally { inside = false; } },
    advanceCredentialFence: async required => { expect(inside).toBe(true); calls.push("fence"); fence = required.at; }, revokeSessions, consumeSignInLinks });
  await member.unhide(input);
  expect(fence).toBe(input.at);
  expect(calls).toEqual(["marker", "fence"]);
  expect(revokeSessions).not.toHaveBeenCalled();
  expect(consumeSignInLinks).not.toHaveBeenCalled();
});

test("a real hide revokes sessions and consumes sign-in links in the marker transaction", async () => {
  const calls: string[] = [];
  let inside = false;
  const adapter: TrashAdapter = { entityType: "member", hide: async () => { expect(inside).toBe(true); calls.push("marker"); return { ok: true, version: 2 }; }, unhide: vi.fn(), purge: vi.fn() };
  const member = createMemberTrashAdapter({ adapter, transaction: async ({ run }) => { inside = true; try { return await run(); } finally { inside = false; } },
    advanceCredentialFence: async () => { expect(inside).toBe(true); calls.push("fence"); }, revokeSessions: async () => { expect(inside).toBe(true); calls.push("sessions"); }, consumeSignInLinks: async () => { expect(inside).toBe(true); calls.push("links"); } });
  await member.hide(input);
  expect(calls).toEqual(["marker", "fence", "sessions", "links"]);
});

test("member hide and restore no-ops do not revoke credentials", async () => {
  const advanceCredentialFence = vi.fn();
  const revokeSessions = vi.fn();
  const consumeSignInLinks = vi.fn();
  const adapter: TrashAdapter = { entityType: "member", hide: async () => ({ ok: true, version: 1, noop: true }), unhide: async () => ({ ok: true, version: 1, noop: true }), purge: vi.fn() };
  const member = createMemberTrashAdapter({ adapter, transaction: async ({ run }) => run(), advanceCredentialFence, revokeSessions, consumeSignInLinks });
  await member.hide(input);
  await member.unhide(input);
  expect(advanceCredentialFence).not.toHaveBeenCalled();
  expect(revokeSessions).not.toHaveBeenCalled();
  expect(consumeSignInLinks).not.toHaveBeenCalled();
});

test("stale purge never reaches post cascade or media blob removal", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE posts (id TEXT, workspace_id TEXT, version INTEGER, deleted_at TEXT, updated_at TEXT)`);
    await kernel.execute(sql`CREATE TABLE post_revisions (post_id TEXT, workspace_id TEXT)`);
    await kernel.execute(sql`CREATE TABLE media (id TEXT, workspace_id TEXT, version INTEGER, status TEXT, kind TEXT, updated_at TEXT)`);
    await kernel.execute(sql`INSERT INTO posts VALUES ('member', 'site', 2, 'now', 'now')`);
    await kernel.execute(sql`INSERT INTO post_revisions VALUES ('member', 'site')`);
    await kernel.execute(sql`INSERT INTO media VALUES ('member', 'site', 2, 'active', 'image', 'now')`);
    const tableExists = vi.fn().mockResolvedValue(false);
    const purgeAsset = vi.fn();
    expect(await createPostTrashAdapter({ store: kernel, tableExists }).purge(input)).toBe("version-changed");
    expect(await createMediaTrashAdapter({ db: kernel, purgeAsset, isReferencedError: () => false }).purge(input)).toBe("version-changed");
    expect(tableExists).not.toHaveBeenCalled();
    expect(purgeAsset).not.toHaveBeenCalled();
    expect(await kernel.query(sql`SELECT * FROM post_revisions`)).toHaveLength(1);
    expect(await kernel.query(sql`SELECT * FROM posts`)).toHaveLength(1);
  } finally { await kernel.close(); }
});

test("failed member credential revocation rolls back both marker and credential fence", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE members (id TEXT, workspace_id TEXT, status TEXT, credentials_revoked_at TEXT)`);
    await kernel.execute(sql`INSERT INTO members VALUES ('member', 'site', 'active', NULL)`);
    const adapter: TrashAdapter = { entityType: "member", hide: async () => { await kernel.execute(sql`UPDATE members SET status='disabled' WHERE id='member'`); return { ok: true, version: 2 }; }, unhide: vi.fn(), purge: vi.fn() };
    const member = createSqlMemberAdapter({ adapter, db: kernel, tables: { members: "members", sessions: "missing_sessions", tokens: "member_magic_tokens" } });
    await expect(member.hide(input)).rejects.toThrow();
    expect(await kernel.query(sql`SELECT status, credentials_revoked_at FROM members`)).toEqual([{ status: "active", credentials_revoked_at: null }]);
  } finally { await kernel.close(); }
});


test("redirect marker flips preserve an independently disabled redirect and purge revisions before hits", async () => {
  const kernel = sqliteKernel<unknown>({ source: new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE redirects (id TEXT, workspace_id TEXT, status TEXT, version INTEGER, updated_at TEXT)`);
    await kernel.execute(sql`CREATE TABLE redirect_revisions (redirect_id TEXT, workspace_id TEXT, tombstoned INTEGER)`);
    await kernel.execute(sql`CREATE TABLE redirect_hits (redirect_id TEXT, workspace_id TEXT)`);
    await kernel.execute(sql`INSERT INTO redirects VALUES ('member','site','active',1,'old'), ('disabled','site','disabled',4,'old')`);
    await kernel.execute(sql`INSERT INTO redirect_revisions VALUES ('member','site',1), ('disabled','site',0)`);
    await kernel.execute(sql`INSERT INTO redirect_hits VALUES ('member','site')`);
    await kernel.execute(sql`CREATE TRIGGER refuse_hits_before_revisions BEFORE DELETE ON redirect_hits WHEN EXISTS(SELECT 1 FROM redirect_revisions WHERE redirect_id=OLD.redirect_id) BEGIN SELECT RAISE(ABORT,'revisions first'); END`);
    const adapter = createRedirectTrashAdapter({ store: kernel, tables: { redirects: "redirects", revisions: "redirect_revisions", hits: "redirect_hits" } });
    expect(await adapter.hide(input)).toMatchObject({ ok: true, version: 2 });
    expect(await adapter.purge({ ...input, expectedVersion: 2 })).toBe("purged");
    expect(await kernel.query(sql`SELECT id,status,version FROM redirects`)).toEqual([{ id: "disabled", status: "disabled", version: 4 }]);
    expect(await kernel.query(sql`SELECT tombstoned FROM redirect_revisions`)).toEqual([{ tombstoned: 0 }]);
    expect(await kernel.query(sql`SELECT * FROM redirect_hits`)).toEqual([]);
  } finally { await kernel.close(); }
});

test("post marker flips preserve unreadable body bytes and enforce CAS across retries", async () => {
  const kernel = openMemorySqliteKernel<unknown>({ open: () => new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE posts (id TEXT, workspace_id TEXT, version INTEGER, deleted_at TEXT, updated_at TEXT, body_json TEXT)`);
    await kernel.execute(sql`INSERT INTO posts VALUES ('member', 'site', 1, NULL, 'old', '{broken'), ('member', 'elsewhere', 1, NULL, 'old', '{}')`);
    const post = createPostTrashAdapter({ store: kernel, tableExists: async () => false });
    expect(await post.hide({ ...input, entityId: "missing" })).toEqual({ ok: false, reason: "not-found" });
    expect(await post.hide(input)).toEqual({ ok: true, version: 2 });
    expect(await post.hide(input)).toEqual({ ok: false, reason: "version-changed" });
    expect(await post.hide({ ...input, expectedVersion: 2, at: "later" })).toEqual({ ok: true, version: 2 });
    expect(await kernel.query(sql`SELECT deleted_at,updated_at FROM posts WHERE workspace_id='site'`)).toEqual([{ deleted_at: input.at, updated_at: input.at }]);
    expect(await post.unhide({ ...input, expectedVersion: null, at: "restored" })).toEqual({ ok: true, version: 3 });
    expect(await kernel.query(sql`SELECT workspace_id,version,deleted_at,updated_at,body_json FROM posts ORDER BY workspace_id`)).toEqual([
      { workspace_id: "elsewhere", version: 1, deleted_at: null, updated_at: "old", body_json: "{}" },
      { workspace_id: "site", version: 3, deleted_at: null, updated_at: "restored", body_json: "{broken" },
    ]);
  } finally { await kernel.close(); }
});

test("post purge rolls back a failed search probe and a retry removes only the target projections", async () => {
  const kernel = openMemorySqliteKernel<unknown>({ open: () => new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE posts (id TEXT, workspace_id TEXT, version INTEGER, deleted_at TEXT, updated_at TEXT)`);
    await kernel.execute(sql`CREATE TABLE post_revisions (post_id TEXT, workspace_id TEXT)`);
    await kernel.execute(sql`CREATE TABLE post_search_document (post_id TEXT PRIMARY KEY, title TEXT, slug TEXT, body_text TEXT)`);
    await kernel.execute(sql`INSERT INTO posts VALUES ('member','site',1,'trash','old'),('member','foreign',1,'trash','old')`);
    await kernel.execute(sql`INSERT INTO post_revisions VALUES ('member','site'),('member','foreign')`);
    await kernel.execute(sql`INSERT INTO post_search_document VALUES ('member','Removed','removed','body'),('other','Retained','retained','body')`);
    const outage = new Error("schema read failed");
    const tableExists = vi.fn<Parameters<typeof createPostTrashAdapter<unknown>>[0]["tableExists"]>()
      .mockRejectedValueOnce(outage).mockResolvedValue(true);
    const adapter = createPostTrashAdapter({ store: kernel, tableExists });
    await expect(adapter.purge(input)).rejects.toBe(outage);
    expect(await kernel.query(sql`SELECT workspace_id FROM post_revisions ORDER BY workspace_id`)).toEqual([{ workspace_id: "foreign" }, { workspace_id: "site" }]);
    expect(await adapter.purge(input)).toBe("purged");
    expect(await adapter.purge(input)).toBe("already-gone");
    expect(tableExists.mock.calls).toEqual(Array.from({ length: 2 }, () => [{ kernel, table: "post_search_document" }]));
    expect(await kernel.query(sql`SELECT workspace_id FROM posts`)).toEqual([{ workspace_id: "foreign" }]);
    expect(await kernel.query(sql`SELECT workspace_id FROM post_revisions`)).toEqual([{ workspace_id: "foreign" }]);
    expect(await kernel.query(sql`SELECT post_id,title FROM post_search_document`)).toEqual([{ post_id: "other", title: "Retained" }]);
  } finally { await kernel.close(); }
});

test("a redirect restore reactivates the addressed marker only", async () => {
  const kernel = openMemorySqliteKernel<unknown>({ open: () => new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE redirects (id TEXT, workspace_id TEXT, status TEXT, version INTEGER, updated_at TEXT)`);
    await kernel.execute(sql`INSERT INTO redirects VALUES ('member','site','disabled',1,'old'),('member','elsewhere','disabled',1,'old')`);
    const adapter = createRedirectTrashAdapter({ store: kernel, tables: { redirects: "redirects", revisions: "unused_revisions", hits: "unused_hits" } });
    expect(await adapter.unhide(input)).toEqual({ ok: true, version: 2 });
    expect(await kernel.query(sql`SELECT workspace_id,status,version,updated_at FROM redirects ORDER BY workspace_id`)).toEqual([
      { workspace_id: "elsewhere", status: "disabled", version: 1, updated_at: "old" },
      { workspace_id: "site", status: "active", version: 2, updated_at: input.at },
    ]);
  } finally { await kernel.close(); }
});

async function makeMediaKernel() {
  const kernel = openMemorySqliteKernel<unknown>({ open: () => new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE media (id TEXT, workspace_id TEXT, version INTEGER, status TEXT, kind TEXT, updated_at TEXT)`);
    await kernel.execute(sql`INSERT INTO media VALUES ('member','site',1,'active','image','old')`);
    return kernel;
  } catch (error) {
    await kernel.close();
    throw error;
  }
}

test("media changes report the committed kind, version and timestamp, and a failed report rolls back the marker", async () => {
  const kernel = await makeMediaKernel();
  try {
    const changed = vi.fn<(request: { workspaceId: string; mediaId: string; kind: string; marker: string }) => Promise<void>>().mockResolvedValue(undefined);
    const adapter = createMediaTrashAdapter({ db: kernel, changes: { changed }, purgeAsset: async () => {}, isReferencedError: () => false });
    expect(await adapter.hide(input)).toEqual({ ok: true, version: 2 });
    expect(await adapter.hide({ ...input, expectedVersion: 2, at: "later" })).toEqual({ ok: true, version: 2 });
    const restore = { ...input, expectedVersion: 2, at: "2026-11-26T00:00:00Z" };
    const outage = new Error("outbox offline");
    changed.mockRejectedValueOnce(outage);
    await expect(adapter.unhide(restore)).rejects.toBe(outage);
    expect(await kernel.query(sql`SELECT status,version,updated_at FROM media`)).toEqual([{ status: "trashed", version: 2, updated_at: input.at }]);
    expect(await adapter.unhide(restore)).toEqual({ ok: true, version: 3 });
    expect(await kernel.query(sql`SELECT status,version,updated_at FROM media`)).toEqual([{ status: "active", version: 3, updated_at: restore.at }]);
    expect(changed.mock.calls).toEqual([
      [{ workspaceId: "site", mediaId: "member", kind: "image", marker: `v2:${input.at}` }],
      [{ workspaceId: "site", mediaId: "member", kind: "image", marker: `v3:${restore.at}` }],
      [{ workspaceId: "site", mediaId: "member", kind: "image", marker: `v3:${restore.at}` }],
    ]);
  } finally { await kernel.close(); }
});

test("retrying a media hide in the same clock tick does not publish a duplicate change", async () => {
  const kernel = await makeMediaKernel();
  try {
    const changed = vi.fn(async () => {});
    const adapter = createMediaTrashAdapter({ db: kernel, changes: { changed }, purgeAsset: async () => {}, isReferencedError: () => false });
    expect(await adapter.hide(input)).toEqual({ ok: true, version: 2 });
    expect(await adapter.hide({ ...input, expectedVersion: 2 })).toEqual({ ok: true, version: 2 });
    expect(changed).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", mediaId: "member", kind: "image", marker: `v2:${input.at}` });
  } finally { await kernel.close(); }
});

test("media purge distinguishes references, infrastructure failures and a removed asset", async () => {
  const kernel = await makeMediaKernel();
  try {
    const reference = new Error("in use");
    const storage = new Error("storage failure");
    const purgeAsset = vi.fn<(request: { workspaceId: string; entityId: string }) => Promise<void>>()
      .mockRejectedValueOnce(reference).mockRejectedValueOnce(storage).mockResolvedValueOnce(undefined)
      .mockImplementation(async ({ workspaceId, entityId }) => {
        await kernel.execute(sql`DELETE FROM media WHERE workspace_id=${workspaceId} AND id=${entityId}`);
      });
    const adapter = createMediaTrashAdapter({ db: kernel, purgeAsset, isReferencedError: ({ error }) => error === reference });
    expect(await adapter.purge(input)).toBe("still-referenced");
    await expect(adapter.purge(input)).rejects.toBe(storage);
    expect(await adapter.purge(input)).toBe("version-changed");
    expect(await adapter.purge(input)).toBe("purged");
    expect(await adapter.purge(input)).toBe("already-gone");
    expect(purgeAsset.mock.calls).toEqual(Array.from({ length: 4 }, () => [{ workspaceId: "site", entityId: "member" }]));
  } finally { await kernel.close(); }
});

test("member credential consumption touches only this member's unconsumed tokens and never rewinds a credential fence", async () => {
  const kernel = openMemorySqliteKernel<unknown>({ open: () => new Database(":memory:") });
  try {
    await kernel.execute(sql`CREATE TABLE members (id TEXT, workspace_id TEXT, credentials_revoked_at TEXT)`);
    await kernel.execute(sql`CREATE TABLE sessions (member_id TEXT, workspace_id TEXT, revoked_at TEXT)`);
    await kernel.execute(sql`CREATE TABLE links (id TEXT, member_id TEXT, workspace_id TEXT, consumed_at TEXT)`);
    await kernel.execute(sql`INSERT INTO members VALUES ('member','site','2026-12-01'),('member','foreign',NULL)`);
    await kernel.execute(sql`INSERT INTO sessions VALUES ('member','site',NULL),('member','foreign',NULL)`);
    await kernel.execute(sql`INSERT INTO links VALUES ('a','member','site',NULL),('b','member','site','old'),('c','member','foreign',NULL),('d','other','site',NULL)`);
    const adapter: TrashAdapter = { entityType: "member", hide: async () => ({ ok: true, version: 2 }), unhide: vi.fn(), purge: vi.fn() };
    const member = createSqlMemberAdapter({ adapter, db: kernel, tables: { members: "members", sessions: "sessions", tokens: "links" } });
    expect(await member.hide(input)).toEqual({ ok: true, version: 2 });
    expect(await kernel.query(sql`SELECT id,consumed_at FROM links ORDER BY id`)).toEqual([
      { id: "a", consumed_at: input.at }, { id: "b", consumed_at: "old" }, { id: "c", consumed_at: null }, { id: "d", consumed_at: null },
    ]);
    expect(await kernel.query(sql`SELECT revoked_at FROM sessions ORDER BY workspace_id`)).toEqual([{ revoked_at: null }, { revoked_at: input.at }]);
    expect(await kernel.query(sql`SELECT credentials_revoked_at FROM members ORDER BY workspace_id`)).toEqual([{ credentials_revoked_at: null }, { credentials_revoked_at: "2026-12-01" }]);
  } finally { await kernel.close(); }
});
