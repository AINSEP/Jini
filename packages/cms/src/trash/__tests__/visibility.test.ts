import { expect, it, vi } from "vitest";
import type { TrashRegistry } from "../registry-types.js";
import type { TrashItem } from "../ports.js";
import { bindTrashVisibility, filterVisibleTrashItems, trashDaysRemaining, trashPermissionFor } from "../visibility.js";

function item(id: string, entityType: string): TrashItem {
  return { id, entityType, entityId: id, workspaceId: "ws", trashedAt: "now", purgeAfter: "later", actorPrincipalId: "owner", actorPluginId: null, displayTitle: id, displaySubtitle: null, entityVersion: null, priorMarker: null };
}

it("an unknown kind is hidden and a short page keeps its source cursor", async () => {
  const authorize = vi.fn(async () => ({ allowed: true, reason: "allowed" }));
  const page = { items: [item("1", "unknown"), item("2", "post")], nextCursor: "source-cursor" };
  const visible = await filterVisibleTrashItems({ deps: { workspaceId: "ws", authorize, registry: new Map(), permissions: new Map([["post", "write"]]) }, principalId: "caller", items: page.items });
  expect({ ...page, items: visible }).toEqual({ items: [page.items[1]], nextCursor: "source-cursor" });
  expect(authorize).toHaveBeenCalledExactlyOnceWith({ principalId: "caller", permission: "write", workspaceId: "ws", entityType: "post", entityId: undefined });
});

it("the bespoke permission map precedes the registry and makes one decision per kind", async () => {
  const registry: TrashRegistry = new Map([["post", { entityType: "post", label: "Posts", permission: "registry", table: "posts", idColumn: "id", workspaceColumn: "workspace_id", marker: { kind: "status", column: "status", trashed: "trash", restoreFallback: "draft" }, display: { title: "title" } }]]);
  const permissions = new Map([["post", "bespoke"]]);
  expect(trashPermissionFor({ entityType: "post", registry, permissions })).toBe("bespoke");
  const authorize = vi.fn(async () => ({ allowed: true, reason: "yes" }));
  const items = [item("1", "post"), item("2", "post")];
  expect(await filterVisibleTrashItems({ deps: { workspaceId: "ws", authorize, registry, permissions }, principalId: "caller", items })).toEqual(items);
  expect(authorize).toHaveBeenCalledTimes(1);
});

it("denied kind visibility returns no row", async () => {
  const authorize = vi.fn(async () => ({ allowed: false, reason: "denied" }));
  const deps = { authorize, workspaceId: "w", registry: new Map() as TrashRegistry, permissions: new Map([["post", "write"]]) };
  expect(await filterVisibleTrashItems({ deps, principalId: "owner", items: [{ entityType: "post", entityId: "p", display: { title: "private" } } as unknown as TrashItem] })).toEqual([]);
  expect(authorize).toHaveBeenCalledTimes(1);
});

it("bound visibility forwards per-item authorization and shares the same registry fallback for list and action", async () => {
  const post = item("post-1", "post"), other = item("media-1", "media");
  const registry: TrashRegistry = new Map([["post", { entityType: "post", label: "Post", permission: "posts.manage",
    table: "posts", idColumn: "id", workspaceColumn: "workspace_id", marker: { kind: "timestamp", column: "deleted_at" }, display: { title: "title" } }]]);
  const permissions = new Map([["media", "media.manage"]]);
  const authorize = vi.fn<Parameters<typeof filterVisibleTrashItems>[0]["deps"]["authorize"]>(
    async ({ permission }) => ({ allowed: permission === "posts.manage", reason: permission === "posts.manage" ? "granted" : "denied" }));
  const visibility = bindTrashVisibility({ permissions });
  expect(visibility.trashPermissionFor({ registry, entityType: "media" })).toBe("media.manage");
  expect(visibility.trashPermissionFor({ registry, entityType: "post" })).toBe("posts.manage");
  const deps = { workspaceId: "ws", registry, authorize };
  expect(await visibility.mayActOnEntityType({ deps, principalId: "owner", entityType: "post", entityId: "post-1" })).toEqual({
    permission: "posts.manage", reason: "granted", allowed: true,
  });
  expect(await visibility.filterVisibleTrashItems({ deps, principalId: "owner", items: [post, other] })).toEqual([post]);
  expect(authorize.mock.calls.map(([request]) => request)).toEqual([
    { workspaceId: "ws", principalId: "owner", entityType: "post", entityId: "post-1", permission: "posts.manage" },
    { workspaceId: "ws", principalId: "owner", entityType: "post", entityId: undefined, permission: "posts.manage" },
    { workspaceId: "ws", principalId: "owner", entityType: "media", entityId: undefined, permission: "media.manage" },
  ]);
});

it("trash retention rounds a fractional remaining day up and never shows negative days", () => {
  const now = "2026-11-25T00:00:00.000Z";
  expect(trashDaysRemaining({ now, until: "2026-11-26T00:00:00.001Z" })).toBe(2);
  expect(trashDaysRemaining({ now, until: "2026-11-26T00:00:00.000Z" })).toBe(1);
  expect(trashDaysRemaining({ now, until: now })).toBe(0);
  expect(trashDaysRemaining({ now, until: "2026-11-23T00:00:00.000Z" })).toBe(0);
});
