import assert from "node:assert/strict";
import { test } from "vitest";

import type { DomainEvent, OutboxPort } from "../../core/ports.js";
import { assignLocation, createMenu, deleteMenu, MenuConflictError, updateMenuTree } from "../menu-service.js";
import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo, type MenuRepoPort } from "../repo.memory.js";
import type { NavMenuEntry } from "../types.js";

/**
 * @file Menu writes are compare-and-set (wm S4): the version check lives in the repo's `save`, so
 * two writers that read the same version cannot both land. Covers `InMemoryMenuRepo.save`'s
 * `expectedVersion` contract and the three service saves that pass it (`updateMenuTree` and both
 * `assignLocation` saves).
 */

const WS = "ws-1";

function fakeClock() {
  return { nowMs: () => Date.parse("2026-10-04T00:00:00.000Z") };
}

function fakeIdGen() {
  let counter = 0;
  return { newId: () => `id-${++counter}` };
}

function fakeOutbox(): { outbox: OutboxPort; enqueued: DomainEvent[] } {
  const enqueued: DomainEvent[] = [];
  return {
    enqueued,
    outbox: {
      enqueue: async (event) => {
        enqueued.push(event);
      },
      claimPending: async () => [],
      markDelivered: async () => {},
      markFailed: async () => {},
    },
  };
}

function menuRow(overrides: Partial<NavMenuEntry> = {}): NavMenuEntry {
  return {
    id: "menu-1",
    workspaceId: WS,
    slug: "primary-nav",
    title: "Primary Nav",
    status: "published",
    doc: { type: "menu", version: 1, items: [] },
    locations: [],
    updatedAt: "2026-10-04T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

/** A repo where another writer bumps `raceId`'s stored version right after the service reads it. */
function racingRepo(inner: InMemoryMenuRepo, raceId: string): MenuRepoPort {
  return {
    findById: async (required) => {
      const row = await inner.findById(required);
      if (row && row.id === raceId) await inner.save({ ...row, title: "Other writer", version: row.version + 1 });
      return row;
    },
    findBySlug: (required) => inner.findBySlug(required),
    list: (required) => inner.list(required),
    save: (record, options) => inner.save(record, options),
    remove: (required) => inner.remove(required),
  };
}

test("InMemoryMenuRepo.save with a matching expectedVersion writes the row", async () => {
  const repo = new InMemoryMenuRepo({}, { initialRows: [menuRow()] });
  await repo.save(menuRow({ title: "New", version: 2 }), { expectedVersion: 1 });
  assert.deepEqual(await repo.findById({ workspaceId: WS, id: "menu-1" }), menuRow({ title: "New", version: 2 }));
});

test("InMemoryMenuRepo.save with a stale expectedVersion throws and leaves the row as it was", async () => {
  const repo = new InMemoryMenuRepo({}, { initialRows: [menuRow({ version: 2 })] });
  await assert.rejects(
    () => repo.save(menuRow({ title: "Stale", version: 2 }), { expectedVersion: 1 }),
    (error: unknown) =>
      error instanceof MenuConflictError &&
      error.message === "menu 'menu-1' was modified concurrently (expected version 1, found 2)"
  );
  assert.deepEqual(await repo.findById({ workspaceId: WS, id: "menu-1" }), menuRow({ version: 2 }));
});

test("InMemoryMenuRepo.save with an expectedVersion finds none for a missing or trashed row", async () => {
  const repo = new InMemoryMenuRepo({}, { initialRows: [menuRow({ id: "trashed", status: "trash" }), menuRow({ id: "other-ws", workspaceId: "ws-2" })] });
  for (const id of ["missing", "trashed", "other-ws"]) {
    await assert.rejects(
      () => repo.save(menuRow({ id, version: 2 }), { expectedVersion: 1 }),
      (error: unknown) =>
        error instanceof MenuConflictError &&
        error.message === `menu '${id}' was modified concurrently (expected version 1, found none)`
    );
  }
  assert.equal(await repo.findById({ workspaceId: WS, id: "missing" }), null);
  assert.equal((await repo.findById({ workspaceId: WS, id: "trashed" }))?.status, "trash");
});

test("two concurrent updateMenuTree calls on the same base version: exactly one wins, the other gets a version conflict", async () => {
  const repo = new InMemoryMenuRepo({});
  const { outbox, enqueued } = fakeOutbox();
  const deps = { repo, clock: fakeClock(), idGen: fakeIdGen(), outbox };
  const { menu } = await createMenu({ deps, input: { workspaceId: WS, title: "Primary Nav", slug: "primary-nav" } });
  enqueued.length = 0;

  const edit = (label: string) =>
    updateMenuTree({
      deps,
      input: { workspaceId: WS, id: menu.id, expectedVersion: 1, items: [{ id: label, label, target: { kind: "url", href: "/" } }] },
    });
  const results = await Promise.allSettled([edit("first"), edit("second")]);

  const won = results.filter((result) => result.status === "fulfilled");
  const lost = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.ok(lost[0]?.reason instanceof MenuConflictError);
  assert.equal(lost[0]?.reason.message, `menu '${menu.id}' was modified concurrently (expected version 1, found 2)`);
  const stored = await repo.findById({ workspaceId: WS, id: menu.id });
  assert.equal(stored?.version, 2);
  assert.deepEqual(stored?.doc.items.map((node) => node.id), ["first"]);
  assert.deepEqual(enqueued.map((event) => event.name), ["navigation.menu.updated"], "the losing write enqueues nothing");
});

test("updateMenuTree loses to a writer that lands between its read and its save", async () => {
  const inner = new InMemoryMenuRepo({}, { initialRows: [menuRow()] });
  const { outbox, enqueued } = fakeOutbox();
  await assert.rejects(
    () =>
      updateMenuTree({
        deps: { repo: racingRepo(inner, "menu-1"), clock: fakeClock(), idGen: fakeIdGen(), outbox },
        input: { workspaceId: WS, id: "menu-1", expectedVersion: 1, items: [] },
      }),
    (error: unknown) =>
      error instanceof MenuConflictError &&
      error.message === "menu 'menu-1' was modified concurrently (expected version 1, found 2)"
  );
  assert.equal((await inner.findById({ workspaceId: WS, id: "menu-1" }))?.title, "Other writer");
  assert.deepEqual(enqueued, []);
});

test("assignLocation's menu save loses to a writer that lands between its read and its save", async () => {
  const inner = new InMemoryMenuRepo({}, { initialRows: [menuRow()] });
  const bindingRepo = new InMemoryNavLocationBindingRepo({});
  const { outbox, enqueued } = fakeOutbox();
  await assert.rejects(
    () =>
      assignLocation({
        deps: { repo: racingRepo(inner, "menu-1"), bindingRepo, clock: fakeClock(), idGen: fakeIdGen(), outbox },
        input: { workspaceId: WS, menuId: "menu-1", locationKey: "primary" },
      }),
    (error: unknown) =>
      error instanceof MenuConflictError &&
      error.message === "menu 'menu-1' was modified concurrently (expected version 1, found 2)"
  );
  assert.deepEqual((await inner.findById({ workspaceId: WS, id: "menu-1" }))?.locations, []);
  assert.equal(await bindingRepo.findByLocation({ workspaceId: WS, locationKey: "primary" }), null);
  assert.deepEqual(enqueued, []);
});

test("assignLocation's displaced-menu save loses to a writer that lands between its read and its save", async () => {
  const inner = new InMemoryMenuRepo({}, {
    initialRows: [menuRow({ id: "displaced", slug: "displaced", locations: ["primary"] }), menuRow({ id: "incoming", slug: "incoming" })],
  });
  const bindingRepo = new InMemoryNavLocationBindingRepo({}, { initialRows: [{ workspaceId: WS, locationKey: "primary", menuId: "displaced", boundAt: "2026-10-04T00:00:00.000Z" }] });
  const { outbox } = fakeOutbox();
  await assert.rejects(
    () =>
      assignLocation({
        deps: { repo: racingRepo(inner, "displaced"), bindingRepo, clock: fakeClock(), idGen: fakeIdGen(), outbox },
        input: { workspaceId: WS, menuId: "incoming", locationKey: "primary" },
      }),
    (error: unknown) =>
      error instanceof MenuConflictError &&
      error.message === "menu 'displaced' was modified concurrently (expected version 1, found 2)"
  );
  const displaced = await inner.findById({ workspaceId: WS, id: "displaced" });
  assert.deepEqual([displaced?.title, displaced?.locations], ["Other writer", ["primary"]]);
  assert.deepEqual((await inner.findById({ workspaceId: WS, id: "incoming" }))?.locations, []);
});

test("deleteMenu's trash save stays unconditional", async () => {
  const inner = new InMemoryMenuRepo({}, { initialRows: [menuRow()] });
  const { menu } = await deleteMenu({
    deps: { repo: racingRepo(inner, "menu-1"), bindingRepo: new InMemoryNavLocationBindingRepo({}), clock: fakeClock(), idGen: fakeIdGen(), outbox: fakeOutbox().outbox },
    input: { workspaceId: WS, id: "menu-1" },
  });
  assert.equal(menu?.status, "trash");
  assert.equal((await inner.findById({ workspaceId: WS, id: "menu-1" }))?.status, "trash");
});
