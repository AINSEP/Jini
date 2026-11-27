import { webcrypto } from "node:crypto";
import { resolveMenuDoc } from "../../../navigation/index.js";
import { createFormCollectionRegistry } from "../../../core/form-collection.js";
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
    crypto: webcrypto,
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

test("unregister removes a resolver and calling it again leaves a later registration alone", async () => {
  const resolver = createCoreResolvers(deps()).menu!;
  const input = { typeKey: "menu", instances: [menuWidget], context: CTX } as const;
  const expected = { ok: true, ir: { componentId: "menu", props: { title: "Main", items: [] } }, dependencyKeys: ["menu-1"] };
  const unregister = registerCoreResolver({ typeKey: "menu", resolver });
  try {
    assert.deepEqual((await resolveWidgetType(input)).get("w-menu"), expected);
    unregister();
    assert.deepEqual((await resolveWidgetType(input)).get("w-menu"), { ok: false, reason: "resolver-error" });
    const unregisterAgain = registerCoreResolver({ typeKey: "menu", resolver });
    try {
      unregister();
      assert.deepEqual((await resolveWidgetType(input)).get("w-menu"), expected);
    } finally { unregisterAgain(); }
  } finally { unregister(); }
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

test("the assembled contact form resolver exposes a host provider plan and its explicit consent policy", async () => {
  const providers = createFormCollectionRegistry({});
  const collectionPlan = { kind: "post" as const, action: "https://forms.example.test/contact", external: true,
    capabilities: { answers: "Provider inbox", validation: "Provider validation", spamProtection: "Provider filtering" } };
  providers.contribute({ pluginId: "test-collector", definition: { id: "collector", provider: { plan: () => collectionPlan } } });
  const form = { id: "form-id", slug: "contact", status: "active", fields: [], provider: { id: "collector", config: {} } } as const;
  const formDefinitionRepo = { findById: async () => ({ ...form, fields: [] }), findBySlug: unexpected };
  const widget: WidgetInstanceView = { id: "w-form", widgetType: "contact-form", config: { formDefinitionId: "form-id" } };
  const wired = createCoreResolvers(deps({ formDefinitionRepo, formCollectionProviders: () => providers, formEmbedConsentOff: () => true }))["contact-form"]!;
  assert.deepEqual((await wired.resolveMany([widget], CTX)).get("w-form"), {
    ok: true, ir: { componentId: "contact-form", props: { formDefinitionId: "form-id", slug: "contact", fields: [], collectionPlan, collectionConsentOff: true, successMessage: null } }, dependencyKeys: ["form-id"],
  });
  const unwired = createCoreResolvers(deps({ formDefinitionRepo }))["contact-form"]!;
  assert.deepEqual((await unwired.resolveMany([widget], CTX)).get("w-form"), {
    ok: true, ir: { componentId: "contact-form", props: { formDefinitionId: "form-id", slug: "contact", fields: [], collectionPlan: { kind: "unavailable", code: "provider_unavailable", message: "This form cannot send answers because its collector form provider is unavailable." }, successMessage: null } }, dependencyKeys: ["form-id"],
  });
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
