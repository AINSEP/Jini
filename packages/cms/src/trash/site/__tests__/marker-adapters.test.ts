import { createRedirectTrashAdapter } from "../adapters/redirect.js";
import { createMemberTrashAdapter as createSqlMemberAdapter } from "../adapters/member-credential-sql.js";
import { expect, test, vi } from "vitest";
import Database from "better-sqlite3";
import { sql } from "kysely";
import { sqliteKernel } from "@jini-ai/db/kernel/sqlite";
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
