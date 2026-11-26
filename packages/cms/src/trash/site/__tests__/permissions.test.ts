import { expect, it, vi } from "vitest";
import type { TrashItem, TrashRegistry } from "../../index.js";
import { filterVisibleTrashItems } from "../permissions.js";

it("denied kind visibility returns no row", async () => {
  const authorize = vi.fn(async () => ({ allowed: false, reason: "denied" }));
  const deps = { authorize, workspaceId: "w", registry: { get: () => undefined } as unknown as TrashRegistry, permissionByEntityType: new Map([["post", "write"]]) };
  expect(await filterVisibleTrashItems(deps, { principalId: "owner", items: [{ entityType: "post", entityId: "p", display: { title: "private" } } as unknown as TrashItem] })).toEqual([]);
  expect(authorize).toHaveBeenCalledTimes(1);
});
