import { expect, it, vi } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { createPost } from "../post-create.js";
import { updatePost } from "../post-update.js";
import { retirePostForReplacement } from "../post-retire.js";
import { restorePostForward } from "../post-trash.js";
import type { PostRecord, PostRepoPort, PostRevisionInput } from "../post.js";

function fixture() {
  const rows = new Map<string, PostRecord>();
  const revisions: (PostRevisionInput & { id: string })[] = [];
  const repo = { findById: async ({ id }: { id: string }) => rows.get(id) ?? null,
    findBySlug: async ({ slug }: { slug: string }) => [...rows.values()].find(row => row.slug === slug) ?? null,
    save: vi.fn(async (row: PostRecord) => { rows.set(row.id, row); }),
    saveIfVersion: vi.fn(async ({ record, ifVersion }: { record: PostRecord; ifVersion: number }) => { if (rows.get(record.id)?.version !== ifVersion) return { applied: false }; rows.set(record.id, record); return { applied: true }; }),
    appendRevision: vi.fn(async (input: PostRevisionInput) => { const previousId = revisions.filter(row => row.postId === input.postId).at(-1)?.id ?? null; const id = `revision-${revisions.length}`; revisions.push({ ...input, id }); return { id, previousId }; }),
    listRevisions: async ({ postId }: { postId: string }) => revisions.filter(row => row.postId === postId),
    transaction: async ({ fn }: { fn: () => Promise<unknown> }) => fn(),
  } as unknown as PostRepoPort;
  const outbox = { enqueue: vi.fn() };
  const clock = { nowMs: () => Date.parse("2026-11-25T00:00:00Z") };
  const deps = { repo, outbox, clock, reservedSegments: new Set<string>(), postPublicPath: ({ slug }: { slug: string }) => `/${slug}`, isDeepStrictEqual };
  return { rows, revisions, repo, deps, outbox };
}

it("creation takes a trashed slug while leaving the trash holder version unchanged", async () => {
  const f = fixture();
  const old = (await createPost({ deps: f.deps, input: { workspaceId: "w", id: "old", title: "Title", slug: "title" } })).post;
  f.rows.set(old.id, { ...old, deletedAt: "before" });
  const created = await createPost({ deps: f.deps, input: { workspaceId: "w", id: "new", title: "Title", slug: "title" } });
  expect(created.post.slug).toBe("title");
  expect(f.rows.get("old")).toMatchObject({ slug: "title-trashed", version: old.version, deletedAt: "before" });
});

it("a stale update has no hook, row, revision or outbox effects", async () => {
  const f = fixture();
  const post = (await createPost({ deps: f.deps, input: { workspaceId: "w", id: "post", title: "Title", slug: "title" } })).post;
  const beforeSaveHook = vi.fn();
  vi.mocked(f.repo.save).mockClear(); vi.mocked(f.repo.appendRevision).mockClear(); f.outbox.enqueue.mockClear();
  await expect(updatePost({ deps: { ...f.deps, beforeSaveHook }, input: { workspaceId: "w", id: post.id, title: "Changed", slug: post.slug, bodyJson: post.bodyJson, status: post.status, expectedVersion: 0 } })).rejects.toMatchObject({ expectedVersion: 0, currentVersion: post.version });
  expect(beforeSaveHook).not.toHaveBeenCalled(); expect(f.repo.save).not.toHaveBeenCalled(); expect(f.repo.saveIfVersion).not.toHaveBeenCalled(); expect(f.repo.appendRevision).not.toHaveBeenCalled(); expect(f.outbox.enqueue).not.toHaveBeenCalled();
});

it("a no-op update keeps the stored version and revision ledger", async () => {
  const f = fixture();
  const post = (await createPost({ deps: f.deps, input: { workspaceId: "w", id: "post", title: "Title", slug: "title" } })).post;
  const count = f.revisions.length;
  const result = await updatePost({ deps: f.deps, input: { workspaceId: "w", id: post.id, title: post.title, slug: post.slug, bodyJson: post.bodyJson, status: post.status, expectedVersion: post.version } });
  expect(result).toEqual({ post, revisionId: null, previousRevisionId: null }); expect(f.revisions).toHaveLength(count);
});

it("replacement retirement records rename then removal and forward restore clears the trash index", async () => {
  const f = fixture();
  const prior = (await createPost({ deps: f.deps, input: { workspaceId: "w", id: "post", title: "Title", slug: "title" } })).post;
  const remove = vi.fn(async ({ id, at, expectedVersion }: { id: string; at: string; expectedVersion: number | null }) => { const row = f.rows.get(id)!; expect(row.version).toBe(expectedVersion); f.rows.set(id, { ...row, deletedAt: at, version: row.version + 1 }); return { ok: true as const, version: row.version + 1 }; });
  const retired = await retirePostForReplacement({ deps: { ...f.deps, remove }, input: { workspaceId: "w", id: "post", expectedVersion: prior.version, today: "20261125" } });
  expect(retired.post).toMatchObject({ slug: "title-replaced-20261125", version: prior.version + 2 });
  expect(f.revisions.map(row => row.op)).toEqual(["create", "update", "delete"]);
  const forgetRemoved = vi.fn();
  const restored = await restorePostForward({ deps: { ...f.deps, forgetRemoved }, input: { prior } });
  expect(restored?.post).toMatchObject({ slug: "title", version: prior.version + 3 }); expect(restored?.post.deletedAt).toBeUndefined();
  expect(forgetRemoved).toHaveBeenCalledWith({ workspaceId: "w", id: "post" }); expect(f.revisions.at(-1)?.op).toBe("restore");
});
