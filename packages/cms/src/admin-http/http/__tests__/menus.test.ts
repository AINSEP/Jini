import { describe, expect, it } from "vitest";
import { authorizeMenuHtml, parseMenuHtmlAuthoring, toAdminAssignLocationResponse, toAdminMenuDto, toAdminTrashMenuResponse } from "../menus.js";

const baseMenu = {
  id: "menu-1", workspaceId: "ws-1", slug: "main", title: "Main", status: "published", locations: ["primary"],
  updatedAt: "2026-01-01T00:00:00.000Z", version: 2,
  doc: { items: [{ id: "i-1", label: "Home", target: { kind: "url", href: "/" }, children: [{ id: "i-2", target: { kind: "url", href: "/a" } }] }] },
} as never;

describe("menus DTOs", () => {
  it("serializes the tree and omits mode/html when the doc carries neither", () => {
    const dto = toAdminMenuDto(baseMenu) as unknown as Record<string, unknown>;
    expect("mode" in dto || "html" in dto).toBe(false);
    expect(dto).toMatchObject({ id: "menu-1", locations: ["primary"], items: [{ id: "i-1", children: [{ id: "i-2", children: undefined }] }] });
  });

  it("carries mode and html through, and shapes the assign/trash envelopes", () => {
    const html = { ...(baseMenu as object), doc: { items: [], mode: "html", html: "<a>x</a>" } } as never;
    expect(toAdminMenuDto(html)).toMatchObject({ mode: "html", html: "<a>x</a>" });
    const binding = { workspaceId: "ws-1", locationKey: "primary", menuId: "menu-1", boundAt: "t", extra: 1 } as never;
    expect(toAdminAssignLocationResponse({ menu: baseMenu, binding, displacedMenu: null })).toMatchObject({ binding: { workspaceId: "ws-1", locationKey: "primary", menuId: "menu-1", boundAt: "t" }, displacedMenu: null });
    expect(toAdminTrashMenuResponse({ id: "menu-1", version: null })).toEqual({ trashed: true, id: "menu-1", version: null });
  });

  it("parseMenuHtmlAuthoring keeps only the fields that were sent", () => {
    expect(parseMenuHtmlAuthoring({})).toEqual({});
    expect(parseMenuHtmlAuthoring({ mode: "html", html: "<b>y</b>", other: 1 })).toEqual({ mode: "html", html: "<b>y</b>" });
  });
});

describe("authorizeMenuHtml", () => {
  it("asks for the raw-HTML permission only on an HTML write, naming the menu only when given", async () => {
    const calls: unknown[] = [];
    const authorize = async (required: { permission: string; entityType: string }, optional: { entityId?: string } = {}) => { calls.push({ ...required, ...optional }); };
    await authorizeMenuHtml({ authorize, authoring: { mode: "items" } });
    expect(calls).toEqual([]);
    await authorizeMenuHtml({ authorize, authoring: { html: "<a>x</a>" } }, { menuId: "menu-1" });
    await authorizeMenuHtml({ authorize, authoring: { mode: "html" } });
    expect(calls).toEqual([{ permission: "pages.edit_html", entityType: "menu", entityId: "menu-1" }, { permission: "pages.edit_html", entityType: "menu" }]);
  });

  it("treats a missing authorizer on an HTML write as a wiring bug", async () => {
    await expect(authorizeMenuHtml({ authorize: undefined, authoring: { mode: "html" } })).rejects.toThrow("menus admin route has no authorizer");
  });
});
