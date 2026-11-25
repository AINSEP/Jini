import { expect, test, vi } from "vitest";
import { InMemoryPostSearchIndex, type PostSearchScratch } from "../search-index.memory.js";
import type { PostRecord } from "../post.js";

test("two reseeds serialize clear, projection and query on one lazy scratch", async () => {
  const calls: string[] = [];
  let tail = Promise.resolve();
  let active = false;
  const scratch: PostSearchScratch = {
    transaction: ({ run }) => {
      const result = tail.then(async () => {
        active = true;
        calls.push("begin");
        try { return await run(); }
        finally { calls.push("end"); active = false; }
      });
      tail = result.then(() => undefined);
      return result;
    },
    clearProjection: async () => { expect(active).toBe(true); calls.push("projection"); },
    clearPosts: async () => { expect(active).toBe(true); calls.push("posts"); },
    insertPost: async ({ post }) => { expect(active).toBe(true); calls.push(`insert:${post.workspaceId}`); },
    upsertDocument: async ({ document }) => { expect(active).toBe(true); calls.push(`upsert:${document.postId}`); },
    query: async ({ query }) => { expect(active).toBe(true); calls.push(`query:${query.workspaceId}`); return []; },
  };
  const openScratch = vi.fn(() => scratch);
  const repo = { list: vi.fn(async ({ workspaceId }: { workspaceId: string }): Promise<PostRecord[]> => [{
    id: workspaceId, workspaceId, title: "Title", slug: "title", bodyJson: {},
    bodyFormat: "doc", bodyHtml: null, kind: "post", status: "draft", version: 1,
    updatedAt: "2026-11-25T00:00:00.000Z",
  }]) };
  const index = new InMemoryPostSearchIndex({ repo, openScratch });
  expect(openScratch).not.toHaveBeenCalled();
  await Promise.all([index.search({ workspaceId: "a", terms: ["title"], limit: 8 }), index.search({ workspaceId: "b", terms: ["title"], limit: 8 })]);
  expect(openScratch).toHaveBeenCalledTimes(1);
  expect(repo.list.mock.calls).toEqual([[{ workspaceId: "a" }], [{ workspaceId: "b" }]]);
  expect(calls).toEqual([
    "begin", "projection", "posts", "insert:a", "upsert:a", "query:a", "end",
    "begin", "projection", "posts", "insert:b", "upsert:b", "query:b", "end",
  ]);
});
