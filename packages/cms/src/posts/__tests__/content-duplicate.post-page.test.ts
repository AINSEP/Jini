import { expect, it, vi } from "vitest";
import { contributePostDuplicateHandlers } from "../post-tool-duplicate.js";
import { createPost } from "../post-create.js";
import { ROOT_SLUG, type PostRecord } from "../post.js";
import type { PostToolDeps } from "../post-tool-deps.js";

vi.mock("../post-create.js", () => ({ createPost: vi.fn() }));

it("duplicates an HTML page through the injected HTML store without losing its body", async () => {
  const source = { id: "source", workspaceId: "w", kind: "page", slug: "source", title: "Source", status: "draft", bodyJson: { type: "doc", content: [] }, bodyFormat: "html", bodyHtml: null, version: 1, updatedAt: "now" } as PostRecord;
  const copy = { ...source, id: "copy", slug: "copy", title: "Copy" };
  const order: string[] = [];
  vi.mocked(createPost).mockResolvedValue({ post: { ...copy, bodyFormat: "doc" } as never, revisionId: "revision", previousRevisionId: null });
  const deps = { workspaceId: "w", authorize: async () => ({ allowed: true }), contentReadPermission: "content.read", contentWritePermission: "content.write", reservedSegments: new Set(),
    postRepo: { findById: async ({ id }: { id: string }) => id === "source" ? source : copy, list: async () => [source], transaction: async ({ fn }: { fn: () => Promise<unknown> }) => fn() }, idGen: { newId: () => "copy" },
    pagesHtmlStore: ({ postId }: { postId: string }) => ({ read: async () => { order.push(`read:${postId}`); return "<h1>Body</h1>"; }, ensureHtmlFormat: async ({ seedHtml }: { seedHtml: string }) => { order.push(`format:${postId}:${seedHtml}`); }, write: async ({ html }: { html: string }) => { order.push(`write:${postId}:${html}`); } }),
    executeCommand: async ({ mutation }: { mutation: { captureInverse: () => Promise<unknown>; execute: () => Promise<unknown> } }) => { await mutation.captureInverse(); return { result: await mutation.execute() }; },
    processOutbox: vi.fn(), postToolViewDeps: () => ({ workspaceId: "w", entryPublicPath: ({ slug }: { slug: string }) => slug === ROOT_SLUG ? "/" : `/${slug}`, runtimeMode: () => "local", publishedWhere: { local: "Local", live: "Live" } }),
  } as unknown as PostToolDeps;
  const handler = contributePostDuplicateHandlers({ deriveDuplicateName: vi.fn() }).find(row => row.resource === "page")!.build(deps);
  await handler.duplicate({ principalId: "owner", id: "source", overrides: { title: "Copy", slug: "copy" } });
  expect(order).toEqual(["read:source", "format:copy:<h1>Body</h1>"]);
  expect(createPost).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ kind: "page", creatorKind: "agent", bodyJson: undefined }) }));
});
