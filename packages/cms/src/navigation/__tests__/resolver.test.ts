import assert from "node:assert/strict";
import { test } from "vitest";

import { assignLocation, createMenu } from "../menu-service.js";
import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo } from "../repo.memory.js";
import { resolveForLocation, type ResolveTargetHrefFn } from "../resolver.js";
import type { NavItemNode, NavTarget } from "../types.js";

function fakeClock(iso = "2026-07-10T00:00:00.000Z") {
  return { nowIso: () => iso };
}

function fakeIdGen(prefix = "id") {
  let counter = 0;
  return { newId: () => `${prefix}-${++counter}` };
}

/**
 * A fake `resolveTargetHref` for tests: `entryRef` resolves to a deterministic
 * path; `route` resolves `home` only; every `termRef` resolves to `null`
 * (ADR-029 Round-3 audit fold item 1 — no `entry_refs`-compatible term-target
 * schema exists yet, so a real resolver has nothing to consult for term
 * targets today). Any `entryRef` whose id starts with `deleted-` simulates a
 * trashed target: resolves to a real path but `available: false`.
 */
const fakeResolveTargetHref: ResolveTargetHrefFn = async (target: NavTarget) => {
  if (target.kind === "url") return null; // resolver.ts never calls us for url
  if (target.kind === "termRef") return null; // see comment above
  if (target.kind === "entryRef") {
    if (target.entryId.startsWith("deleted-")) {
      return { path: `/entries/${target.entryId}`, available: false };
    }
    return { path: `/entries/${target.entryId}`, available: true };
  }
  if (target.kind === "route") {
    if (target.route === "home") return { path: "/", available: true };
    return null;
  }
  return null;
};

/** No-op outbox — this suite exercises `resolver.ts`'s reads, not `menu-service.ts`'s event publication. */
function fakeOutbox() {
  return { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} };
}

async function seedMenuBoundToLocation(items: readonly NavItemNode[]) {
  const repo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();
  const clock = fakeClock();
  const idGen = fakeIdGen();
  const outbox = fakeOutbox();

  const { menu } = await createMenu({
    deps: { repo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", title: "Primary Nav", slug: "primary-nav", items },
  });
  await assignLocation({
    deps: { repo, bindingRepo, clock, idGen, outbox },
    input: { workspaceId: "ws-1", menuId: menu.id, locationKey: "primary" },
  });

  return { repo, bindingRepo, menu };
}

test("resolveForLocation returns null when no menu is bound to the location", async () => {
  const repo = new InMemoryMenuRepo();
  const bindingRepo = new InMemoryNavLocationBindingRepo();

  const result = await resolveForLocation({
    deps: { menuRepo: repo, bindingRepo, resolveTargetHref: fakeResolveTargetHref },
    input: { workspaceId: "ws-1", locationKey: "footer" },
  });

  assert.equal(result, null);
});

test("resolveForLocation resolves url targets directly and entryRef targets via the injected resolver", async () => {
  const { repo, bindingRepo } = await seedMenuBoundToLocation([
    { id: "item-1", label: "Home", target: { kind: "url", href: "/" } },
    { id: "item-2", label: "About", target: { kind: "entryRef", entryId: "about-page" } },
  ]);

  const resolved = await resolveForLocation({
    deps: { menuRepo: repo, bindingRepo, resolveTargetHref: fakeResolveTargetHref },
    input: { workspaceId: "ws-1", locationKey: "primary" },
  });

  assert.ok(resolved);
  assert.equal(resolved.items.length, 2);
  assert.equal(resolved.items[0]!.href, "/");
  assert.equal(resolved.items[0]!.available, true);
  assert.equal(resolved.items[1]!.href, "/entries/about-page");
  assert.equal(resolved.items[1]!.available, true);
});

test("resolveForLocation marks an unavailable target as available:false without breaking the rest of the tree", async () => {
  const { repo, bindingRepo } = await seedMenuBoundToLocation([
    { id: "item-1", label: "Home", target: { kind: "url", href: "/" } },
    {
      id: "item-2",
      label: "Deleted Page",
      target: { kind: "entryRef", entryId: "deleted-page-1" },
    },
    { id: "item-3", label: "About", target: { kind: "entryRef", entryId: "about-page" } },
  ]);

  const resolved = await resolveForLocation({
    deps: { menuRepo: repo, bindingRepo, resolveTargetHref: fakeResolveTargetHref },
    input: { workspaceId: "ws-1", locationKey: "primary" },
  });

  assert.ok(resolved);
  assert.equal(resolved.items.length, 3);

  // The unavailable item is flagged, not dropped from the model (theme's job
  // to omit it) and its href is nulled out.
  assert.equal(resolved.items[1]!.available, false);
  assert.equal(resolved.items[1]!.href, null);

  // Sibling items on either side still resolved normally.
  assert.equal(resolved.items[0]!.available, true);
  assert.equal(resolved.items[0]!.href, "/");
  assert.equal(resolved.items[2]!.available, true);
  assert.equal(resolved.items[2]!.href, "/entries/about-page");
});

test("resolveForLocation propagates unavailable through nested children without breaking siblings", async () => {
  const { repo, bindingRepo } = await seedMenuBoundToLocation([
    {
      id: "parent",
      label: "Company",
      target: { kind: "url", href: "/company" },
      children: [
        { id: "child-1", label: "Team", target: { kind: "entryRef", entryId: "team-page" } },
        {
          id: "child-2",
          label: "Deleted Child",
          target: { kind: "entryRef", entryId: "deleted-child" },
        },
      ],
    },
  ]);

  const resolved = await resolveForLocation({
    deps: { menuRepo: repo, bindingRepo, resolveTargetHref: fakeResolveTargetHref },
    input: { workspaceId: "ws-1", locationKey: "primary" },
  });

  assert.ok(resolved);
  const parent = resolved.items[0]!;
  assert.equal(parent.children.length, 2);
  assert.equal(parent.children[0]!.available, true);
  assert.equal(parent.children[1]!.available, false);
  assert.equal(parent.children[1]!.href, null);
});

test("resolveForLocation resolves termRef targets to unavailable (Round-3 fold item 1: no term schema yet)", async () => {
  const { repo, bindingRepo } = await seedMenuBoundToLocation([
    {
      id: "item-1",
      label: "Category",
      target: { kind: "termRef", termId: "cat-1", taxonomy: "category" },
    },
  ]);

  const resolved = await resolveForLocation({
    deps: { menuRepo: repo, bindingRepo, resolveTargetHref: fakeResolveTargetHref },
    input: { workspaceId: "ws-1", locationKey: "primary" },
  });

  assert.ok(resolved);
  assert.equal(resolved.items[0]!.available, false);
  assert.equal(resolved.items[0]!.href, null);
});

test("resolveForLocation computes isCurrent/isActive against the current path", async () => {
  const { repo, bindingRepo } = await seedMenuBoundToLocation([
    { id: "item-1", label: "Home", target: { kind: "route", route: "home" } },
    { id: "item-2", label: "About", target: { kind: "entryRef", entryId: "about-page" } },
  ]);

  const resolved = await resolveForLocation({
    deps: { menuRepo: repo, bindingRepo, resolveTargetHref: fakeResolveTargetHref },
    input: { workspaceId: "ws-1", locationKey: "primary", currentPath: "/" },
  });

  assert.ok(resolved);
  assert.equal(resolved.items[0]!.isCurrent, true);
  assert.equal(resolved.items[0]!.isActive, true);
  assert.equal(resolved.items[1]!.isCurrent, false);
  assert.equal(resolved.items[1]!.isActive, false);
});
