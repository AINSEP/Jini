import { expect, test, vi } from "vitest";
import { writePage } from "../page-editor-save.js";

test("HTML writes use the metadata response version and remain gated", async () => {
  const metadata = { slug: "page", status: "draft" as const, version: 8 };
  const final = { ...metadata, version: 9 };
  const port = { updatePost: vi.fn(async () => ({ post: metadata })), updatePageHtml: vi.fn(async () => ({ post: final })) };
  const plan = { canSaveHtml: true, statusToWrite: "draft" as const, updatePostPayload: { title: "Title", slug: "page", status: "draft" as const, templateChoice: null, expectedVersion: 3 } };
  expect(await writePage({ port, pageId: "page", plan, html: "<p>new</p>" })).toBe(final);
  expect(port.updatePageHtml).toHaveBeenCalledExactlyOnceWith({ id: "page", html: "<p>new</p>", expectedVersion: 8 });
  port.updatePageHtml.mockClear();
  expect(await writePage({ port, pageId: "page", plan: { ...plan, canSaveHtml: false }, html: "refused" })).toBe(metadata);
  expect(port.updatePageHtml).not.toHaveBeenCalled();
});
