import { expect, it, vi } from "vitest";
import type { ChangeSetItemRecord } from "@jini-ai/core/contracts/events";
import type { PagesHtmlDocumentStoreFactory, PagesHtmlDocumentStorePort } from "@jini-ai/core/contracts/site/page-html-store";
import { createRevertRegistry } from "../../core/commands/index.js";
import { RevertConflictError, RevertNotPossibleError } from "@jini-ai/cms/core/commands";
import type { PostRecord } from "../../posts/post.js";
import { PageConcurrentEditError, PageNotFoundError } from "@jini-ai/cms/pages/html-document-store";
import { recordAssistantPageHtmlWrite, type PageHtmlRecordingDeps } from "../html-change-recording.js";
import { pageHtmlInverseOf, parsePageHtmlInverse, restoredEntryRefs } from "../html-inverse.js";
import { createPageHtmlReverter, registerPageHtmlReverter } from "../html-reverter.js";

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

const inverseItem: ChangeSetItemRecord = {
  id: "item-id", changeSetId: "change-id", entityType: "page-html", entityId: "page-id",
  operation: "update", inversePayload: { format: "html", html: "<p>Original</p>" }, entityVersionAtApply: 5, position: 0,
};
const originalPage: PostRecord = {
  id: "page-id", workspaceId: "site", kind: "page", bodyHtml: "<p>Edited</p>", bodyFormat: "html",
  bodyJson: { type: "doc", content: [] }, version: 5, title: "Page", slug: "page", status: "draft", updatedAt: "2026-11-20T00:00:00.000Z",
};
function revertFixture(row: PostRecord | null = originalPage, restore?: NonNullable<PagesHtmlDocumentStorePort["restore"]>) {
  const findById = vi.fn(async ({ workspaceId, id }: { workspaceId?: string; id: string }) =>
    row?.workspaceId === workspaceId && row?.id === id ? row : null);
  const store = vi.fn<PagesHtmlDocumentStoreFactory>(() => ({
    read: async () => { throw new Error("Unexpected read through store"); },
    write: async () => { throw new Error("Unexpected ordinary write"); },
    ensureHtmlFormat: async () => { throw new Error("Unexpected conversion"); },
    capturedVersion: () => null,
    ...(restore === undefined ? {} : { restore }),
  }));
  return { store, postRepo: { findById }, editPermission: "page.edit.custom" };
}

it.each([null, undefined, [], { format: "html", html: 4 }, { format: "doc", bodyJson: [] }, { format: "unknown", html: "a" }]
  .map(payload => ({ payload })))("refuses unrecognizable persisted inverse $payload", ({ payload }) => {
  expect(parsePageHtmlInverse({ payload })).toBeNull();
});

it("does not capture a placeholder doc as the inverse of a page with missing raw HTML", () => {
  expect(pageHtmlInverseOf({ row: { bodyFormat: "html", bodyHtml: null, bodyJson: {} } })).toBeNull();
});

it("indexes references from the restored HTML and reports an unreadable marker against that page", () => {
  const report = vi.fn();
  const refs = restoredEntryRefs({
    inverse: { format: "html", html: `<div data-embed-config='{"type":"widget","id":"form-widget"}'></div><div data-embed-config='{bad'></div>` },
    workspaceId: "site", postId: "restored-page", report,
  });
  expect(refs.map(({ workspaceId, sourceEntryId, sourceKind, targetKind, targetId }) =>
    [workspaceId, sourceEntryId, sourceKind, targetKind, targetId]))
    .toEqual([["site", "restored-page", "page-html-embed", "entry", "form-widget"]]);
  expect(report).toHaveBeenCalledExactlyOnceWith({
    sourceEntryId: "restored-page", message: expect.stringContaining("UNINDEXED reference"),
  });
});

it.each([
  { name: "missing", row: null, expected: null },
  { name: "post", row: { ...originalPage, kind: "post" as const }, expected: null },
  { name: "trashed page", row: { ...originalPage, deletedAt: "2026-11-22T00:00:00.000Z" }, expected: null },
  { name: "live page", row: originalPage, expected: 5 },
])("only exposes an Undo version for live pages ($name)", async ({ row, expected }) => {
  const deps = revertFixture(row);
  const reverter = createPageHtmlReverter(deps);
  expect(await reverter.currentVersion({ workspaceId: "site", entityId: "page-id" })).toBe(expected);
  expect(deps.postRepo.findById).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", id: "page-id" });
  expect(deps.store).not.toHaveBeenCalled();
});

it.each([
  { name: "invalid payload", item: { ...inverseItem, inversePayload: { format: "unknown" } } },
  { name: "missing version", item: { ...inverseItem, entityVersionAtApply: undefined } },
])("refuses Undo with $name before opening the page store", async ({ item }) => {
  const deps = revertFixture();
  const undo = createPageHtmlReverter(deps).applyInverse({ workspaceId: "site", item });
  await expect(undo).rejects.toBeInstanceOf(RevertNotPossibleError);
  await expect(undo).rejects.toThrow("This page change has no restorable earlier version.");
  expect(deps.store).not.toHaveBeenCalled();
});

it("refuses Undo when the bound page store cannot restore an inverse", async () => {
  const deps = revertFixture();
  const undo = createPageHtmlReverter(deps).applyInverse({ workspaceId: "site", item: inverseItem });
  await expect(undo).rejects.toBeInstanceOf(RevertNotPossibleError);
  await expect(undo).rejects.toThrow("This page store cannot restore an earlier version.");
  expect(deps.store).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", postId: "page-id" });
});

it("registered page Undo binds the current actor and restores the original body on its saved version", async () => {
  const registry = createRevertRegistry({});
  let body = "<p>Edited</p>";
  const restore = vi.fn<NonNullable<PagesHtmlDocumentStorePort["restore"]>>(async ({ inverse, expectedVersion }) => {
    if (expectedVersion !== 5 || inverse.format !== "html") throw new Error("Invalid restore request");
    body = inverse.html;
  });
  const deps = revertFixture(originalPage, restore);
  registerPageHtmlReverter({ ...deps, registry });
  const reverter = registry.resolve("page-html", "update");
  if (!reverter) throw new Error("Missing page-html/update reverter");
  expect(registry.resolve("page-html", "delete")).toBeUndefined();
  expect(reverter.policy).toEqual({ permission: "page.edit.custom", authorizationEntityType: "post", allowForce: false });
  await reverter.applyInverse({ workspaceId: "site", item: inverseItem }, { actorId: "operator" });
  expect(body).toBe("<p>Original</p>");
  expect(deps.store).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", postId: "page-id", actorId: "operator" });
  expect(restore).toHaveBeenCalledExactlyOnceWith({ inverse: { format: "html", html: "<p>Original</p>" }, expectedVersion: 5 });
});

it("turns disappearance during Undo into a conflict with no usable version", async () => {
  const deps = revertFixture(null, async () => { throw new PageNotFoundError("Deleted during restore"); });
  const undo = createPageHtmlReverter(deps).applyInverse({ workspaceId: "site", item: inverseItem });
  await expect(undo).rejects.toBeInstanceOf(RevertConflictError);
  await expect(undo).rejects.toMatchObject({
    entityType: "page-html", entityId: "page-id", currentVersion: null,
    message: "This page changed after that edit was made, so it was not undone and the newer version was kept. Edit the page again instead.",
  });
  expect(deps.postRepo.findById).toHaveBeenCalledExactlyOnceWith({ workspaceId: "site", id: "page-id" });
});

it("propagates an infrastructure error during Undo instead of offering to retry an edit", async () => {
  const failure = new Error("write transport unavailable");
  const deps = revertFixture(originalPage, async () => { throw failure; });
  await expect(createPageHtmlReverter(deps).applyInverse({ workspaceId: "site", item: inverseItem })).rejects.toBe(failure);
  expect(deps.postRepo.findById).not.toHaveBeenCalled();
});
