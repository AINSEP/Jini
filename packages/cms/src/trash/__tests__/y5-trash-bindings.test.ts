import { expect, test, vi } from "vitest";
import type { ToolExecutionContext, ToolRegistration } from "@jini-ai/core";
import { bindTrashItemTool } from "../index.js";
import { bindTrashVisibility } from "../visibility.js";

function fixture() {
  const postRepo = { findById: vi.fn(async (_target: { workspaceId: string; id: string }): Promise<{ kind: string } | null> => ({ kind: "email-template" })) };
  const commentRepo = { findById: vi.fn(async () => ({ version: 4 })) };
  const authorize = vi.fn(async () => ({ allowed: true, reason: "grant" }));
  const binding = bindTrashItemTool({
    kinds: { post: "post", comment: "comment", media: "media", redirect: "redirect", widget: "widget", theme: "theme", user: "user" },
    delegates: new Map([
      ["post", { entityType: "post", toolId: "content_post_delete", permission: "content.write" }],
      ["comment", { entityType: "comment", toolId: "comments_trash_comment", permission: "comments.delete" }],
      ["media", { entityType: "media", toolId: "media_trash_asset", permission: "media.delete" }],
      ["redirect", { entityType: "redirect", toolId: "redirects_tombstone", permission: "admin.redirects.manage" }],
      ["widget", { entityType: "widget", toolId: "widgets_trash_instance", permission: "widgets.delete" }],
      ["theme", { entityType: "theme", toolId: "theme_trash", permission: "theme.edit" }],
    ]),
    actorPluginId: "assistant", metadata: {},
    presentation: { description: "Trash", entityTypeDescription: "Kind", entityIdDescription: "Id", floorPermission: "content.read", aliases: new Map([["page", "post"]]) },
    readLiveSnapshot: vi.fn(), moveToTrash: vi.fn(),
  });
  const routeDeps = { authorize, workspaceId: "site", postRepo, commentRepo, commentsReady: Promise.resolve(),
    registry: new Map(), isTrashableEntityType: () => true, db: {} as never, trash: {} as never, clock: { nowIso: () => "now" } };
  const run = vi.fn(async (_ctx: ToolExecutionContext) => ({ trashed: true }));
  const registrations: ToolRegistration[] = [{ descriptor: { id: "content_post_delete" }, policy: { authorize: () => "allow" }, handler: run },
    { descriptor: { id: "comments_trash_comment" }, policy: { authorize: () => "allow" }, handler: run }];
  return { binding, routeDeps, registrations, run, postRepo, commentRepo, authorize };
}

function context(entityType: string): ToolExecutionContext {
  return { executionId: "exec", run: { id: "run" }, principal: { id: "human" },
    signal: new AbortController().signal, input: { entityType, entityId: "item" } };
}

test("unknown kinds are refused without a delegate pre-read", async () => {
  const f = fixture();
  const [registration] = f.binding.deriveTrashItemRegistrations(f);
  await expect(registration!.handler(context("unknown"))).rejects.toThrow("Expected one of:");
  expect(f.postRepo.findById).not.toHaveBeenCalled();
  expect(f.commentRepo.findById).not.toHaveBeenCalled();
});

test("page aliases use the post delegate and map email templates to its supported post kind", async () => {
  const f = fixture();
  const [registration] = f.binding.deriveTrashItemRegistrations(f);
  expect(await registration!.handler(context("page"))).toMatchObject({ entityType: "post", via: "content_post_delete" });
  expect(f.run.mock.calls[0]![0]).toMatchObject({ input: { id: "item", kind: "post" } });
});

test("denied delegates do not pre-read post or comment rows", async () => {
  const f = fixture();
  f.authorize.mockResolvedValue({ allowed: false, reason: "denied" });
  const [registration] = f.binding.deriveTrashItemRegistrations(f);
  await expect(registration!.handler(context("post"))).rejects.toThrow("not authorized");
  await expect(registration!.handler(context("comment"))).rejects.toThrow("not authorized");
  expect(f.postRepo.findById).not.toHaveBeenCalled();
  expect(f.commentRepo.findById).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});

test("the user path invokes its injected guard without generic authorization or reads", async () => {
  const f = fixture();
  const trashUser = vi.fn(async () => { throw new Error("account guard"); });
  const [registration] = f.binding.deriveTrashItemRegistrations(f, { trashUser });
  await expect(registration!.handler(context("user"))).rejects.toThrow("account guard");
  expect(trashUser).toHaveBeenCalledWith({ principalId: "item", callerPrincipalId: "human" });
  expect(f.authorize).not.toHaveBeenCalled();
  expect(f.postRepo.findById).not.toHaveBeenCalled();
});

test("visibility bindings require the injected grants and refuse an unknown kind", async () => {
  const visibility = bindTrashVisibility({ permissions: new Map([["user", "*"]]) });
  const authorize = vi.fn(async () => ({ allowed: true, reason: "grant" }));
  const deps = { workspaceId: "site", registry: new Map(), authorize };
  expect(visibility.trashPermissionFor({ entityType: "user", registry: deps.registry })).toBe("*");
  expect(await visibility.mayActOnEntityType({ deps, principalId: "human", entityType: "unknown" })).toMatchObject({ permission: null, allowed: false });
  expect(authorize).not.toHaveBeenCalled();
});

test("the bound post delegate preserves the actual page kind and refuses a missing page", async () => {
  const f = fixture();
  f.postRepo.findById.mockResolvedValueOnce({ kind: "page" }).mockResolvedValueOnce(null);
  const [registration] = f.binding.deriveTrashItemRegistrations(f);
  const ctx = context("page");
  expect(await registration!.handler(ctx)).toEqual({ entityType: "post", entityId: "item", via: "content_post_delete", outcome: { trashed: true } });
  await expect(registration!.handler(ctx)).rejects.toThrow("trash_item: post 'item' was not found. Nothing was changed.");
  expect(f.run).toHaveBeenCalledExactlyOnceWith({ ...ctx, input: { id: "item", kind: "page" } }, {});
  expect(f.postRepo.findById.mock.calls).toEqual([[{ workspaceId: "site", id: "item" }], [{ workspaceId: "site", id: "item" }]]);
});
