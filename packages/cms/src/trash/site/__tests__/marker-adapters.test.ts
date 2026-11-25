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
