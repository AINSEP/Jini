import assert from "node:assert/strict";
import { test } from "vitest";

import type { ToolExecutionContext } from "@jini-ai/core";

import type { OutboxPort } from "../../core/ports.js";
import { menusAgentToolCatalog } from "../agent-tools.js";
import { MAX_MENU_HTML_LENGTH } from "../menu-html.js";
import { createMenu, MenuValidationError, updateMenuTree } from "../menu-service.js";
import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo } from "../repo.memory.js";
import { buildMenusRegistrations, type MenusToolDeps } from "../tool-registrations.js";

/**
 * @file Menu HTML mode (owner 2026-10-08): a menu stores author-written HTML beside its item tree,
 * mirroring HTML-mode forms — trusted markup behind the host's raw-HTML permission, normalized on save,
 * and switching mode never destroys the other mode's data.
 */

const outbox: OutboxPort = { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} };
const WS = "ws-1";
const item = { id: "home", label: "Home", target: { kind: "url" as const, href: "/" } };

function deps(repo: InMemoryMenuRepo) {
  let n = 0;
  return { repo, clock: { nowMs: () => Date.parse("2026-10-08T00:00:00.000Z") }, idGen: { newId: () => `id-${++n}` }, outbox };
}

async function seed(repo: InMemoryMenuRepo, extra: { mode?: "items" | "html"; html?: string } = {}) {
  return (await createMenu({ deps: deps(repo), input: { workspaceId: WS, title: "Header", slug: "header", items: [item], ...extra } })).menu;
}

test("a menu that never used HTML mode stores no mode/html keys", async () => {
  const menu = await seed(new InMemoryMenuRepo({}));
  assert.deepEqual(Object.keys(menu.doc).sort(), ["items", "type", "version"]);
});

test("createMenu stores mode and normalized html", async () => {
  const menu = await seed(new InMemoryMenuRepo({}), { mode: "html", html: "<ul><li><a href='/'>Home</a></ul>" });
  assert.equal(menu.doc.mode, "html");
  assert.equal(menu.doc.html, '<ul><li><a href="/">Home</a></li></ul>');
  assert.equal(menu.doc.items.length, 1);
});

test("updateMenuTree with only html keeps the stored items", async () => {
  const repo = new InMemoryMenuRepo({});
  const menu = await seed(repo);
  const { menu: updated } = await updateMenuTree({ deps: deps(repo), input: { workspaceId: WS, id: menu.id, expectedVersion: 1, mode: "html", html: "<p>Hi</p>" } });
  assert.equal(updated.doc.mode, "html");
  assert.equal(updated.doc.html, "<p>Hi</p>");
  assert.deepEqual(updated.doc.items, menu.doc.items);
});

test("an items-only save keeps the stored mode and html (other repo writers never drop them)", async () => {
  const repo = new InMemoryMenuRepo({});
  const menu = await seed(repo, { mode: "html", html: "<p>Hi</p>" });
  const { menu: updated } = await updateMenuTree({ deps: deps(repo), input: { workspaceId: WS, id: menu.id, expectedVersion: 1, items: [] } });
  assert.equal(updated.doc.mode, "html");
  assert.equal(updated.doc.html, "<p>Hi</p>");
  assert.deepEqual(updated.doc.items, []);
});

test("switching back to items keeps the html for a later switch", async () => {
  const repo = new InMemoryMenuRepo({});
  const menu = await seed(repo, { mode: "html", html: "<p>Hi</p>" });
  const { menu: updated } = await updateMenuTree({ deps: deps(repo), input: { workspaceId: WS, id: menu.id, expectedVersion: 1, items: [item], mode: "items" } });
  assert.equal(updated.doc.mode, "items");
  assert.equal(updated.doc.html, "<p>Hi</p>");
});

test("stray closing tags cannot escape the fragment; scripts stay (trusted markup, like forms)", async () => {
  const menu = await seed(new InMemoryMenuRepo({}), { mode: "html", html: "<ul><li>A</nav></body></html><div><script>x()</script>" });
  assert.equal(menu.doc.html, "<ul><li>A<div><script>x()</script></div></li></ul>");
});

test("an unknown mode and oversized html are validation errors", async () => {
  const repo = new InMemoryMenuRepo({});
  const menu = await seed(repo);
  await assert.rejects(
    () => updateMenuTree({ deps: deps(repo), input: { workspaceId: WS, id: menu.id, expectedVersion: 1, mode: "tree" as never } }),
    (err: unknown) => err instanceof MenuValidationError && /mode must be 'items' or 'html'/.test(err.message),
  );
  await assert.rejects(
    () => updateMenuTree({ deps: deps(repo), input: { workspaceId: WS, id: menu.id, expectedVersion: 1, html: "x".repeat(MAX_MENU_HTML_LENGTH + 1) } }),
    (err: unknown) => err instanceof MenuValidationError && /html must be a string of at most 200000 characters/.test(err.message),
  );
});

function ctx(input: Record<string, unknown>): ToolExecutionContext {
  return { executionId: "exec-1", principal: { id: "p1" }, run: { id: "run-1" }, input, signal: new AbortController().signal };
}

function toolDeps(denied: readonly string[] = [], extra: Partial<MenusToolDeps> = {}): MenusToolDeps & { asked: string[] } {
  let n = 0;
  const asked: string[] = [];
  return {
    asked,
    authorize: async ({ permission }) => { asked.push(permission); return denied.includes(permission) ? { allowed: false, reason: "no_grant" } : { allowed: true, reason: "matched" }; },
    workspaceId: WS,
    clock: { nowMs: () => Date.parse("2026-10-08T00:00:00.000Z") },
    idGen: { newId: () => `id-${++n}` },
    outbox,
    menuRepo: new InMemoryMenuRepo({}),
    navLocationBindingRepo: new InMemoryNavLocationBindingRepo({}),
    rawHtmlPermission: "pages.edit_html",
    ...extra,
  };
}

function tool(d: MenusToolDeps, id: string) {
  const found = buildMenusRegistrations(d).find((r) => r.descriptor.id === id);
  assert.ok(found, `${id} must be wired`);
  return found;
}

test("menus_update_menu_tree accepts html without items and returns mode/html in the view", async () => {
  const d = toolDeps();
  const created = (await tool(d, "menus_create_menu").handler(ctx({ title: "Header", slug: "header", items: [item] }))) as { menu: { id: string } };
  const out = (await tool(d, "menus_update_menu_tree").handler(ctx({ menuId: created.menu.id, expectedVersion: 1, mode: "html", html: "<p>Hi</p>" }))) as {
    menu: { mode?: string; html?: string; items: unknown[] };
  };
  assert.equal(out.menu.mode, "html");
  assert.equal(out.menu.html, "<p>Hi</p>");
  assert.equal(out.menu.items.length, 1);
  assert.ok(d.asked.includes("pages.edit_html"), "html authoring must check the host's raw-HTML permission");
});

test("menus_update_menu_tree without the raw-HTML permission rejects and leaves the menu unchanged", async () => {
  const d = toolDeps(["pages.edit_html"]);
  const created = (await tool(d, "menus_create_menu").handler(ctx({ title: "Header", slug: "header" }))) as { menu: { id: string } };
  await assert.rejects(
    () => tool(d, "menus_update_menu_tree").handler(ctx({ menuId: created.menu.id, expectedVersion: 1, html: "<p>Hi</p>" })),
    /not authorized for 'pages.edit_html'/,
  );
  const stored = await d.menuRepo.findById({ workspaceId: WS, id: created.menu.id });
  assert.equal(stored?.doc.html, undefined);
  assert.equal(stored?.version, 1);
});

test("menus_create_menu with html is refused when the host configured no raw-HTML permission", async () => {
  const d = toolDeps([], { rawHtmlPermission: undefined });
  await assert.rejects(() => tool(d, "menus_create_menu").handler(ctx({ title: "Header", slug: "header", mode: "html", html: "<p>x</p>" })), /HTML menus are not enabled/);
});

test("switching a menu back to items needs no raw-HTML permission", async () => {
  const d = toolDeps(["pages.edit_html"]);
  const created = (await tool(d, "menus_create_menu").handler(ctx({ title: "Header", slug: "header", items: [item] }))) as { menu: { id: string } };
  const out = (await tool(d, "menus_update_menu_tree").handler(ctx({ menuId: created.menu.id, expectedVersion: 1, mode: "items" }))) as { menu: { mode?: string } };
  assert.equal(out.menu.mode, "items");
});

test("menus_update_menu_tree requires items, html or mode", async () => {
  const d = toolDeps();
  const created = (await tool(d, "menus_create_menu").handler(ctx({ title: "Header", slug: "header" }))) as { menu: { id: string } };
  await assert.rejects(() => tool(d, "menus_update_menu_tree").handler(ctx({ menuId: created.menu.id, expectedVersion: 1 })), /'items' \(array\), 'html' or 'mode' is required/);
});

test("the published create/update schemas declare mode and html, and update no longer requires items", () => {
  for (const name of ["menus_create_menu", "menus_update_menu_tree"]) {
    const schema = menusAgentToolCatalog.find((t) => t.name === name)?.inputSchema as { properties: Record<string, { enum?: string[]; type?: string }>; required: string[] };
    assert.deepEqual(schema.properties.mode?.enum, ["items", "html"], name);
    assert.equal(schema.properties.html?.type, "string", name);
  }
  const update = menusAgentToolCatalog.find((t) => t.name === "menus_update_menu_tree")?.inputSchema as { required: string[] };
  assert.deepEqual(update.required, ["menuId", "expectedVersion"]);
});
