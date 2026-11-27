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

test("a registered mover wins over a table entry, but only after its own entity-scoped authorization", async () => {
  const actor = { principalId: "owner", pluginId: "agent" };
  const input = { workspaceId: "ws", entityType: "post", entityId: "article", actor };
  const move = vi.fn(async () => ({ ok: true, version: 4 }) as const);
  const authorize = vi.fn().mockResolvedValueOnce({ allowed: false }).mockResolvedValueOnce({ allowed: true });
  const readLiveSnapshot = vi.fn();
  const localTrash = { ...trash, trash: vi.fn() };
  const deps = { movers: new Map([["post", { permission: "post.move", move }]]), registry: new Map([["post", entry]]),
    trash: localTrash, clock: { nowIso: () => "today" }, authorize, readLiveSnapshot };
  expect(await moveToTrash(input, deps)).toEqual({ ok: false, reason: "forbidden", permission: "post.move" });
  expect(move).not.toHaveBeenCalled();
  expect(await moveToTrash(input, deps)).toEqual({ ok: true, version: 4 });
  expect(move).toHaveBeenCalledExactlyOnceWith({ workspaceId: "ws", entityId: "article", actor });
  expect(authorize.mock.calls).toEqual(Array.from({ length: 2 }, () => [
    { workspaceId: "ws", entityId: "article", entityType: "post", principalId: "owner", permission: "post.move" },
  ]));
  expect(readLiveSnapshot).not.toHaveBeenCalled();
  expect(localTrash.trash).not.toHaveBeenCalled();
});

test("a missing live row and an unknown kind do not reach the write port", async () => {
  const input = { workspaceId: "site", entityType: "post", entityId: "missing", actor: { principalId: "owner" } };
  const readLiveSnapshot = vi.fn(async () => null);
  const authorize = vi.fn(async () => ({ allowed: true }));
  const localTrash = { ...trash, trash: vi.fn() };
  const deps = { registry: new Map([["post", entry]]), authorize, readLiveSnapshot, trash: localTrash, clock: { nowIso: () => "today" } };
  expect(await moveToTrash({ ...input, entityType: "unsupported" }, deps)).toEqual({ ok: false, reason: "unknown-type" });
  expect(authorize).not.toHaveBeenCalled();
  expect(await moveToTrash(input, deps)).toEqual({ ok: false, reason: "not-found" });
  expect(readLiveSnapshot).toHaveBeenCalledExactlyOnceWith({ entry, workspaceId: "site", entityId: "missing" });
  expect(localTrash.trash).not.toHaveBeenCalled();
});

test("the atomic Trash port receives the observed row and the caller sees its exact typed outcome", async () => {
  const input = { workspaceId: "site", entityType: "post", entityId: "article", actor: { principalId: "owner" } };
  const marker = vi.fn<TrashPort["trash"]>().mockResolvedValueOnce({ ok: true, version: 7, noop: true })
    .mockResolvedValueOnce({ ok: false, reason: "blocked", code: "DEPENDENTS", count: 2 })
    .mockResolvedValueOnce({ ok: false, reason: "not-found" })
    .mockResolvedValueOnce({ ok: false, reason: "version-changed" });
  const deps = { registry: new Map([["post", entry]]), authorize: async () => ({ allowed: true }),
    readLiveSnapshot: async () => ({ title: "Feature", version: 6 }), trash: { ...trash, trash: marker }, clock: { nowIso: () => "captured" } };
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await moveToTrash(input, deps));
  expect(results).toEqual([
    { ok: true, version: 7 }, { ok: false, reason: "blocked", code: "DEPENDENTS", count: 2 },
    { ok: false, reason: "not-found" }, { ok: false, reason: "version-changed" },
  ]);
  expect(marker.mock.calls).toEqual(Array.from({ length: 4 }, () => [
    { ...input, display: { title: "Feature", subtitle: null }, expectedVersion: 6, at: "captured" },
  ]));
});
