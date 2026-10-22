import { resolveMenuDoc } from "../../../navigation/index.js";
import assert from "node:assert/strict";
import test from "../support/test-runner.js";

import type { NavMenuEntry, NavMenuReadModel } from "../../../navigation/index.js";
import {
  createCoreResolvers,
  registerCoreResolver,
  resolveWidgetType,
  wireCoreResolvers,
  type CoreResolverDeps,
} from "../../resolvers/index.js";
import type { WidgetInstanceView, WidgetResolveContext } from "../../types.js";

/**
 * @file The resolver dispatch's composition seam — `createCoreResolvers`/`wireCoreResolvers` turning
 * injected ports into the closed resolver map — and the `resolveWidgetType` outcomes that only exist
 * at that seam: an empty batch, a dynamic type whose resolver was never wired, and a resolver that
 * silently drops an instance from its result. Each test file runs in its own module instance, so the
 * map starts empty here.
 */

const CTX: WidgetResolveContext = { workspaceId: "ws-1", preview: false };
const unexpected = async (): Promise<never> => { throw new Error("unexpected call"); };

const MENU: NavMenuEntry = {
  id: "menu-1", workspaceId: "ws-1", slug: "main", title: "Main", status: "published", locations: [], updatedAt: "2026-09-29T00:00:00Z", version: 1,
  doc: { type: "menu", version: 1, items: [{ id: "about", label: "About", target: { kind: "entryRef", entryId: "entry-about" } }] },
};

function deps(overrides: Partial<CoreResolverDeps> = {}): CoreResolverDeps {
  return {
    menus: { resolveMenuDoc },
    navMenuReadModel: { getMenu: async () => MENU, getMenuBySlug: unexpected, listMenus: unexpected, resolveForLocation: unexpected } satisfies NavMenuReadModel,
    collectionList: {
      parseCollectionListConfig: () => ({ ok: false, reason: "unused" }),
      entryPublicHref: () => null,
      humanizeFieldName: (name) => name,
      isCollectionListLayout: (value: unknown): value is "list" => value === "list",
      systemContentTypes: [],
    },
    entryList: { listByWorkspace: unexpected, listPublishedForDisplay: unexpected, listByWorkspaceExcludingTypes: async () => [] },
    formDefinitionRepo: { findById: async () => null, findBySlug: async () => null },
    contentTypes: { findByKey: async () => null },
    ...overrides,
  };
}

const menuWidget: WidgetInstanceView = { id: "w-menu", widgetType: "menu", config: { menuRef: "menu-1" } };
const galleryWidget: WidgetInstanceView = { id: "w-gallery", widgetType: "gallery", config: { images: [{ mediaId: "m1" }], layout: "grid" } };

test("an empty batch resolves to an empty map without touching any resolver", async () => {
  const results = await resolveWidgetType({ typeKey: "menu", instances: [], context: CTX });
  assert.equal(results.size, 0);
});

test("a dynamic type is a resolver-error until wireCoreResolvers registers it, then resolves through the injected ports", async () => {
  assert.deepEqual((await resolveWidgetType({ typeKey: "menu", instances: [menuWidget], context: CTX })).get("w-menu"), { ok: false, reason: "resolver-error" });

  const targets: unknown[] = [];
  wireCoreResolvers(deps({ resolveMenuTargetHref: async ({ target }) => { targets.push(target); return { path: "/about", available: true }; } }));
  const wired = (await resolveWidgetType({ typeKey: "menu", instances: [menuWidget], context: CTX })).get("w-menu");

  assert.deepEqual(wired, {
    ok: true,
    ir: { componentId: "menu", props: { title: "Main", items: [{ id: "about", label: "About", href: "/about", available: true, isCurrent: false, isActive: false, attrs: undefined, children: [] }] } },
    dependencyKeys: ["menu-1"],
  });
  assert.deepEqual(targets, [{ kind: "entryRef", entryId: "entry-about" }]);
});

test("createCoreResolvers builds exactly the four dynamic v1 resolvers", () => {
  assert.deepEqual(Object.keys(createCoreResolvers(deps())).sort(), ["contact-form", "gallery", "menu", "recent-entries"]);
});

test("without an injected menu target resolver, public menus prune entry-ref items they cannot route", async () => {
  const menu = createCoreResolvers(deps()).menu!;
  const result = (await menu.resolveMany([menuWidget], CTX)).get("w-menu");
  assert.deepEqual(result, { ok: true, ir: { componentId: "menu", props: { title: "Main", items: [] } }, dependencyKeys: ["menu-1"] });
});

test("an absent galleryMedia port behaves exactly like a media port that knows no assets", async () => {
  const withoutPort = await createCoreResolvers(deps()).gallery!.resolveMany([galleryWidget], CTX);
  const lookups: unknown[] = [];
  const withEmptyPort = await createCoreResolvers(deps({ galleryMedia: async ({ refs }) => { lookups.push(refs.length); return new Map(); } })).gallery!.resolveMany([galleryWidget], CTX);

  assert.deepEqual(withoutPort, withEmptyPort);
  assert.deepEqual(lookups, [1]);
});

test("a resolver that drops an instance from its result yields resolver-error for that instance only", async () => {
  registerCoreResolver({
    typeKey: "contact-form",
    resolver: {
      async resolveMany(instances) {
        const first = instances[0]!;
        return new Map([[first.id, { ok: true as const, ir: { componentId: "contact-form", props: {} }, dependencyKeys: [first.id] }]]);
      },
    },
  });
  const results = await resolveWidgetType({
    typeKey: "contact-form",
    instances: [{ id: "kept", widgetType: "contact-form", config: {} }, { id: "dropped", widgetType: "contact-form", config: {} }],
    context: CTX,
  });

  assert.equal(results.get("kept")?.ok, true);
  assert.deepEqual(results.get("dropped"), { ok: false, reason: "resolver-error" });
});

test("an injected siteTimeZone reaches recent-entries date labels (Bug D); without one they stay UTC", async () => {
  const row = {
    id: "e1", workspaceId: "ws-1", type: "post", slug: "e1", status: "published" as const, title: "E1", bodyJson: null, fieldsJson: null,
    publishedAt: "2026-03-04T07:30:00.000Z", createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-04T07:30:00.000Z", version: 1,
  };
  const entryList = { listByWorkspace: unexpected, listPublishedForDisplay: unexpected, listByWorkspaceExcludingTypes: async () => [row] };
  const widget: WidgetInstanceView = { id: "w-recent", widgetType: "recent-entries", config: {} };
  const label = async (overrides: Partial<CoreResolverDeps>) => {
    const result = (await createCoreResolvers(deps({ entryList, ...overrides }))["recent-entries"]!.resolveMany([widget], CTX)).get("w-recent");
    assert.ok(result?.ok);
    return result.ir.children![0]!.props.dateLabel;
  };
  assert.equal(await label({ siteTimeZone: { resolveTimeZone: async () => "America/Los_Angeles" } }), "Mar 3, 2026");
  assert.equal(await label({}), "Mar 4, 2026");
});
