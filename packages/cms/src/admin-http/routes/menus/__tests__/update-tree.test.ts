import { describe, expect, it } from "vitest";
import { EntityNotLiveError } from "../../../../core/entity-liveness.js";
import { MenuConflictError, MenuNotFoundError, MenuValidationError, MenuVersionConflictError } from "../../../../navigation/index.js";
import { menuUpdateTreeRoute } from "../update-tree.js";
import { makeWriteDeps, PRINCIPAL, RAW_HTML_PERMISSION, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

describe("menuUpdateTreeRoute", () => {
  it("keeps the method and path", () => {
    expect(menuUpdateTreeRoute.method).toBe("put");
    expect(menuUpdateTreeRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/menus/:menuId");
  });

  it("parses items, expectedVersion, title/slug only when strings, and the HTML-mode fields", () => {
    expect(menuUpdateTreeRoute.parse(raw({ menuId: "m1" }, { items: [], expectedVersion: "2", title: 7, slug: "s" }))).toEqual({
      ok: true, value: { menuId: "m1", items: [], expectedVersion: 2, title: undefined, slug: "s", authoring: {} },
    });
    // An HTML-only write may omit `items` (the stored tree is kept); expectedVersion defaults to 0.
    expect(menuUpdateTreeRoute.parse(raw({}, { mode: "html", html: "<p/>" }))).toEqual({
      ok: true, value: { menuId: "", items: undefined, expectedVersion: 0, title: undefined, slug: undefined, authoring: { mode: "html", html: "<p/>" } },
    });
  });

  it("refuses a body without an items array (and no HTML fields) with the code-less 400", async () => {
    expect(await refusalOf(() => menuUpdateTreeRoute.parse(raw({ menuId: "m1" }, { expectedVersion: 1 })))).toEqual({ status: 400, body: { error: "items must be an array" } });
  });

  it("authorizes admin.menus.update for the menu, saves the tree and answers it", async () => {
    const deps = await makeWriteDeps();
    const { authorize, calls } = recordingAuthorize();
    const input = { menuId: "m1", items: [], expectedVersion: 1, title: undefined, slug: undefined, authoring: {} };
    const result = await menuUpdateTreeRoute.handle({ input, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ permission: "admin.menus.update", entityType: "menu", entityId: "m1" }]);
    expect(result.ok && result.value.menu.items).toEqual([]);
    expect((await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id: "m1" }))?.version).toBe(2);
  });

  it("asks the raw-HTML permission scoped to the menu, passes the injected normalizer, and stores nothing when refused", async () => {
    const deps = await makeWriteDeps();
    const { authorize, calls } = recordingAuthorize([RAW_HTML_PERMISSION]);
    const input = { menuId: "m1", items: undefined, expectedVersion: 1, title: undefined, slug: undefined, authoring: { mode: "html" as const, html: "<p>x</p>" } };
    await expect(menuUpdateTreeRoute.handle({ input, deps, context: PRINCIPAL, authorize })).rejects.toThrow("denied");
    expect(calls).toEqual([
      { permission: "admin.menus.update", entityType: "menu", entityId: "m1" },
      { permission: RAW_HTML_PERMISSION, entityType: "menu", entityId: "m1" },
    ]);
    expect((await deps.menuRepo.findById({ workspaceId: WORKSPACE_ID, id: "m1" }))?.version).toBe(1);
  });

  // rv1123e K1-jini #1: the two checks stay two separate `authorize` calls (a host answers each
  // with its own decision source), and the raw-HTML one keeps the hand-written route's
  // `...(menuId ? { entityId } : {})` — an empty parsed id sends NO `entityId` key on that check,
  // while `admin.menus.update` still names the (empty) id as it always did.
  // Mutation `update-html-entityid-always` (always pass `entityId` to the HTML check) fails this.
  it("omits entityId on the raw-HTML check only when the parsed menu id is empty", async () => {
    const deps = await makeWriteDeps();
    const { authorize, calls } = recordingAuthorize();
    const input = { menuId: "", items: undefined, expectedVersion: 1, title: undefined, slug: undefined, authoring: { mode: "html" as const, html: "<p>x</p>" } };
    await Promise.resolve(menuUpdateTreeRoute.handle({ input, deps, context: PRINCIPAL, authorize })).catch(() => undefined);
    expect(calls).toEqual([
      { permission: "admin.menus.update", entityType: "menu", entityId: "" },
      { permission: RAW_HTML_PERMISSION, entityType: "menu" },
    ]);
    expect(Object.keys(calls[1]!)).not.toContain("entityId");
  });

  it("uses the injected normalizer for submitted HTML", async () => {
    const deps = { ...(await makeWriteDeps()), normalizeMenuHtml: ({ html }: { html: string }) => `${html}<!--n-->` };
    const { authorize } = recordingAuthorize();
    const input = { menuId: "m1", items: undefined, expectedVersion: 1, title: undefined, slug: undefined, authoring: { mode: "html" as const, html: "<p>x</p>" } };
    const result = await menuUpdateTreeRoute.handle({ input, deps, context: PRINCIPAL, authorize });
    expect(result.ok && result.value.menu.html).toBe("<p>x</p><!--n-->");
  });

  const cases: Array<[string, Error, { status: number; body: unknown }]> = [
    ["trashed menu", new EntityNotLiveError({ entityType: "menu", entityId: "m1", state: "trashed" }), { status: 409, body: { error: new EntityNotLiveError({ entityType: "menu", entityId: "m1", state: "trashed" }).message, code: "ENTITY_IN_TRASH" } }],
    ["validation", new MenuValidationError({ message: "bad tree" }), { status: 400, body: { error: "bad tree" } }],
    ["lost compare-and-set", new MenuVersionConflictError({ message: "stale" }), { status: 409, body: { error: "stale", code: "VERSION_CONFLICT" } }],
    ["slug conflict", new MenuConflictError({ message: "slug taken" }), { status: 409, body: { error: "slug taken" } }],
    ["not found", new MenuNotFoundError({ message: "menu 'm1' was not found" }), { status: 404, body: { error: "menu 'm1' was not found" } }],
  ];
  for (const [name, error, expected] of cases) {
    it(`maps a ${name} failure to the host's exact refusal`, async () => {
      const deps = { ...(await makeWriteDeps()), menuRepo: { findById: async () => { throw error; } } as never };
      const { authorize } = recordingAuthorize();
      const input = { menuId: "m1", items: [], expectedVersion: 1, title: undefined, slug: undefined, authoring: {} };
      expect(await refusalOf(() => menuUpdateTreeRoute.handle({ input, deps, context: PRINCIPAL, authorize }))).toEqual(expected);
    });
  }

  it("rethrows an unmapped failure for the host's 500", async () => {
    const deps = { ...(await makeWriteDeps()), menuRepo: { findById: async () => { throw new TypeError("boom"); } } as never };
    const { authorize } = recordingAuthorize();
    const input = { menuId: "m1", items: [], expectedVersion: 1, title: undefined, slug: undefined, authoring: {} };
    await expect(menuUpdateTreeRoute.handle({ input, deps, context: PRINCIPAL, authorize })).rejects.toThrow("boom");
  });
});
