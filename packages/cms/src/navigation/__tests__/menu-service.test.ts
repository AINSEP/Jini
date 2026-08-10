import assert from "node:assert/strict";
import { test } from "vitest";

import type { DomainEvent, OutboxPort } from "../../core/ports.js";
import {
  assignLocation,
  createMenu,
  deleteMenu,
  MenuConflictError,
  MenuLocationBoundError,
  MenuNotFoundError,
  MenuValidationError,
  updateMenuTree,
} from "../menu-service.js";
import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo } from "../repo.memory.js";
import type { NavItemNode } from "../types.js";

// ---------------------------------------------------------------------------
// Test fakes
// ---------------------------------------------------------------------------

function fakeClock(iso = "2026-07-10T00:00:00.000Z") {
  return { nowIso: () => iso };
}

function fakeIdGen(prefix = "id") {
  let counter = 0;
  return { newId: () => `${prefix}-${++counter}` };
}

/** Records every enqueued event (outbox-enqueue assertions, T020-T023). */
function fakeOutbox(): { outbox: OutboxPort; enqueued: DomainEvent[] } {
  const enqueued: DomainEvent[] = [];
  const outbox: OutboxPort = {
    enqueue: async (event) => {
      enqueued.push(event);
    },
    claimPending: async () => [],
    markDelivered: async () => {},
    markFailed: async () => {},
  };
  return { outbox, enqueued };
}

function item(overrides: Partial<NavItemNode> & { id: string }): NavItemNode {
  return {
    label: "Home",
    target: { kind: "url", href: "/" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createMenu + updateMenuTree
// ---------------------------------------------------------------------------

test("createMenu stores a new menu at version 1", async () => {
  const repo = new InMemoryMenuRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen("menu");
  const { outbox } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: {
      workspaceId: "ws-1",
      title: "Primary Nav",
      slug: "primary-nav",
      items: [item({ id: "item-1", label: "Home" })],
    },
  });

  assert.equal(menu.id, "menu-1");
  assert.equal(menu.version, 1);
  assert.equal(menu.status, "published");
  assert.deepEqual(menu.locations, []);
  assert.equal(menu.doc.items.length, 1);

  const stored = await repo.findById({ workspaceId: "ws-1", id: menu.id });
  assert.ok(stored);
});

test("createMenu rejects duplicate slug in the same workspace", async () => {
  const repo = new InMemoryMenuRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });

  await assert.rejects(
    () =>
      createMenu({
        deps: { repo, clock, idGen, outbox },
        input: { workspaceId: "ws-1", title: "Another Nav", slug: "primary-nav" },
      }),
    MenuConflictError
  );
});

test("updateMenuTree replaces the tree and increments version on a matching expectedVersion", async () => {
  const repo = new InMemoryMenuRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });

  const { menu: updated } = await updateMenuTree({
    deps: { repo, clock: fakeClock("2026-07-10T01:00:00.000Z"), idGen, outbox },
    input: {
      workspaceId: "ws-1",
      id: menu.id,
      expectedVersion: menu.version,
      items: [item({ id: "item-1", label: "Home" }), item({ id: "item-2", label: "About" })],
    },
  });

  assert.equal(updated.version, 2);
  assert.equal(updated.doc.items.length, 2);
  assert.equal(updated.updatedAt, "2026-07-10T01:00:00.000Z");
});

test("updateMenuTree rejects a stale expectedVersion (OCC conflict)", async () => {
  const repo = new InMemoryMenuRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });

  // Simulate a second admin already having advanced the version.
  await updateMenuTree({
    deps: { repo, clock, idGen, outbox },
    input: {
      workspaceId: "ws-1",
      id: menu.id,
      expectedVersion: menu.version,
      items: [item({ id: "item-1" })],
    },
  });

  await assert.rejects(
    () =>
      updateMenuTree({
        deps: { repo, clock, idGen, outbox },
        input: {
          workspaceId: "ws-1",
          id: menu.id,
          expectedVersion: menu.version, // stale: real current version is now +1
          items: [item({ id: "item-2" })],
        },
      }),
    MenuConflictError
  );

  // Confirm the rejected write did not mutate stored state.
  const stored = await repo.findById({ workspaceId: "ws-1", id: menu.id });
  assert.equal(stored?.version, 2);
  assert.equal(stored?.doc.items[0]?.id, "item-1");
});

test("updateMenuTree rejects a tree with duplicate item ids (adversarial aggregate check)", async () => {
  const repo = new InMemoryMenuRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });

  await assert.rejects(
    () =>
      updateMenuTree({
        deps: { repo, clock, idGen, outbox },
        input: {
          workspaceId: "ws-1",
          id: menu.id,
          expectedVersion: menu.version,
          items: [
            item({ id: "dup" }),
            item({ id: "dup" }), // repeated id — must reject the whole batch
          ],
        },
      }),
    MenuValidationError
  );

  // The whole tree must be rejected atomically: no partial write leaked in.
  const stored = await repo.findById({ workspaceId: "ws-1", id: menu.id });
  assert.equal(stored?.version, 1);
  assert.equal(stored?.doc.items.length, 0);
});

test("updateMenuTree rejects a tree nested past the max depth", async () => {
  const repo = new InMemoryMenuRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });

  // Depth 1..7, exceeding the default max of 5.
  let deepest: NavItemNode = item({ id: "leaf" });
  for (let depth = 0; depth < 6; depth += 1) {
    deepest = item({ id: `wrap-${depth}`, children: [deepest] });
  }

  await assert.rejects(
    () =>
      updateMenuTree({
        deps: { repo, clock, idGen, outbox },
        input: {
          workspaceId: "ws-1",
          id: menu.id,
          expectedVersion: menu.version,
          items: [deepest],
        },
      }),
    MenuValidationError
  );
});

test("updateMenuTree rejects a reserved (not-yet-supported) target kind", async () => {
  const repo = new InMemoryMenuRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });

  await assert.rejects(
    () =>
      updateMenuTree({
        deps: { repo, clock, idGen, outbox },
        input: {
          workspaceId: "ws-1",
          id: menu.id,
          expectedVersion: menu.version,
          items: [
            item({
              id: "item-1",
              // Reserved seam — not a supported v1 target yet.
              target: { kind: "dynamicQuery" } as unknown as NavItemNode["target"],
            }),
          ],
        },
      }),
    MenuValidationError
  );
});

test("updateMenuTree rejects a javascript: url target", async () => {
  const repo = new InMemoryMenuRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });

  await assert.rejects(
    () =>
      updateMenuTree({
        deps: { repo, clock, idGen, outbox },
        input: {
          workspaceId: "ws-1",
          id: menu.id,
          expectedVersion: menu.version,
          items: [item({ id: "item-1", target: { kind: "url", href: "javascript:alert(1)" } })],
        },
      }),
    MenuValidationError
  );
});

// ---------------------------------------------------------------------------
// assignLocation
// ---------------------------------------------------------------------------

test("assignLocation binds a menu to a location and writes both the menu field and the index", async () => {
  const repo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });

  const { menu: updated, binding, displacedMenu } = await assignLocation({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", menuId: menu.id, locationKey: "primary" },
  });

  assert.equal(displacedMenu, null);
  assert.deepEqual(updated.locations, ["primary"]);
  assert.equal(binding.menuId, menu.id);

  const indexRow = await bindingRepo.findByLocation({ workspaceId: "ws-1", locationKey: "primary" });
  assert.equal(indexRow?.menuId, menu.id);
});

test("assignLocation reassigns a location already bound elsewhere (last-writer-wins) and updates both representations", async () => {
  const repo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  const { menu: menuA } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Menu A", slug: "menu-a" },
  });
  const { menu: menuB } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Menu B", slug: "menu-b" },
  });

  await assignLocation({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", menuId: menuA.id, locationKey: "primary" },
  });

  const { menu: updatedB, displacedMenu } = await assignLocation({
    deps: { repo, bindingRepo, clock: fakeClock("2026-07-10T02:00:00.000Z"), idGen, outbox },
    input: { workspaceId: "ws-1", menuId: menuB.id, locationKey: "primary" },
  });

  // Binding index now points at menu B, exclusively (UNIQUE per location).
  const indexRow = await bindingRepo.findByLocation({ workspaceId: "ws-1", locationKey: "primary" });
  assert.equal(indexRow?.menuId, menuB.id);
  assert.equal(updatedB.locations.includes("primary"), true);

  // Menu A (displaced) had its own field revision drop the location.
  assert.equal(displacedMenu?.id, menuA.id);
  assert.deepEqual(displacedMenu?.locations, []);
  const storedA = await repo.findById({ workspaceId: "ws-1", id: menuA.id });
  assert.deepEqual(storedA?.locations, []);

  // Only one binding row exists for this location — the uniqueness invariant.
  const allBindings = await bindingRepo.listByWorkspace({ workspaceId: "ws-1" });
  assert.equal(allBindings.filter((row) => row.locationKey === "primary").length, 1);
});

// ---------------------------------------------------------------------------
// deleteMenu — trash then purge-blocked-while-bound
// ---------------------------------------------------------------------------

test("deleteMenu soft-deletes (trash) on first call, then blocks purge while bound to a location", async () => {
  const repo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });
  await assignLocation({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", menuId: menu.id, locationKey: "primary" },
  });

  const { menu: trashed, purged } = await deleteMenu({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", id: menu.id },
  });
  assert.equal(purged, false);
  assert.equal(trashed?.status, "trash");

  await assert.rejects(
    () =>
      deleteMenu({
        deps: { repo, bindingRepo, clock, idGen, outbox },
        input: { workspaceId: "ws-1", id: menu.id },
      }),
    MenuLocationBoundError
  );

  // Menu row must still exist — purge was blocked, not silently skipped.
  const stillThere = await repo.findById({ workspaceId: "ws-1", id: menu.id });
  assert.ok(stillThere);
});

test("deleteMenu purges once unassigned, removing the menu row and its bindings", async () => {
  const repo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });

  await deleteMenu({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", id: menu.id },
  });
  const { menu: purgedResult, purged } = await deleteMenu({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", id: menu.id },
  });

  assert.equal(purged, true);
  assert.equal(purgedResult, null);
  assert.equal(await repo.findById({ workspaceId: "ws-1", id: menu.id }), null);
});

test("deleteMenu force-purges past the bound-location guard", async () => {
  const repo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });
  await assignLocation({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", menuId: menu.id, locationKey: "primary" },
  });
  await deleteMenu({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", id: menu.id },
  });

  const { purged } = await deleteMenu({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", id: menu.id, force: true },
  });

  assert.equal(purged, true);
  const remainingBindings = await bindingRepo.listByMenu({ workspaceId: "ws-1", menuId: menu.id });
  assert.equal(remainingBindings.length, 0);
});

test("deleteMenu on an unknown id throws MenuNotFoundError", async () => {
  const repo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox } = fakeOutbox();

  await assert.rejects(
    () =>
      deleteMenu({
        deps: { repo, bindingRepo, clock, idGen, outbox },
        input: { workspaceId: "ws-1", id: "missing" },
      }),
    MenuNotFoundError
  );
});

// ---------------------------------------------------------------------------
// Outbox event publication (T020-T023, C-004..C-007)
// ---------------------------------------------------------------------------

test("C-004: createMenu enqueues exactly one navigation.menu.created on success; zero on a rejection", async () => {
  const repo = new InMemoryMenuRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen("menu");
  const { outbox, enqueued } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0]!.name, "navigation.menu.created");
  assert.equal(enqueued[0]!.workspaceId, "ws-1");
  assert.deepEqual(enqueued[0]!.payload, { menuId: menu.id, slug: "primary-nav" });

  // A rejected (duplicate-slug) attempt enqueues nothing.
  await assert.rejects(
    () =>
      createMenu({
        deps: { repo, clock, idGen, outbox },
        input: { workspaceId: "ws-1", title: "Another Nav", slug: "primary-nav" },
      }),
    MenuConflictError
  );
  assert.equal(enqueued.length, 1, "the rejected create enqueued nothing");
});

test("C-005: updateMenuTree enqueues exactly one navigation.menu.updated on success; zero on an OCC/validation rejection", async () => {
  const repo = new InMemoryMenuRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox, enqueued } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });
  enqueued.length = 0; // isolate the update assertions from the create's own event

  await updateMenuTree({
    deps: { repo, clock, idGen, outbox },
    input: {
      workspaceId: "ws-1",
      id: menu.id,
      expectedVersion: menu.version,
      items: [item({ id: "item-1" })],
    },
  });

  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0]!.name, "navigation.menu.updated");
  assert.deepEqual(enqueued[0]!.payload, { menuId: menu.id, slug: "primary-nav" });

  // Stale OCC rejection enqueues nothing.
  await assert.rejects(
    () =>
      updateMenuTree({
        deps: { repo, clock, idGen, outbox },
        input: {
          workspaceId: "ws-1",
          id: menu.id,
          expectedVersion: menu.version, // stale — real version already advanced
          items: [item({ id: "item-2" })],
        },
      }),
    MenuConflictError
  );
  assert.equal(enqueued.length, 1, "the rejected update enqueued nothing");

  // Validation rejection also enqueues nothing.
  await assert.rejects(
    () =>
      updateMenuTree({
        deps: { repo, clock, idGen, outbox },
        input: {
          workspaceId: "ws-1",
          id: menu.id,
          expectedVersion: 2,
          items: [item({ id: "dup" }), item({ id: "dup" })],
        },
      }),
    MenuValidationError
  );
  assert.equal(enqueued.length, 1, "the rejected (validation) update enqueued nothing");
});

test("C-006: assignLocation enqueues one 'assigned' on a fresh assign; 'assigned' + 'unassigned' on reassignment; no 'unassigned' with no prior binding", async () => {
  const repo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox, enqueued } = fakeOutbox();

  const { menu: menuA } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Menu A", slug: "menu-a" },
  });
  const { menu: menuB } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Menu B", slug: "menu-b" },
  });
  enqueued.length = 0;

  await assignLocation({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", menuId: menuA.id, locationKey: "primary" },
  });

  assert.equal(enqueued.length, 1, "a fresh assign with no prior binding enqueues only 'assigned'");
  assert.equal(enqueued[0]!.name, "navigation.location.assigned");
  assert.deepEqual(enqueued[0]!.payload, { locationKey: "primary", menuId: menuA.id });

  enqueued.length = 0;

  await assignLocation({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", menuId: menuB.id, locationKey: "primary" },
  });

  assert.equal(enqueued.length, 2, "reassignment enqueues both an 'assigned' and an 'unassigned'");
  const assignedEvent = enqueued.find((e) => e.name === "navigation.location.assigned");
  const unassignedEvent = enqueued.find((e) => e.name === "navigation.location.unassigned");
  assert.ok(assignedEvent, "'assigned' event present");
  assert.deepEqual(assignedEvent?.payload, { locationKey: "primary", menuId: menuB.id });
  assert.ok(unassignedEvent, "'unassigned' event present for the displaced menu");
  assert.deepEqual(unassignedEvent?.payload, { locationKey: "primary", menuId: menuA.id });
});

test("C-007: deleteMenu's trash step enqueues navigation.menu.updated; a purge enqueues navigation.menu.deleted; a blocked purge enqueues nothing", async () => {
  const repo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const { outbox, enqueued } = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav" },
  });
  await assignLocation({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", menuId: menu.id, locationKey: "primary" },
  });
  enqueued.length = 0;

  // First call: trash step.
  await deleteMenu({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", id: menu.id },
  });
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0]!.name, "navigation.menu.updated");
  enqueued.length = 0;

  // Second call: blocked purge (still bound to "primary") — enqueues nothing.
  await assert.rejects(
    () =>
      deleteMenu({
        deps: { repo, bindingRepo, clock, idGen, outbox },
        input: { workspaceId: "ws-1", id: menu.id },
      }),
    MenuLocationBoundError
  );
  assert.equal(enqueued.length, 0, "a blocked purge enqueues nothing");

  // Force-purge succeeds.
  const { purged } = await deleteMenu({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", id: menu.id, force: true },
  });
  assert.equal(purged, true);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0]!.name, "navigation.menu.deleted");
  assert.deepEqual(enqueued[0]!.payload, { menuId: menu.id, slug: "primary-nav" });
});
