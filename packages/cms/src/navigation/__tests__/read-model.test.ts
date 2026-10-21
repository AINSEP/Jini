import assert from "node:assert/strict";
import { test } from "vitest";

import { assignLocation, createMenu } from "../menu-service.js";
import { createNavMenuReadModel } from "../read-model.js";
import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo } from "../repo.memory.js";
import { resolveForLocation, type ResolveTargetHrefFn } from "../resolver.js";

/** The read model is the host-facing query surface over the menu and location-binding ports. */

const outbox = { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} };

async function seed() {
  const repo = new InMemoryMenuRepo({});
  const bindingRepo = new InMemoryNavLocationBindingRepo({});
  let n = 0;
  const deps = { repo, bindingRepo, clock: { nowMs: () => Date.parse("2026-07-10T00:00:00.000Z") }, idGen: { newId: () => `id-${++n}` }, outbox };
  const { menu } = await createMenu({ deps, input: { workspaceId: "ws-1", title: "Primary", slug: "primary", items: [
    { id: "home", label: "Home", target: { kind: "route", route: "home" }, children: [] },
    { id: "docs", label: "Docs", target: { kind: "url", href: "https://docs.example" }, children: [] },
  ] } });
  await createMenu({ deps, input: { workspaceId: "ws-1", title: "Footer", slug: "footer", items: [] } });
  await assignLocation({ deps, input: { workspaceId: "ws-1", menuId: menu.id, locationKey: "primary" } });
  return { repo, bindingRepo, menu };
}

test("the read model looks menus up by id and slug and lists a workspace's menus", async () => {
  const { repo, bindingRepo, menu } = await seed();
  const model = createNavMenuReadModel({ menuRepo: repo, bindingRepo });
  assert.equal((await model.getMenu({ workspaceId: "ws-1", menuId: menu.id }))?.id, menu.id);
  assert.equal((await model.getMenuBySlug({ workspaceId: "ws-1", slug: "primary" }))?.id, menu.id);
  assert.equal(await model.getMenuBySlug({ workspaceId: "ws-2", slug: "primary" }), null);
  assert.deepEqual((await model.listMenus({ workspaceId: "ws-1" })).map((m) => m.slug).sort(), ["footer", "primary"]);
  assert.deepEqual(await model.listMenus({ workspaceId: "ws-2" }), []);
});

test("resolveForLocation without a host href resolver resolves exactly as the resolver does with the placeholder that knows no routes", async () => {
  const { repo, bindingRepo } = await seed();
  const model = createNavMenuReadModel({ menuRepo: repo, bindingRepo });
  const viaModel = await model.resolveForLocation({ context: { workspaceId: "ws-1", currentPath: "/" }, locationKey: "primary" });
  const direct = await resolveForLocation({ deps: { menuRepo: repo, bindingRepo, resolveTargetHref: async () => null }, input: { workspaceId: "ws-1", locationKey: "primary", currentPath: "/" } });
  assert.ok(viaModel);
  assert.deepEqual(viaModel, direct);
});

test("resolveForLocation uses the host's href resolver and current path when one is supplied", async () => {
  const { repo, bindingRepo } = await seed();
  const asked: string[] = [];
  const resolveTargetHref: ResolveTargetHrefFn = async ({ target }) => { asked.push(target.kind); return target.kind === "route" ? { path: "/", available: true } : null; };
  const model = createNavMenuReadModel({ menuRepo: repo, bindingRepo }, { resolveTargetHref });
  const resolved = await model.resolveForLocation({ context: { workspaceId: "ws-1", currentPath: "/" }, locationKey: "primary" });
  const direct = await resolveForLocation({ deps: { menuRepo: repo, bindingRepo, resolveTargetHref }, input: { workspaceId: "ws-1", locationKey: "primary", currentPath: "/" } });
  assert.deepEqual(resolved, direct);
  assert.ok(asked.includes("route"));
  assert.equal(await model.resolveForLocation({ context: { workspaceId: "ws-1", currentPath: "/" }, locationKey: "footer" }), null);
});

test("InMemoryNavLocationBindingRepo.remove unbinds only that workspace's location", async () => {
  const bindings = new InMemoryNavLocationBindingRepo({});
  for (const [workspaceId, locationKey] of [["ws-1", "primary"], ["ws-1", "footer"], ["ws-2", "primary"]] as const) {
    await bindings.upsert({ workspaceId, locationKey, menuId: `${workspaceId}-${locationKey}`, boundAt: "2026-07-10T00:00:00.000Z" });
  }
  await bindings.remove({ workspaceId: "ws-1", locationKey: "primary" });
  assert.equal(await bindings.findByLocation({ workspaceId: "ws-1", locationKey: "primary" }), null);
  assert.equal((await bindings.findByLocation({ workspaceId: "ws-1", locationKey: "footer" }))?.menuId, "ws-1-footer");
  assert.equal((await bindings.findByLocation({ workspaceId: "ws-2", locationKey: "primary" }))?.menuId, "ws-2-primary");
});
