import assert from "node:assert/strict";
import { test } from "vitest";

import type { DomainEvent, OutboxPort } from "@jini-ai/core/contracts/events";
import type { NavMenuEntry } from "../../index.js";
import { buildMenuTrashFollowUpHooks } from "../menu-trash-follow-ups.js";
import { TrashAwareInMemoryMenuRepo } from "../trash-aware-memory-menu-repo.js";

/**
 * @file Characterizes the menu Trash follow-up hooks, written before the verbatim move: hiding,
 * restoring and purging a menu emit the same `navigation.menu.*` events a direct delete does, and the
 * hide/purge hooks read the already-trashed row through the trash-blind lookup to get its slug.
 */

const AT = "2026-10-04T00:00:00.000Z";

function menuRow(overrides: Partial<NavMenuEntry> = {}): NavMenuEntry {
  return {
    id: "menu-1", workspaceId: "ws-1", slug: "primary-nav", title: "Primary Nav", status: "trash",
    doc: { type: "menu", version: 1, items: [] }, locations: [], updatedAt: AT, version: 1,
    ...overrides,
  };
}

async function setup(row: NavMenuEntry = menuRow()) {
  const menuRepo = new TrashAwareInMemoryMenuRepo();
  await menuRepo.saveAny({ ...row, priorStatus: "published" });
  const enqueued: DomainEvent[] = [];
  const outbox: OutboxPort = {
    enqueue: async (event) => { enqueued.push(event); },
    claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {},
  };
  let counter = 0;
  const hooks = buildMenuTrashFollowUpHooks({ menuRepo, outbox, idGen: { newId: () => `evt-${++counter}` }, clock: { nowMs: () => Date.parse(AT) } });
  return { hooks, enqueued };
}

function event(id: string, name: string) {
  return { id, name, occurredAt: AT, aggregateId: "menu-1", workspaceId: "ws-1", payload: { menuId: "menu-1", slug: "primary-nav" } };
}

test("afterHide emits navigation.menu.updated for the already-trashed row", async () => {
  const { hooks, enqueued } = await setup();
  await hooks.afterHide?.({ workspaceId: "ws-1", entityId: "menu-1", at: AT });
  assert.deepEqual(enqueued, [event("evt-1", "navigation.menu.updated")]);
});

test("afterUnhide reads the live row, so it emits only once the menu is live again", async () => {
  const trashed = await setup();
  await trashed.hooks.afterUnhide?.({ workspaceId: "ws-1", entityId: "menu-1", priorMarker: "published", at: AT });
  assert.deepEqual(trashed.enqueued, []);
  const live = await setup(menuRow({ status: "published" }));
  await live.hooks.afterUnhide?.({ workspaceId: "ws-1", entityId: "menu-1", priorMarker: "published", at: AT });
  assert.deepEqual(live.enqueued, [event("evt-1", "navigation.menu.updated")]);
});

test("beforePurge captures the trashed row and afterPurge emits navigation.menu.deleted from it", async () => {
  const { hooks, enqueued } = await setup();
  const priorState = await hooks.beforePurge?.({ workspaceId: "ws-1", entityId: "menu-1" });
  assert.equal((priorState as NavMenuEntry).slug, "primary-nav");
  await hooks.afterPurge?.({ workspaceId: "ws-1", entityId: "menu-1", priorState });
  assert.deepEqual(enqueued, [event("evt-1", "navigation.menu.deleted")]);
});

test("missing rows emit nothing", async () => {
  const { hooks, enqueued } = await setup();
  await hooks.afterHide?.({ workspaceId: "ws-1", entityId: "nope", at: AT });
  await hooks.afterPurge?.({ workspaceId: "ws-1", entityId: "nope", priorState: null });
  assert.deepEqual(enqueued, []);
});
