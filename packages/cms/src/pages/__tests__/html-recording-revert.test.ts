import { ToolInputError } from "@jini-ai/core";
import { executeCommand } from "../../core/index.js";
import { InMemoryChangeSetRepo } from "../../core/commands/repo.memory.js";
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

function recordingFixture(recordedHtmlWrites: PageHtmlRecordingDeps["recordedHtmlWrites"] = "enabled") {
  const row: PostRecord = { id: "page", workspaceId: "w", kind: "page", title: "Page", slug: "page", bodyFormat: "html",
    bodyHtml: "<p>  previous </p>", bodyJson: {}, status: "draft", updatedAt: "2026-11-19", version: 7 };
  const changeSets = new InMemoryChangeSetRepo();
  const findById = vi.fn(async ({ id, workspaceId }: { id: string; workspaceId: string }) => id === row.id && workspaceId === row.workspaceId ? row : null);
  const authorize = vi.fn<PageHtmlRecordingDeps["authorize"]>(async () => ({ allowed: true, reason: "matched" }));
  const deps: PageHtmlRecordingDeps = {
    executeCommand, recordedHtmlWrites, authorize, editPermission: "pages.edit_html",
    summary: { pages_write_html: "Rewrite page", pages_write_region: "Edit region", pages_move_region: "Move region" },
    clock: { nowMs: () => 0 }, idGen: { newId: () => "change-7" }, changeSets,
    postRepo: { findById, transaction: async ({ fn }) => fn() },
  };
  const target = { workspaceId: "w", pageId: "page", actorId: "editor", executionId: "event-8" };
  return { deps, target, authorize, changeSets, findById };
}

it("a committed change records the exact pre-edit inverse with the new version and trusted page permission", async () => {
  const { deps, target, changeSets, authorize, findById } = recordingFixture();
  const result = await recordAssistantPageHtmlWrite({
    deps, target, expectedVersion: 7, operation: "pages_write_region", signal: new AbortController().signal,
    write: async () => ({ changed: true, value: { region: "hero" }, version: 8 }),
  });
  expect(result).toEqual({ value: { region: "hero" }, version: 8, changeSetId: "change-7" });
  expect(findById.mock.calls).toEqual([[{ workspaceId: "w", id: "page" }]]);
  expect(authorize.mock.calls).toEqual([[{ workspaceId: "w", principalId: "editor", entityType: "post",
    entityId: "page", permission: "pages.edit_html" }]]);
  expect(await changeSets.findById({ workspaceId: "w", id: "change-7" })).toMatchObject({
    changeSet: { idempotencyKey: "page-html:pages_write_region:page:event-8", summary: "Edit region" },
    items: [{ entityType: "page-html", entityId: "page", inversePayload: { format: "html", html: "<p>  previous </p>" }, entityVersionAtApply: 8 }],
  });
});

it("unchanged and stale writes never earn an undo record", async () => {
  const { deps, target, changeSets } = recordingFixture();
  const input = { deps, target, expectedVersion: 7, operation: "pages_write_html" as const, signal: new AbortController().signal };
  expect(await recordAssistantPageHtmlWrite({ ...input, write: async () => ({ changed: false, value: "unchanged", version: 7 }) })).toEqual({
    value: "unchanged", version: 7,
  });
  await expect(recordAssistantPageHtmlWrite({ ...input, expectedVersion: 6,
    write: async () => ({ changed: true, value: "stale", version: 8 }) })).rejects.toThrow(PageConcurrentEditError);
  expect(await changeSets.listByWorkspace({ workspaceId: "w" })).toEqual([]);
});

it("an abort or unavailable transaction refuses recording before page access or authoring", async () => {
  const { deps, target, findById, changeSets } = recordingFixture("disabled");
  const write = vi.fn(async () => ({ changed: true, value: "unexpected", version: 8 }));
  const base = { deps, target, expectedVersion: 7, operation: "pages_write_html" as const, write };
  const controller = new AbortController();
  const reason = new Error("request cancelled");
  controller.abort(reason);
  await expect(recordAssistantPageHtmlWrite({ ...base, signal: controller.signal })).rejects.toBe(reason);
  const refused = recordAssistantPageHtmlWrite({ ...base, signal: new AbortController().signal });
  await expect(refused).rejects.toBeInstanceOf(ToolInputError);
  await expect(refused).rejects.toThrow("it cannot record the edit and its Undo together. Nothing was written.");
  expect(findById.mock.calls).toEqual([]);
  expect(write.mock.calls).toEqual([]);
  expect(await changeSets.listByWorkspace({ workspaceId: "w" })).toEqual([]);
});
