import { vi } from "vitest";
import { useCachedLoader, useDirtyGuard, useFetchQuery } from "../../../react/kit.js";
import type { AdminMenu } from "../api/menus-api.types.js";
import { useMenuEditorState, useMenuFieldActions, useMenuItemActions } from "../hooks/use-menu-editor-state.hooks.js";
import { useMenuCopyEmbed, useMenuSave } from "../hooks/use-menu-editor-writes.hooks.js";
import type { MenusApiErrorLike, MenusHostKit } from "../menus-host-kit.js";

export const MENU: AdminMenu = {
  id: "m1", workspaceId: "ws1", slug: "main", title: "Main menu", status: "draft",
  items: [{ id: "i1", label: "Home", target: { kind: "url", href: "/" } }], locations: [],
  updatedAt: "2026-08-01T00:00:00.000Z", version: 1,
};

export function stubKit(overrides: Partial<MenusHostKit> = {}): MenusHostKit {
  return {
    isApiError: (_e: unknown): _e is MenusApiErrorLike => false,
    isVersionConflict: () => false,
    versionConflictMessage: "CONFLICT_KEY",
    toSlug: ({ text }) => `slug:${text}`,
    slugRedirectPath: () => null,
    failures: { getGeneration: () => 7, isClipboardRefusal: () => false, publishLocal: vi.fn() },
    useMenuEditorState, useMenuFieldActions, useMenuItemActions, useMenuCopyEmbed, useMenuSave,
    useCachedLoader, useDirtyGuard, useFetchQuery,
    ...overrides,
  };
}
