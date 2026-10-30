import assert from "node:assert/strict";
import { test } from "vitest";

import { normalizeToolInput, requireInputRecord, ToolInputError, ToolInputNormalizationError, type ToolExecutionContext, type ToolRegistration } from "@jini-ai/core";

import { menusAgentToolCatalog } from "../agent-tools.js";
import { MenuVersionConflictError } from "../menu-service.js";
import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo } from "../repo.memory.js";
import { buildMenusRegistrations, type MenusToolDeps } from "../tool-registrations.js";
import type { NavItemNode } from "../types.js";

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
    clock: { nowMs: () => Date.parse(NOW)},
    idGen: { newId: () => `id-${++counter}` },
    outbox: { enqueue: async () => undefined, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
    menuRepo: new InMemoryMenuRepo({}),
    navLocationBindingRepo: new InMemoryNavLocationBindingRepo({}),
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

/** Locate the real domain registration; keep alias tests on the published normalization seam. */
function registrationFor({ deps, toolId }: { deps: MenusToolDeps; toolId: string }): ToolRegistration {
  const registration = buildMenusRegistrations(deps).find((candidate) => candidate.descriptor.id === toolId);
  assert.ok(registration, `${toolId} must be wired`);
  return registration;
}

/** Seed via the existing create handler so tests exercise versioned service writes, not repo stubs. */
async function seededMenu({ deps }: { deps: MenusToolDeps }): Promise<string> {
  const create = registrationFor({ deps, toolId: "menus_create_menu" });
  const output = await create.handler(executionContext({ title: "Main", slug: "main" })) as { menu: { id: string } };
  return output.menu.id;
}

/** Exercise the same domain hook/schema normalization the executor uses, then the real handler. */
async function normalizedUpdate({ deps, input }: { deps: MenusToolDeps; input: unknown }): Promise<unknown> {
  const registration = registrationFor({ deps, toolId: "menus_update_menu_tree" });
  const normalized = await normalizeToolInput({ registration, input });
  return registration.handler(executionContext(requireInputRecord({ input: normalized.input })));
}

const REPLACEMENT_TREE: NavItemNode[] = [
  { id: "entry-link", label: "About", target: { kind: "entryRef", entryId: "page-about", entryType: "page", lastKnownHref: "/about" },
    children: [{ id: "child-link", label: "Contact", target: { kind: "url", href: "/contact" } }] },
  { id: "term-link", label: "News", target: { kind: "termRef", termId: "term-news", taxonomy: "category" } },
];

test("m1: direct handler callers cannot bypass conflicting menu target aliases", async () => {
  const deps = fakeDeps();
  const id = await seededMenu({ deps });
  const before = await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id });
  const update = registrationFor({ deps, toolId: "menus_update_menu_tree" });
  for (const selectors of [{ id, menuId: id }, { menuId: id, "menu-id": id }]) {
    await assert.rejects(update.handler(executionContext({ ...selectors, expectedVersion: 1, items: [] })), error => {
      assert.ok(error instanceof ToolInputError);
      assert.equal(error.message, "Conflicting inputs for the menu target. Send only 'id', not multiple id/menuId spellings.");
      return true;
    });
  }
  assert.deepEqual(await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id }), before);
});

test("only the update target publishes id; menu reader and assignment references retain their ABI", () => {
  const entry = menusAgentToolCatalog.find((tool) => tool.name === "menus_update_menu_tree");
  assert.ok(entry);
  const update = registrationFor({ deps: fakeDeps(), toolId: entry.name });
  assert.deepEqual(update.descriptor.inputSchema, entry.inputSchema);
  const schema = requireInputRecord({ input: update.descriptor.inputSchema });
  assert.deepEqual(schema.required, ["id", "expectedVersion"]);
  assert.equal(schema.additionalProperties, false);
  const properties = requireInputRecord({ input: schema.properties });
  assert.equal(requireInputRecord({ input: properties.id }).type, "string");
  assert.equal(Object.hasOwn(properties, "menuId"), false);

  const read = registrationFor({ deps: fakeDeps(), toolId: "menus_get_menu" });
  const assign = registrationFor({ deps: fakeDeps(), toolId: "menus_assign_location" });
  assert.deepEqual(requireInputRecord({ input: read.descriptor.inputSchema }).required, ["menuId"]);
  assert.deepEqual(requireInputRecord({ input: assign.descriptor.inputSchema }).required, ["menuId", "locationKey"]);
  assert.equal(read.normalizeInput, undefined);
  assert.equal(assign.normalizeInput, undefined);
});

test("canonical update normalization leaves the caller's input and nested target references intact", async () => {
  const registration = registrationFor({ deps: fakeDeps(), toolId: "menus_update_menu_tree" });
  assert.ok(registration.normalizeInput);
  const input = Object.freeze({ id: "private-menu-id", expectedVersion: 1, items: REPLACEMENT_TREE });
  assert.deepEqual(await registration.normalizeInput({ input }), { input, notes: [] });
  assert.deepEqual(await normalizeToolInput({ input, registration }), { input, notes: [] });
});

for (const alias of ["menuId", "menu_id", "menu-id", "MenuId"]) {
  test(`legacy ${alias} normalizes to id before closed-schema validation without disclosing values`, async () => {
    const registration = registrationFor({ deps: fakeDeps(), toolId: "menus_update_menu_tree" });
    const input = Object.freeze({ [alias]: "private-menu-id", expectedVersion: "1", items: [] });
    const result = await normalizeToolInput({ input, registration });
    assert.deepEqual(result.input, { id: "private-menu-id", expectedVersion: 1, items: [] });
    // Declared aliases rename first, then values coerce (core input aliases, 965f9a2b).
    assert.deepEqual(result.notes, [`${alias}→id`, "expectedVersion: string→integer"]);
    assert.deepEqual(input, { [alias]: "private-menu-id", expectedVersion: "1", items: [] });
    assert.equal(result.notes.join(" ").includes("private-menu-id"), false);
  });
}

test("agreeing alias values (id, menuId) coalesce and update the menu", async () => {
  const deps = fakeDeps();
  const id = await seededMenu({ deps });
  let authorizations = 0;
  deps.authorize = async () => { authorizations++; return { allowed: true, reason: "matched" }; };
  // Core intentionally coalesces agreeing aliases before the domain hook (c936b4a68).
  const output = await normalizedUpdate({ deps, input: { id, menuId: id, expectedVersion: 1, items: REPLACEMENT_TREE } }) as { menu: { id: string; version: number; items: NavItemNode[] } };
  assert.equal(output.menu.id, id);
  assert.equal(output.menu.version, 2);
  assert.deepEqual(output.menu.items, REPLACEMENT_TREE);
  assert.equal(authorizations, 1);
  const saved = await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id });
  assert.equal(saved?.version, 2);
});

for (const target of [
  { id: "private-menu-id", menuId: "other-private-id" },
  { menuId: "private-menu-id", id: "other-private-id" },
  { ID: "private-menu-id", menuId: "other-private-id" },
  { menuId: "private-menu-id", menu_id: "other-private-id" },
]) {
  test(`differing alias values (${Object.keys(target).join(", ")}) fail before authorization or mutation`, async () => {
    const deps = fakeDeps();
    const id = await seededMenu({ deps });
    let authorizations = 0;
    deps.authorize = async () => { authorizations++; return { allowed: true, reason: "matched" }; };
    await assert.rejects(() => normalizedUpdate({ deps, input: { ...target, expectedVersion: 1, items: [] } }), (error: unknown) => {
      assert.ok(error instanceof ToolInputNormalizationError);
      assert.match(error.message, /Conflicting inputs.*Send only 'id'/);
      assert.equal(error.message.includes("private-menu-id"), false);
      assert.equal(error.message.includes("other-private-id"), false);
      return true;
    });
    assert.equal(authorizations, 0);
    assert.equal((await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id }))?.version, 1);
  });
}

for (const selector of ["id", "menuId"]) {
  test(`${selector} updates the complete nested item tree and preserves legacy read and assignment calls`, async () => {
    const deps = fakeDeps();
    const id = await seededMenu({ deps });
    const output = await normalizedUpdate({ deps, input: { [selector]: id, expectedVersion: 1, items: REPLACEMENT_TREE, title: "Changed" } }) as { menu: { id: string; version: number; title: string; items: NavItemNode[] } };
    assert.equal(output.menu.id, id);
    assert.equal(output.menu.version, 2);
    assert.equal(output.menu.title, "Changed");
    assert.deepEqual(output.menu.items, REPLACEMENT_TREE);
    const read = registrationFor({ deps, toolId: "menus_get_menu" });
    assert.deepEqual(await read.handler(executionContext({ menuId: id })), output);
    const assign = registrationFor({ deps, toolId: "menus_assign_location" });
    const assigned = await assign.handler(executionContext({ menuId: id, locationKey: "primary" })) as { binding: unknown };
    assert.deepEqual(assigned.binding, { menuId: id, locationKey: "primary" });
  });

  test(`${selector} retains direct-handler compatibility`, async () => {
    const deps = fakeDeps();
    const id = await seededMenu({ deps });
    const update = registrationFor({ deps, toolId: "menus_update_menu_tree" });
    const result = await update.handler(executionContext({ [selector]: id, expectedVersion: 1, items: [] })) as { menu: { id: string; version: number } };
    assert.equal(result.menu.id, id);
    assert.equal(result.menu.version, 2);
  });

  test(`${selector} preserves expected-version conflicts without writes or events`, async () => {
    const deps = fakeDeps();
    const id = await seededMenu({ deps });
    await normalizedUpdate({ deps, input: { [selector]: id, expectedVersion: 1, items: REPLACEMENT_TREE } });
    const before = structuredClone(await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id }));
    let events = 0;
    deps.outbox.enqueue = async () => { events++; };
    await assert.rejects(() => normalizedUpdate({ deps, input: { [selector]: id, expectedVersion: 1, items: [], title: "Stale" } }), MenuVersionConflictError);
    const menu = await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id });
    assert.equal(menu?.version, 2);
    assert.equal(menu?.title, "Main");
    assert.deepEqual(menu, before);
    assert.equal(events, 0);
  });

  test(`${selector} preserves the principal, workspace and entity-scoped update permission`, async () => {
    const deps = fakeDeps();
    const id = await seededMenu({ deps });
    const calls: unknown[] = [];
    deps.authorize = async (request) => { calls.push(request); return { allowed: false, reason: "scope_denied" }; };
    await assert.rejects(() => normalizedUpdate({ deps, input: { [selector]: id, expectedVersion: 1, items: [] } }), /not authorized.*admin.menus.update.*scope_denied/);
    assert.deepEqual(calls, [{ workspaceId: WORKSPACE_ID, principalId: PRINCIPAL_ID, permission: "admin.menus.update", entityType: "menu", entityId: id }]);
    assert.equal((await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id }))?.version, 1);
  });

  test(`${selector} preserves the separate HTML permission before an HTML-only write`, async () => {
    const deps = fakeDeps();
    const id = await seededMenu({ deps });
    deps.rawHtmlPermission = "pages.edit_html";
    deps.normalizeMenuHtml = ({ html }) => html;
    const calls: unknown[] = [];
    deps.authorize = async (request) => {
      calls.push(request);
      return { allowed: request.permission !== "pages.edit_html", reason: "scope_denied" };
    };
    await assert.rejects(() => normalizedUpdate({ deps, input: { [selector]: id, expectedVersion: 1, mode: "html", html: "<p>Menu</p>" } }), /not authorized.*pages.edit_html/);
    assert.deepEqual(calls, ["admin.menus.update", "pages.edit_html"].map((permission) => ({ workspaceId: WORKSPACE_ID, principalId: PRINCIPAL_ID, permission, entityType: "menu", entityId: id })));
    assert.equal((await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id }))?.version, 1);
    deps.authorize = async () => ({ allowed: true, reason: "matched" });
    const output = await normalizedUpdate({ deps, input: { [selector]: id, expectedVersion: 1, mode: "html", html: "<p>Menu</p>" } }) as { menu: { mode: string; html: string; items: unknown[]; version: number } };
    assert.equal(output.menu.mode, "html");
    assert.equal(output.menu.html, "<p>Menu</p>");
    assert.deepEqual(output.menu.items, []);
    assert.equal(output.menu.version, 2);
  });

  test(`${selector} rejects duplicate ids across tree branches atomically`, async () => {
    const deps = fakeDeps();
    const id = await seededMenu({ deps });
    let events = 0;
    deps.outbox.enqueue = async () => { events++; };
    const items = [REPLACEMENT_TREE[0], { id: "child-link", target: { kind: "url", href: "/other" } }];
    await assert.rejects(() => normalizedUpdate({ deps, input: { [selector]: id, expectedVersion: 1, items } }), /duplicate.*child-link/i);
    const menu = await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id });
    assert.equal(menu?.version, 1);
    assert.deepEqual(menu?.doc.items, []);
    assert.equal(events, 0);
  });
}

test("invocation batches remain unsupported because items is the menu's tree, not a batch envelope", async () => {
  const deps = fakeDeps();
  const id = await seededMenu({ deps });
  await assert.rejects(() => normalizedUpdate({ deps, input: [{ id, expectedVersion: 1, items: [] }] }), /send one input object/i);
  await assert.rejects(() => normalizedUpdate({ deps, input: { items: [{ menuId: id, expectedVersion: 1, items: [] }] } }), /'id'.*required/i);
  assert.equal((await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id }))?.version, 1);
});

function handler(deps: MenusToolDeps, id: string): ToolRegistration["handler"] {
  const found = buildMenusRegistrations(deps).find((r) => r.descriptor.id === id);
  assert.ok(found, `${id} must be wired`);
  return found.handler;
}

test("menus_list_menus returns every menu of the workspace as a tool view", async () => {
  const deps = fakeDeps();
  await handler(deps, "menus_create_menu")(executionContext({ title: "Main", slug: "main" }));
  await handler(deps, "menus_create_menu")(executionContext({ title: "Footer", slug: "footer" }));
  const result = await handler(deps, "menus_list_menus")(executionContext({})) as { menus: Array<{ slug: string; title: string; items: unknown[]; locations: string[] }> };
  assert.deepEqual(result.menus.map(({ slug, title, items, locations }) => ({ slug, title, items, locations })).sort((a, b) => a.slug.localeCompare(b.slug)), [
    { slug: "footer", title: "Footer", items: [], locations: [] },
    { slug: "main", title: "Main", items: [], locations: [] },
  ]);
});

test("menus_get_menu names an unknown menu id instead of returning nothing", async () => {
  await assert.rejects(handler(fakeDeps(), "menus_get_menu")(executionContext({ menuId: "nope" })), /menu 'nope' was not found/);
});

test("menus_create_menu returns a domain validation failure with the tool's schema attached", async () => {
  const deps = fakeDeps();
  await assert.rejects(handler(deps, "menus_create_menu")(executionContext({ title: "Main", slug: "Not A Slug" })), /Schema for 'menus_create_menu'/);
  assert.deepEqual(await deps.menuRepo.list({ workspaceId: WORKSPACE_ID }), []);
});

test("menus_create_menu checks the host's raw-HTML permission, without an entity id, before creating an HTML menu", async () => {
  const checks: unknown[] = [];
  const deps: MenusToolDeps = {
    ...fakeDeps(), rawHtmlPermission: "pages.edit_html", normalizeMenuHtml: ({ html }) => html,
    authorize: async (request) => { checks.push(request); return { allowed: true, reason: "matched" }; },
  };
  const result = await handler(deps, "menus_create_menu")(executionContext({ title: "Main", slug: "main", mode: "html", html: "<nav></nav>" })) as { menu: { mode?: string; html?: string } };
  assert.deepEqual([result.menu.mode, result.menu.html], ["html", "<nav></nav>"]);
  const htmlCheck = checks.find((c) => (c as { permission?: string }).permission === "pages.edit_html") as Record<string, unknown> | undefined;
  assert.ok(htmlCheck, "the raw-HTML permission must be checked");
  assert.equal(htmlCheck.entityId, undefined);
});

test("menus_update_menu_tree rejects non-array items and applies a new slug", async () => {
  const deps = fakeDeps();
  const { menu } = await handler(deps, "menus_create_menu")(executionContext({ title: "Main", slug: "main" })) as { menu: { id: string; version: number } };
  const update = handler(deps, "menus_update_menu_tree");
  await assert.rejects(update(executionContext({ id: menu.id, expectedVersion: menu.version, items: "[]" })), /'items' must be an array of nav items/);
  const renamed = await update(executionContext({ id: menu.id, expectedVersion: menu.version, slug: "primary", items: [] })) as { menu: { slug: string } };
  assert.equal(renamed.menu.slug, "primary");
  assert.equal((await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id: menu.id }))?.slug, "primary");
});

test("menus_assign_location reports the menu it displaced from the location", async () => {
  const deps = fakeDeps();
  const create = handler(deps, "menus_create_menu");
  const first = await create(executionContext({ title: "Main", slug: "main" })) as { menu: { id: string } };
  const second = await create(executionContext({ title: "Alt", slug: "alt" })) as { menu: { id: string } };
  const assign = handler(deps, "menus_assign_location");
  const initial = await assign(executionContext({ menuId: first.menu.id, locationKey: "primary" })) as { displacedMenu: unknown };
  assert.equal(initial.displacedMenu, null);
  const swapped = await assign(executionContext({ menuId: second.menu.id, locationKey: "primary" })) as { binding: unknown; displacedMenu: { id: string; locations: string[] } | null };
  assert.deepEqual(swapped.binding, { locationKey: "primary", menuId: second.menu.id });
  assert.equal(swapped.displacedMenu?.id, first.menu.id);
  assert.deepEqual(swapped.displacedMenu?.locations, []);
});
