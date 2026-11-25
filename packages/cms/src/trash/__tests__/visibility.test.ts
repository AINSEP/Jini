import { expect, it, vi } from "vitest";
import type { TrashRegistry } from "../registry-types.js";
import type { TrashItem } from "../ports.js";
import { filterVisibleTrashItems, trashPermissionFor } from "../visibility.js";

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
