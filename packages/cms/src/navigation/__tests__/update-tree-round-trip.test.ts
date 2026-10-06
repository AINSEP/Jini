import assert from "node:assert/strict";
import { test } from "vitest";

import type { OutboxPort } from "../../core/ports.js";
import { menusAgentToolCatalog } from "../agent-tools.js";
import { createMenu, updateMenuTree } from "../menu-service.js";
import { InMemoryMenuRepo } from "../repo.memory.js";
import type { NavItemNode } from "../types.js";

const outbox: OutboxPort = {
  enqueue: async () => {},
  claimPending: async () => [],
  markDelivered: async () => {},
  markFailed: async () => {},
};

function deps(repo: InMemoryMenuRepo) {
  let n = 0;
  return { repo, clock: { nowMs: () => Date.parse("2026-10-05T00:00:00.000Z") }, idGen: { newId: () => `id-${++n}` }, outbox };
}

const pageTarget = { kind: "entryRef" as const, entryId: "page-about", entryType: "page", lastKnownHref: "/about" };

async function seed(repo: InMemoryMenuRepo) {
  const { menu } = await createMenu({
    deps: deps(repo),
    input: {
      workspaceId: "ws-1",
      title: "Header",
      slug: "header",
      items: [{ id: "about", label: "About", target: pageTarget, children: [{ id: "team", label: "Team", target: { ...pageTarget, entryId: "page-team", lastKnownHref: "/team" } }] }],
    },
  });
  return menu;
}

// Dry run 2026-10-05: an assistant save of the header menu (it echoed the tree it read, minus the
// hint fields the published schema did not declare) dropped `entryType: "page"` from every page
// link, so the menu showed as changed-but-not-live although it rendered identically.
test("updateMenuTree keeps an untouched entry link's stored hints when the submitted target omits them", async () => {
  const repo = new InMemoryMenuRepo({});
  const menu = await seed(repo);

  const { menu: updated } = await updateMenuTree({
    deps: deps(repo),
    input: {
      workspaceId: "ws-1",
      id: menu.id,
      expectedVersion: menu.version,
      items: [
        { id: "about", label: "About", target: { kind: "entryRef", entryId: "page-about" }, children: [{ id: "team", label: "Team", target: { kind: "entryRef", entryId: "page-team" } }] },
        { id: "contact", label: "Contact", target: { kind: "entryRef", entryId: "page-contact", entryType: "page" } },
      ],
    },
  });

  const [about, contact] = updated.doc.items as NavItemNode[];
  assert.deepEqual(about?.target, pageTarget);
  assert.deepEqual(about?.children?.[0]?.target, { ...pageTarget, entryId: "page-team", lastKnownHref: "/team" });
  assert.deepEqual(contact?.target, { kind: "entryRef", entryId: "page-contact", entryType: "page" });
});

test("updateMenuTree does not carry hints onto a link re-pointed at a different entry, and submitted hints win", async () => {
  const repo = new InMemoryMenuRepo({});
  const menu = await seed(repo);

  const { menu: updated } = await updateMenuTree({
    deps: deps(repo),
    input: {
      workspaceId: "ws-1",
      id: menu.id,
      expectedVersion: menu.version,
      items: [
        { id: "about", label: "About", target: { kind: "entryRef", entryId: "post-1" } },
        { id: "team", label: "Team", target: { kind: "entryRef", entryId: "page-team", entryType: "post", lastKnownHref: "/blog/team" } },
      ],
    },
  });

  const [about, team] = updated.doc.items as NavItemNode[];
  assert.deepEqual(about?.target, { kind: "entryRef", entryId: "post-1" });
  assert.deepEqual(team?.target, { kind: "entryRef", entryId: "page-team", entryType: "post", lastKnownHref: "/blog/team" });
});

test("the published entryRef schema declares the stored hint fields, so a model can echo a read back unchanged", () => {
  const update = menusAgentToolCatalog.find((tool) => tool.name === "menus_update_menu_tree");
  const schema = update?.inputSchema as { properties: { items: { $defs: { navItem: { properties: { target: { oneOf: Array<{ properties: Record<string, unknown> }> } } } } } } };
  const entryRef = schema.properties.items.$defs.navItem.properties.target.oneOf.find((variant) => (variant.properties.kind as { const?: string }).const === "entryRef");
  assert.deepEqual(Object.keys(entryRef?.properties ?? {}).sort(), ["entryId", "entryType", "kind", "lastKnownHref"]);
});
