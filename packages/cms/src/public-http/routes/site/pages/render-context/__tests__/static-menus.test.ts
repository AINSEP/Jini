import { expect, test } from "vitest";
import type { UUID } from "@jini-ai/core/primitives";
import type { NavTarget } from "../../../../../../navigation/index.js";
import {
  resolveStaticMenusForIds,
  type StaticMenuCollaborators,
  type StaticMenuRepoDeps,
  type StaticMenuReservedResolver,
} from "../static-menus.js";

type Menu = { id: string; slug: string; doc: { mode?: string; html?: string; label?: string } };

/** Fakes: `bound` is the location-binding table, `menus` the stored menus. */
function fixture({ bound = {}, menus = [], target = { kind: "route", route: "home" } }: { bound?: Record<string, Menu>; menus?: Menu[]; target?: NavTarget } = {}) {
  const urlForCalls: unknown[] = [];
  const deps = {
    workspaceId: "ws",
    menuRepo: {
      findBySlug: async ({ slug }: { slug: string }) => menus.find((m) => m.slug === slug) ?? null,
      findById: async ({ id }: { id: string }) => menus.find((m) => m.id === id) ?? null,
    },
    navLocationBindingRepo: {},
  } as unknown as StaticMenuRepoDeps;
  const collaborators = {
    navigation: {
      findBoundMenu: async ({ input }: { input: { locationKey: string } }) => bound[input.locationKey] ?? null,
      resolveMenuDoc: async ({ doc, context, resolveTargetHref }: { doc: Menu["doc"]; context: { currentPath: string }; resolveTargetHref: (r: { target: unknown; context: unknown }) => Promise<unknown> }) => {
        const href = await resolveTargetHref({ target, context });
        return [{ label: doc.label, href, currentPath: context.currentPath }];
      },
    },
    urlFor: async (required: unknown) => { urlForCalls.push(required); return { path: "/resolved" }; },
  } as unknown as StaticMenuCollaborators;
  return { deps, collaborators, urlForCalls };
}

const stored = (id: string, slug: string, label: string): Menu => ({ id, slug, doc: { label } });
const labelsOf = (value: unknown) => (value as Array<{ label: string }>).map((item) => item.label);

test("an empty id list resolves nothing without touching the collaborators", async () => {
  const f = fixture();
  expect(await resolveStaticMenusForIds({ deps: f.deps, menuIds: [], currentPath: "/", collaborators: f.collaborators })).toEqual({});
});

test("static-menu-binding-loses-to-slug: a bound menu wins over a menu whose slug matches the marker id", async () => {
  const f = fixture({ bound: { nav: stored("m-bound", "other", "Bound") }, menus: [stored("m-slug", "nav", "Slug")] });
  const out = await resolveStaticMenusForIds({ deps: f.deps, menuIds: ["nav"], currentPath: "/x", collaborators: f.collaborators });
  expect(labelsOf(out.nav)).toEqual(["Bound"]);
});

test("with no binding the marker falls back to slug, then to id; a miss leaves the id out of the map", async () => {
  const f = fixture({ menus: [stored("m1", "by-slug", "Slug"), stored("by-id", "other", "Id")] });
  const out = await resolveStaticMenusForIds({ deps: f.deps, menuIds: ["by-slug", "by-id", "missing"], currentPath: "/", collaborators: f.collaborators });
  expect(Object.keys(out).sort()).toEqual(["by-id", "by-slug"]);
  expect(labelsOf(out["by-slug"])).toEqual(["Slug"]);
  expect(labelsOf(out["by-id"])).toEqual(["Id"]);
});

test("an HTML-mode menu resolves to its authored markup, and the request path reaches the resolver", async () => {
  const f = fixture({ menus: [{ id: "h", slug: "h", doc: { mode: "html", html: "<nav>x</nav>" } }, stored("t", "t", "Tree")] });
  const out = await resolveStaticMenusForIds({ deps: f.deps, menuIds: ["h", "t"], currentPath: "/here", collaborators: f.collaborators });
  expect(out.h).toEqual({ html: "<nav>x</nav>" });
  expect(out.t).toEqual([{ label: "Tree", href: { path: "/resolved", available: true }, currentPath: "/here" }]);
});

test("a nav route target reaches urlFor as a routing route target", async () => {
  const f = fixture({ menus: [stored("t", "t", "Tree")] });
  await resolveStaticMenusForIds({ deps: f.deps, menuIds: ["t"], currentPath: "/", collaborators: f.collaborators });
  expect(f.urlForCalls).toEqual([{ target: { kind: "route", route: "home" } }]);
});

test("a reserved id is resolved by the host's resolver and never looked up as a stored menu", async () => {
  const f = fixture({ menus: [stored("reserved", "reserved", "Stored")] });
  const reserved = new Map<string, StaticMenuReservedResolver>([["reserved", async ({ menuId }) => [menuId, [{ id: "host-item" as UUID, label: "Host", href: null, available: true, isCurrent: false, isActive: false, children: [] }]]]]);
  const out = await resolveStaticMenusForIds({ deps: f.deps, menuIds: ["reserved"], currentPath: "/", collaborators: f.collaborators }, { reserved });
  expect(labelsOf(out.reserved)).toEqual(["Host"]);
});

test.each([
  { target: { kind: "entryRef", entryId: "entry-19", entryType: "page", lastKnownHref: "/old" }, routeTarget: { kind: "entryRef", entryId: "entry-19" } },
  { target: { kind: "termRef", termId: "term-3", taxonomy: "regions" }, routeTarget: { kind: "termRef", termId: "term-3", taxonomy: "regions" } },
  { target: { kind: "url", href: "https://example.test/reference" }, routeTarget: { kind: "url", href: "https://example.test/reference" } },
  { target: { kind: "route", route: "search", params: { q: "weather" } }, routeTarget: { kind: "route", route: "search", params: { q: "weather" } } },
] as const)("adapts a stored $target.kind navigation target to the route port", async ({ target, routeTarget }) => {
  const f = fixture({ menus: [stored("t", "primary", "Reference")], target });
  const resolved = await resolveStaticMenusForIds({ deps: f.deps, menuIds: ["primary"], currentPath: "/now", collaborators: f.collaborators });
  expect(f.urlForCalls).toEqual([{ target: routeTarget }]);
  expect(resolved).toEqual({ primary: [{ label: "Reference", href: { path: "/resolved", available: true }, currentPath: "/now" }] });
});
