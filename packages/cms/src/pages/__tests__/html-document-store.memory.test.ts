import { expect, it, vi } from "vitest";
import { InMemoryPagesHtmlDocumentStore } from "../html-document-store.memory.js";
import { PageNotFoundError } from "../html-document-store.js";
import type { PostRepoPort, PostRecord } from "../../posts/post.js";

it("a store never crosses scope even with equal post IDs", async () => {
  const other: PostRecord = { id: "p", workspaceId: "other", kind: "page", title: "P", slug: "p", bodyJson: {}, bodyFormat: "html", bodyHtml: "secret", status: "draft", version: 1, updatedAt: "now" };
  const findById = vi.fn(async ({ workspaceId, id }: { workspaceId?: string; id: string }) => other.id === id && (workspaceId === undefined || workspaceId === other.workspaceId) ? other : null);
  const repo = { findById } as unknown as PostRepoPort;
  const store = new InMemoryPagesHtmlDocumentStore({ scope: { workspaceId: "mine", postId: "p" }, deps: { repo, clock: { nowMs: () => 0 }, reportUnindexedRef: () => {}, restoredEntryRefs: () => [] } });
  await expect(store.read()).rejects.toBeInstanceOf(PageNotFoundError);
  expect(findById).toHaveBeenCalledWith({ workspaceId: "mine", id: "p" });
});
