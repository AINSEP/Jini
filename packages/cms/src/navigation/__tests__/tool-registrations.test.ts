import assert from "node:assert/strict";
import { test } from "vitest";

import type { ToolExecutionContext } from "@jini-ai/core";

import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo } from "../repo.memory.js";
import { buildMenusRegistrations, type MenusToolDeps } from "../tool-registrations.js";

/**
 * @file C4f (2026-09-24 leftovers pass, `fix-plan-jini-leftovers-2026-09-24.md`): `menus_create_menu`
 * silently treated a non-array `items` the same as an omitted one (`Array.isArray(input.items) ?
 * ... : undefined`), so a caller passing e.g. a JSON-encoded string for `items` got a menu created
 * with NO items at all instead of a rejection — success reported while doing the wrong thing.
 */

const WORKSPACE_ID = "ws-menus-tool-registrations";
const PRINCIPAL_ID = "principal-under-test";
const NOW = "2026-09-24T00:00:00.000Z";

function executionContext(input: Record<string, unknown>): ToolExecutionContext {
  return { executionId: "exec-1", principal: { id: PRINCIPAL_ID }, run: { id: "run-1" }, input, signal: new AbortController().signal };
}

function fakeDeps(): MenusToolDeps {
  let counter = 0;
  return {
    authorize: async () => ({ allowed: true, reason: "matched" }),
    workspaceId: WORKSPACE_ID,
    clock: { nowIso: () => NOW },
    idGen: { newId: () => `id-${++counter}` },
    outbox: { enqueue: async () => undefined, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
    menuRepo: new InMemoryMenuRepo(),
    navLocationBindingRepo: new InMemoryNavLocationBindingRepo(),
  };
}

test("menus_create_menu rejects a non-array items instead of silently creating a menu with no items", async () => {
  const deps = fakeDeps();
  const registrations = buildMenusRegistrations(deps);
  const create = registrations.find((r) => r.descriptor.id === "menus_create_menu");
  assert.ok(create, "menus_create_menu must be wired");

  await assert.rejects(
    () => create.handler(executionContext({ title: "Main", slug: "main", items: "[...]" })),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /'items' must be an array of nav items/);
      return true;
    }
  );

  const menus = await deps.menuRepo.list({ workspaceId: WORKSPACE_ID });
  assert.equal(menus.length, 0, "no menu must have been created");
});

test("menus_create_menu still accepts an omitted items and a real array", async () => {
  const deps = fakeDeps();
  const registrations = buildMenusRegistrations(deps);
  const create = registrations.find((r) => r.descriptor.id === "menus_create_menu");
  assert.ok(create);

  const omitted = (await create.handler(executionContext({ title: "Main", slug: "main" }))) as { menu: { items: unknown[] } };
  assert.deepEqual(omitted.menu.items, []);

  const withItems = (await create.handler(
    executionContext({ title: "Footer", slug: "footer", items: [{ id: "n1", label: "Home", target: { kind: "url", href: "/" } }] })
  )) as { menu: { items: unknown[] } };
  assert.equal(withItems.menu.items.length, 1);
});
