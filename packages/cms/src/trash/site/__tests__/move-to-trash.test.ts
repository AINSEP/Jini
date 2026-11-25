import { expect, test, vi } from "vitest";
import type { TrashEntry, TrashPort } from "../../index.js";
import { moveToTrash } from "../move-to-trash.js";

const entry: TrashEntry = { entityType: "post", label: "Post", permission: "write", table: "posts", idColumn: "id", workspaceColumn: "workspace_id", marker: { kind: "timestamp", column: "deleted_at" }, versionColumn: "version", display: { title: "title" } };
const trash: TrashPort = { trash: vi.fn(), restore: vi.fn(), purgeSelected: vi.fn(), list: vi.fn() };

test("deny never reads the snapshot", async () => {
  const readLiveSnapshot = vi.fn();
  expect(await moveToTrash({ workspaceId: "site", entityType: "post", entityId: "post", actor: { principalId: "human" } }, {
    registry: new Map([["post", entry]]), trash, clock: { nowIso: () => "now" }, readLiveSnapshot, authorize: async () => ({ allowed: false }),
  })).toEqual({ ok: false, reason: "forbidden", permission: "write" });
  expect(readLiveSnapshot).not.toHaveBeenCalled();
  expect(trash.trash).not.toHaveBeenCalled();
});

test("a confirmed version that differs from the live row returns version-changed before trash.trash", async () => {
  const readLiveSnapshot = vi.fn().mockResolvedValue({ title: "title", version: 2 });
  expect(await moveToTrash({ workspaceId: "site", entityType: "post", entityId: "post", actor: { principalId: "human" }, expectedVersion: 1 }, {
    registry: new Map([["post", entry]]), trash, clock: { nowIso: () => "now" }, readLiveSnapshot, authorize: async () => ({ allowed: true }),
  })).toEqual({ ok: false, reason: "version-changed" });
  expect(trash.trash).not.toHaveBeenCalled();
});
