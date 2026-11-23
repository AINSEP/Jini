import assert from "node:assert/strict";
import { test } from "vitest";

import { InMemoryMenuRepo, MenuConflictError, MenuVersionConflictError, type MenuRepoPort, type NavMenuEntry } from "../../index.js";
import { TrashAwareInMemoryMenuRepo } from "../trash-aware-memory-menu-repo.js";

/**
 * @file Characterizes the in-memory Trash twin of the host's SQLite menu repo, written before the
 * verbatim move: trashed rows are hidden from the live reads, a plain save over a trashed row is a
 * no-op, a trashed menu's slug stays reserved, and the restore marker is keyed per workspace and
 * forgotten on hard removal.
 */

function menuRow(overrides: Partial<NavMenuEntry> = {}): NavMenuEntry {
  return {
    id: "menu-1", workspaceId: "ws-1", slug: "primary-nav", title: "Primary Nav", status: "published",
    doc: { type: "menu", version: 1, items: [] }, locations: [], updatedAt: "2026-10-04T00:00:00.000Z", version: 1,
    ...overrides,
  };
}

async function trashedRepo(): Promise<TrashAwareInMemoryMenuRepo> {
  const repo = new TrashAwareInMemoryMenuRepo();
  await repo.save(menuRow());
  await repo.saveAny({ ...menuRow({ status: "trash" }), priorStatus: "published" });
  return repo;
}

test("a live menu is visible through every read", async () => {
  const repo = new TrashAwareInMemoryMenuRepo();
  await repo.save(menuRow());
  assert.equal((await repo.findById({ workspaceId: "ws-1", id: "menu-1" }))?.title, "Primary Nav");
  assert.equal((await repo.findBySlug({ workspaceId: "ws-1", slug: "primary-nav" }))?.id, "menu-1");
  assert.deepEqual((await repo.list({ workspaceId: "ws-1" })).map((row) => row.id), ["menu-1"]);
  assert.equal((await repo.findAnyById({ workspaceId: "ws-1", id: "menu-1" }))?.priorStatus, null);
});

test("a trashed menu is hidden from live reads but seen by the trash-blind ones", async () => {
  const repo = await trashedRepo();
  assert.equal(await repo.findById({ workspaceId: "ws-1", id: "menu-1" }), null);
  assert.equal(await repo.findBySlug({ workspaceId: "ws-1", slug: "primary-nav" }), null);
  assert.deepEqual(await repo.list({ workspaceId: "ws-1" }), []);
  assert.equal((await repo.findByIdIncludingTrashed({ workspaceId: "ws-1", id: "menu-1" }))?.status, "trash");
  assert.equal((await repo.findAnyById({ workspaceId: "ws-1", id: "menu-1" }))?.priorStatus, "published");
  assert.equal(await repo.findAnyById({ workspaceId: "ws-2", id: "menu-1" }), null);
});

test("a plain save over a trashed menu leaves it as it is", async () => {
  const repo = await trashedRepo();
  await repo.save(menuRow({ title: "Overwritten", version: 2 }));
  const row = await repo.findByIdIncludingTrashed({ workspaceId: "ws-1", id: "menu-1" });
  assert.equal(row?.title, "Primary Nav");
  assert.equal(row?.status, "trash");
});

test("a compare-and-set save over a trashed menu is a version conflict, not a silent skip", async () => {
  const repo = await trashedRepo();
  await assert.rejects(repo.save(menuRow({ version: 2 }), { expectedVersion: 1 }), MenuVersionConflictError);
});

test("a different menu cannot take a slug held in the Trash", async () => {
  const repo = await trashedRepo();
  await assert.rejects(repo.save(menuRow({ id: "menu-2" })), (error: unknown) => {
    assert.ok(error instanceof MenuConflictError);
    assert.match(error.message, /a menu with slug 'primary-nav' is in the Trash/);
    return true;
  });
});

test("remove forgets the restore marker, so a recreated id does not inherit it", async () => {
  const repo = await trashedRepo();
  await repo.remove({ workspaceId: "ws-1", id: "menu-1" });
  assert.equal(await repo.findByIdIncludingTrashed({ workspaceId: "ws-1", id: "menu-1" }), null);
  await repo.save(menuRow());
  assert.equal((await repo.findAnyById({ workspaceId: "ws-1", id: "menu-1" }))?.priorStatus, null);
});

test("saveAny with a null marker clears it", async () => {
  const repo = await trashedRepo();
  await repo.saveAny({ ...menuRow(), priorStatus: null });
  assert.equal((await repo.findAnyById({ workspaceId: "ws-1", id: "menu-1" }))?.priorStatus, null);
  assert.equal((await repo.findById({ workspaceId: "ws-1", id: "menu-1" }))?.status, "published");
});

test("an inner plain MenuConflictError is re-wrapped only under expectedVersion", async () => {
  const base = new InMemoryMenuRepo({});
  const conflict = new MenuConflictError({ message: "inner conflict" });
  const inner: MenuRepoPort = Object.assign(Object.create(base) as MenuRepoPort, { save: async () => { throw conflict; } });
  const repo = new TrashAwareInMemoryMenuRepo({}, { inner });
  await assert.rejects(repo.save(menuRow(), { expectedVersion: 1 }), (error: unknown) => {
    assert.ok(error instanceof MenuVersionConflictError);
    assert.equal(error.message, "inner conflict");
    assert.equal((error as Error).cause, conflict);
    return true;
  });
  await assert.rejects(repo.save(menuRow()), (error: unknown) => error === conflict);
});
