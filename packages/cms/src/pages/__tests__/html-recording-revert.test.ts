import { expect, it, vi } from "vitest";
import type { PostRecord } from "../../posts/post.js";
import { PageConcurrentEditError } from "../html-document-store.js";
import { recordAssistantPageHtmlWrite, type PageHtmlRecordingDeps } from "../html-change-recording.js";
import { pageHtmlInverseOf, parsePageHtmlInverse } from "../html-inverse.js";
import { createPageHtmlReverter } from "../html-reverter.js";

it("recording failure rolls the HTML write back in the caller transaction", async () => {
  let html = "before";
  const deps = { recordedHtmlWrites: "enabled", editPermission: "pages.edit_html", summary: { pages_write_html: "rewrite" },
    postRepo: { findById: async () => ({ version: 1, bodyFormat: "html", bodyHtml: html }), transaction: async ({ fn }: { fn: () => Promise<unknown> }) => {
      const before = html; try { return await fn(); } catch (error) { html = before; throw error; }
    } }, executeCommand: async ({ mutation }: { mutation: { captureInverse: () => Promise<unknown>; execute: () => Promise<unknown> } }) => {
      await mutation.captureInverse(); await mutation.execute(); throw new Error("recording failed");
    } } as unknown as PageHtmlRecordingDeps;
  await expect(recordAssistantPageHtmlWrite({ deps, target: { workspaceId: "w", pageId: "page", actorId: "owner", executionId: "e" }, expectedVersion: 1, operation: "pages_write_html",
    write: async () => { html = "after"; return { changed: true, value: "after", version: 2 }; }, signal: new AbortController().signal })).rejects.toThrow("recording failed");
  expect(html).toBe("before");
});

it("HTML and document inverses round trip without normalization", () => {
  for (const row of [{ bodyFormat: "html" as const, bodyHtml: "<p>  exact </p>", bodyJson: {} }, { bodyFormat: "doc" as const, bodyHtml: null, bodyJson: { type: "doc", content: [] } }]) {
    const inverse = pageHtmlInverseOf({ row });
    expect(parsePageHtmlInverse({ payload: JSON.parse(JSON.stringify(inverse)) })).toEqual(inverse);
    expect(inverse).toEqual(row.bodyFormat === "html" ? { format: "html", html: row.bodyHtml } : { format: "doc", bodyJson: row.bodyJson });
  }
});

it("conflicting undo preserves the newer HTML and never permits force", async () => {
  const row = { id: "page", kind: "page", version: 3, bodyHtml: "newer" } as PostRecord;
  const restore = vi.fn(async () => { throw new PageConcurrentEditError("changed"); });
  const reverter = createPageHtmlReverter({ editPermission: "pages.edit_html", store: () => ({ restore }) as never, postRepo: { findById: async () => row } });
  expect(reverter.policy).toEqual({ permission: "pages.edit_html", authorizationEntityType: "post", allowForce: false });
  await expect(reverter.applyInverse({ workspaceId: "w", item: { entityId: "page", inversePayload: { format: "html", html: "before" }, entityVersionAtApply: 2 } as never }, { actorId: "owner" })).rejects.toThrow("newer version was kept");
  expect(restore).toHaveBeenCalledWith({ inverse: { format: "html", html: "before" }, expectedVersion: 2 });
  expect(row.bodyHtml).toBe("newer");
  expect(row.version).toBe(3);
});
