import { describe, expect, it } from "vitest";
import type { AdminMenuAttrsDto, AdminMenuDto, AdminMenuTargetDto } from "@jini-ai/core/contracts/site/cms-menus";

import type { MenuStatus, NavItemAttrs, NavMenuMode, NavTarget } from "../../../navigation/index.js";
import { parseMenuHtmlAuthoring, toAdminMenuBindingDto, toAdminMenuDto, toAdminMenuResponse } from "../menus.js";
import { menuIdParam } from "../../routes/menus/shared.js";
import { fakeMenu, fakeMenuDto } from "../../routes/menus/__tests__/helpers.js";

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
});
