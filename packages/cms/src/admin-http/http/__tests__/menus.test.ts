import { describe, expect, it } from "vitest";
import type { AdminMenuAttrsDto, AdminMenuDto, AdminMenuTargetDto } from "@jini-ai/core/contracts/site/cms-menus";

import type { MenuStatus, NavItemAttrs, NavMenuMode, NavTarget } from "../../../navigation/index.js";
import {
  parseMenuHtmlAuthoring, toAdminAssignLocationResponse, toAdminMenuBindingDto, toAdminMenuDto, toAdminMenuResponse, toAdminTrashMenuResponse,
} from "../menus.js";
import { authorizeMenuHtml, menuIdParam } from "../../routes/menus/shared.js";
import { fakeMenu, fakeMenuDto, RAW_HTML_PERMISSION } from "../../routes/menus/__tests__/helpers.js";

/**
 * @file rv1123e K1-jini #2: the menus wire DTOs are declared once in neutral Core (the admin client
 * consumes the same declarations); CMS keeps only the serialization, called with object arguments.
 */
/** Mutual assignability, checked by the compiler: `true` only when each side accepts the other. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("menus wire DTOs", () => {
  it("serializes through object arguments with byte-identical output", () => {
    const menu = fakeMenu({ doc: { type: "menu", version: 1, items: [], mode: "html", html: "<a>x</a>" } as never });
    expect(toAdminMenuDto({ menu })).toEqual({ ...fakeMenuDto({ doc: menu.doc }), items: [], mode: "html", html: "<a>x</a>" });
    expect(toAdminMenuResponse({ menu })).toEqual({ menu: toAdminMenuDto({ menu }) });
    const binding = { workspaceId: "ws-1", locationKey: "header", menuId: "m1", boundAt: "t", extra: 1 } as never;
    expect(toAdminMenuBindingDto({ binding })).toEqual({ workspaceId: "ws-1", locationKey: "header", menuId: "m1", boundAt: "t" });
    expect(parseMenuHtmlAuthoring({ body: { mode: "html", other: 1 } })).toEqual({ mode: "html" });
    expect(menuIdParam({ params: {} })).toBe("");
    expect(menuIdParam({ params: { menuId: "m1" } })).toBe("m1");
  });

  it("keeps Core's restated unions identical to the navigation types they mirror", () => {
    // Core cannot import CMS, so it restates these shapes; a drift on either side fails `tsc` here.
    const parity: [
      Same<NavTarget, AdminMenuTargetDto>, Same<NavItemAttrs, AdminMenuAttrsDto>,
      Same<NonNullable<AdminMenuDto["mode"]>, NavMenuMode>, Same<AdminMenuDto["status"], MenuStatus>,
    ] = [true, true, true, true];
    expect(parity).toEqual([true, true, true, true]);
  });

  it("serializes the tree and omits mode/html when the doc carries neither", () => {
    const menu = {
      id: "menu-1", workspaceId: "ws-1", slug: "main", title: "Main", status: "published", locations: ["primary"],
      updatedAt: "2026-01-01T00:00:00.000Z", version: 2,
      doc: { items: [{ id: "i-1", label: "Home", target: { kind: "url", href: "/" }, children: [{ id: "i-2", target: { kind: "url", href: "/a" } }] }] },
    } as never;
    const dto = toAdminMenuDto({ menu }) as unknown as Record<string, unknown>;
    expect("mode" in dto || "html" in dto).toBe(false);
    expect(dto).toMatchObject({ id: "menu-1", locations: ["primary"], items: [{ id: "i-1", children: [{ id: "i-2", children: undefined }] }] });
  });

  it("shapes the assign and trash envelopes", () => {
    const menu = fakeMenu();
    const binding = { workspaceId: "ws-1", locationKey: "primary", menuId: "m1", boundAt: "t", extra: 1 } as never;
    expect(toAdminAssignLocationResponse({ menu, binding, displacedMenu: null })).toMatchObject({
      binding: { workspaceId: "ws-1", locationKey: "primary", menuId: "m1", boundAt: "t" }, displacedMenu: null,
    });
    expect(toAdminTrashMenuResponse({ id: "m1", version: null })).toEqual({ trashed: true, id: "m1", version: null });
  });

  it("parseMenuHtmlAuthoring keeps only the fields that were sent", () => {
    expect(parseMenuHtmlAuthoring({ body: {} })).toEqual({});
    expect(parseMenuHtmlAuthoring({ body: { mode: "html", html: "<b>y</b>", other: 1 } })).toEqual({ mode: "html", html: "<b>y</b>" });
  });
});

describe("authorizeMenuHtml", () => {
  it("asks for the injected raw-HTML permission only on an HTML write, naming the menu only when given", async () => {
    const calls: unknown[] = [];
    const authorize = async (required: { permission: string; entityType: string }, optional: { entityId?: string } = {}) => { calls.push({ ...required, ...optional }); };
    await authorizeMenuHtml({ authorize, permission: RAW_HTML_PERMISSION, authoring: { mode: "items" } });
    expect(calls).toEqual([]);
    await authorizeMenuHtml({ authorize, permission: RAW_HTML_PERMISSION, authoring: { html: "<a>x</a>" } }, { entityId: "menu-1" });
    await authorizeMenuHtml({ authorize, permission: RAW_HTML_PERMISSION, authoring: { mode: "html" } });
    expect(calls).toEqual([
      { permission: RAW_HTML_PERMISSION, entityType: "menu", entityId: "menu-1" },
      { permission: RAW_HTML_PERMISSION, entityType: "menu" },
    ]);
  });

  it("treats a missing authorizer on an HTML write as a wiring bug", async () => {
    await expect(authorizeMenuHtml({ authorize: undefined, permission: RAW_HTML_PERMISSION, authoring: { mode: "html" } })).rejects.toThrow("menus admin route has no authorizer");
  });
});
