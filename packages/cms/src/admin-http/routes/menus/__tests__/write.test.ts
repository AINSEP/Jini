import { describe, expect, it } from "vitest";
import { EntityNotLiveError } from "../../../../core/entity-liveness.js";
import { MenuVersionConflictError } from "../../../../navigation/menu-service.js";
import { trashMenu } from "../../../../navigation/site/trash-menu.js";
import { menuAssignLocationRoute } from "../assign-location.js";
import { menuCreateRoute } from "../create.js";
import { menuDeleteRoute } from "../delete.js";
import { menuUpdateTreeRoute } from "../update-tree.js";
import { makeMenuDeps, PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const ITEM = { id: "i-1", label: "Home", target: { kind: "url" as const, href: "/" } };
const allow = () => recordingAuthorize().authorize;

async function created(deps = makeMenuDeps(), slug = "main") {
  const result = await menuCreateRoute.handle({ input: { title: "Main", slug, items: [ITEM], authoring: {} }, deps, context: PRINCIPAL, authorize: allow() }, { signal });
  if (!result.ok) throw new Error("expected success");
  return { deps, menu: result.value.menu };
}

describe("menuCreateRoute", () => {
  it("parses the body, defaulting absent fields, and refuses a non-array items with the flat 400", async () => {
    expect([menuCreateRoute.method, menuCreateRoute.path, menuCreateRoute.successStatus]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/menus", 201]);
    expect(menuCreateRoute.parse(raw({}))).toEqual({ ok: true, value: { title: "", slug: "", items: undefined, authoring: {} } });
    expect(menuCreateRoute.parse(raw({}, { title: "T", slug: "s", items: [], mode: "html", html: "<a>x</a>", other: 1 })))
      .toEqual({ ok: true, value: { title: "T", slug: "s", items: [], authoring: { mode: "html", html: "<a>x</a>" } } });
    expect(await refusalOf(() => menuCreateRoute.parse(raw({}, { items: "nope" })))).toEqual({ status: 400, body: { error: "items must be an array" } });
  });

  it("authorizes create (no entity id) and answers the new menu", async () => {
    const { authorize, calls } = recordingAuthorize();
    const deps = makeMenuDeps();
    const result = await menuCreateRoute.handle({ input: { title: "Main", slug: "main", items: [ITEM], authoring: {} }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.create", entityType: "menu" }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.menu).toMatchObject({ workspaceId: WORKSPACE_ID, slug: "main", title: "Main", version: 1, items: [{ id: "i-1" }] });
  });

  it("asks for the raw-HTML permission on an HTML write and normalizes through the injected normalizer", async () => {
    const { authorize, calls } = recordingAuthorize();
    const result = await menuCreateRoute.handle({ input: { title: "H", slug: "h", items: undefined, authoring: { mode: "html", html: "<b>y</b>" } }, deps: makeMenuDeps(), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.create", entityType: "menu" }, { permission: "pages.edit_html", entityType: "menu" }]);
    expect(result.ok && result.value.menu.html).toBe("<!--n--><b>y</b>");
  });

  it("maps validation to a code-less 400 and a slug clash to a code-less 409; others pass through", async () => {
    expect(await refusalOf(() => menuCreateRoute.handle({ input: { title: "", slug: "x", items: undefined, authoring: {} }, deps: makeMenuDeps(), context: PRINCIPAL, authorize: allow() }, { signal })))
      .toEqual({ status: 400, body: { error: "title is required" } });
    const { deps } = await created();
    const clash = await refusalOf(() => menuCreateRoute.handle({ input: { title: "Again", slug: "main", items: undefined, authoring: {} }, deps, context: PRINCIPAL, authorize: allow() }, { signal }));
    expect(clash.status).toBe(409);
    expect(Object.keys(clash.body as object)).toEqual(["error"]);
    deps.menuRepo.save = async () => { throw new Error("db down"); };
    await expect(menuCreateRoute.handle({ input: { title: "N", slug: "n", items: undefined, authoring: {} }, deps, context: PRINCIPAL, authorize: allow() }, { signal })).rejects.toThrow("db down");
  });
});

describe("menuUpdateTreeRoute", () => {
  it("parses the PUT body: items required unless an HTML-only write", async () => {
    expect([menuUpdateTreeRoute.method, menuUpdateTreeRoute.path]).toEqual(["put", "/api/admin/v1/workspaces/:workspaceId/menus/:menuId"]);
    expect(await refusalOf(() => menuUpdateTreeRoute.parse(raw({ menuId: "m" }, {})))).toEqual({ status: 400, body: { error: "items must be an array" } });
    expect(menuUpdateTreeRoute.parse(raw({ menuId: "m" }, { html: "<a>x</a>", expectedVersion: "2", title: 5 })))
      .toEqual({ ok: true, value: { menuId: "m", items: undefined, authoring: { html: "<a>x</a>" }, expectedVersion: 2, title: undefined, slug: undefined } });
    expect(menuUpdateTreeRoute.parse(raw({}, { items: [] }))).toMatchObject({ ok: true, value: { menuId: "", expectedVersion: 0 } });
  });

  it("authorizes update for the menu, plus raw HTML for an HTML write, and answers the new version", async () => {
    const { deps, menu } = await created();
    const { authorize, calls } = recordingAuthorize();
    const result = await menuUpdateTreeRoute.handle({ input: { menuId: menu.id, items: undefined, expectedVersion: 1, title: "Renamed", slug: undefined, authoring: { mode: "html", html: "<i>z</i>" } }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.update", entityType: "menu", entityId: menu.id }, { permission: "pages.edit_html", entityType: "menu", entityId: menu.id }]);
    expect(result.ok && [result.value.menu.title, result.value.menu.version, result.value.menu.html]).toEqual(["Renamed", 2, "<!--n--><i>z</i>"]);
  });

  it("maps a lost compare-and-set to VERSION_CONFLICT, a missing menu to 404, a trashed one to its not-live 409", async () => {
    const { deps, menu } = await created();
    const input = { menuId: menu.id, items: [ITEM], expectedVersion: 9, title: undefined, slug: undefined, authoring: {} };
    const stale = await refusalOf(() => menuUpdateTreeRoute.handle({ input, deps, context: PRINCIPAL, authorize: allow() }, { signal }));
    expect(stale).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    expect(await refusalOf(() => menuUpdateTreeRoute.handle({ input: { ...input, menuId: "nope" }, deps, context: PRINCIPAL, authorize: allow() }, { signal })))
      .toMatchObject({ status: 404, body: { error: expect.stringContaining("nope") } });
    const notLive = new EntityNotLiveError({ entityType: "menu", entityId: menu.id, state: "trashed" });
    deps.menuRepo.findById = async () => { throw notLive; };
    expect(await refusalOf(() => menuUpdateTreeRoute.handle({ input, deps, context: PRINCIPAL, authorize: allow() }, { signal })))
      .toEqual({ status: 409, body: { error: notLive.message, code: notLive.code } });
  });
});

describe("menuAssignLocationRoute", () => {
  it("parses and trims the location key; a blank one is the flat 400", async () => {
    expect([menuAssignLocationRoute.method, menuAssignLocationRoute.path]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/menus/:menuId/locations"]);
    expect(menuAssignLocationRoute.parse(raw({ menuId: "m" }, { locationKey: " primary " }))).toEqual({ ok: true, value: { menuId: "m", locationKey: "primary" } });
    expect(await refusalOf(() => menuAssignLocationRoute.parse(raw({ menuId: "m" }, { locationKey: "  " })))).toEqual({ status: 400, body: { error: "locationKey is required" } });
    expect(await refusalOf(() => menuAssignLocationRoute.parse(raw({ menuId: "m" })))).toEqual({ status: 400, body: { error: "locationKey is required" } });
  });

  it("binds the location, reporting the displaced menu", async () => {
    const { deps, menu: first } = await created();
    const { menu: second } = await created(deps, "second");
    const { authorize, calls } = recordingAuthorize();
    await menuAssignLocationRoute.handle({ input: { menuId: first.id, locationKey: "primary" }, deps, context: PRINCIPAL, authorize }, { signal });
    const result = await menuAssignLocationRoute.handle({ input: { menuId: second.id, locationKey: "primary" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls[0]).toEqual({ permission: "admin.menus.assign", entityType: "menu", entityId: first.id });
    if (!result.ok) throw new Error("expected success");
    expect(result.value.binding).toMatchObject({ workspaceId: WORKSPACE_ID, locationKey: "primary", menuId: second.id });
    expect(result.value.displacedMenu?.id).toBe(first.id);
  });

  it("maps not-found to a code-less 404 and a lost compare-and-set to VERSION_CONFLICT", async () => {
    const deps = makeMenuDeps();
    expect(await refusalOf(() => menuAssignLocationRoute.handle({ input: { menuId: "nope", locationKey: "primary" }, deps, context: PRINCIPAL, authorize: allow() }, { signal })))
      .toEqual({ status: 404, body: { error: "menu 'nope' was not found" } });
    const { menu } = await created(deps);
    deps.menuRepo.save = async () => { throw new MenuVersionConflictError({ message: "lost" }); };
    expect(await refusalOf(() => menuAssignLocationRoute.handle({ input: { menuId: menu.id, locationKey: "primary" }, deps, context: PRINCIPAL, authorize: allow() }, { signal })))
      .toEqual({ status: 409, body: { error: "lost", code: "VERSION_CONFLICT" } });
  });
});

describe("menuDeleteRoute", () => {
  /** The host mount's `trashMenu` port: its repo, remove operation and clock closed over the real `trashMenu`. */
  const trashDeps = (deps: ReturnType<typeof makeMenuDeps>, remove: Parameters<typeof trashMenu>[1]["remove"]) => ({
    workspaceId: deps.workspaceId, outwardErrorMessage: deps.outwardErrorMessage,
    trashMenu: (input: Parameters<typeof trashMenu>[0]) => trashMenu(input, { menuRepo: deps.menuRepo, remove, clock: deps.clock }),
  });
  const removed = (outcome: { ok: true; version: number | null } | { ok: false; reason: "not-found" | "version-changed" }) => {
    const calls: unknown[] = [];
    return { calls, remove: async (input: unknown) => { calls.push(input); return outcome; } };
  };

  it("trashes the menu as the principal and answers the trash envelope", async () => {
    expect([menuDeleteRoute.method, menuDeleteRoute.path]).toEqual(["delete", "/api/admin/v1/workspaces/:workspaceId/menus/:menuId"]);
    expect(menuDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { menuId: "" } });
    const { deps, menu } = await created();
    const { remove, calls: removals } = removed({ ok: true, version: 2 });
    const { authorize, calls } = recordingAuthorize();
    const result = await menuDeleteRoute.handle({ input: { menuId: menu.id }, deps: trashDeps(deps, remove), context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.delete", entityType: "menu", entityId: menu.id }]);
    expect(result).toEqual({ ok: true, value: { trashed: true, id: menu.id, version: 2 } });
    expect(removals).toMatchObject([{ id: menu.id, expectedVersion: 1, actor: { principalId: PRINCIPAL.id }, at: "2026-07-10T00:00:00.000Z" }]);
  });

  it("maps a missing menu to 404 and a concurrent change to a code-less 409", async () => {
    const { deps, menu } = await created();
    expect(await refusalOf(() => menuDeleteRoute.handle({ input: { menuId: "nope" }, deps: trashDeps(deps, removed({ ok: true, version: 1 }).remove), context: PRINCIPAL, authorize: allow() }, { signal })))
      .toEqual({ status: 404, body: { error: "menu 'nope' was not found" } });
    const conflict = await refusalOf(() => menuDeleteRoute.handle({ input: { menuId: menu.id }, deps: trashDeps(deps, removed({ ok: false, reason: "version-changed" }).remove), context: PRINCIPAL, authorize: allow() }, { signal }));
    expect(conflict.status).toBe(409);
    expect(Object.keys(conflict.body as object)).toEqual(["error"]);
  });
});

describe("menus route specs outward copy", () => {
  it("answers a mapped error with the host's outward message, applied at handling time", async () => {
    const deps = { ...makeMenuDeps(), outwardErrorMessage: ({ error }: { error: Error }) => `host: ${error.message}` };
    expect(await refusalOf(() => menuCreateRoute.handle({ input: { title: "", slug: "x", items: undefined, authoring: {} }, deps, context: PRINCIPAL, authorize: allow() }, { signal })))
      .toEqual({ status: 400, body: { error: "host: title is required" } });
  });

  it("answers a trashed menu's not-live 409 with the host's outward message, keeping the guard's code", async () => {
    const { menu } = await created();
    const deps = { ...makeMenuDeps(), outwardErrorMessage: ({ error }: { error: Error }) => `host: ${error.constructor.name}` };
    const notLive = new EntityNotLiveError({ entityType: "menu", entityId: menu.id, state: "trashed" });
    deps.menuRepo.findById = async () => { throw notLive; };
    const input = { menuId: menu.id, items: [ITEM], expectedVersion: 1, title: undefined, slug: undefined, authoring: {} };
    expect(await refusalOf(() => menuUpdateTreeRoute.handle({ input, deps, context: PRINCIPAL, authorize: allow() }, { signal })))
      .toEqual({ status: 409, body: { error: "host: EntityNotLiveError", code: "ENTITY_IN_TRASH" } });
    expect(await refusalOf(() => menuAssignLocationRoute.handle({ input: { menuId: menu.id, locationKey: "primary" }, deps, context: PRINCIPAL, authorize: allow() }, { signal })))
      .toEqual({ status: 409, body: { error: "host: EntityNotLiveError", code: "ENTITY_IN_TRASH" } });
  });
});
