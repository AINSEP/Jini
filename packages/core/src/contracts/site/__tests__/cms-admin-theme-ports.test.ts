import { expectTypeOf, test } from "vitest";

import type { HeldBackRestoreResult, HeldBackThemesPort } from "../cms-admin-held-back-themes.js";
import type { ThemeExplorePort } from "../cms-admin-theme-explore.js";
import type { ThemesPort } from "../cms-admin-theme-registry.js";

/**
 * @file Pins the deletion and approval contracts the admin themes ports carry: the whole-theme Trash
 * move (`ThemesPort["trashTheme"]`), the permanent single-file delete
 * (`ThemeExplorePort["deleteThemeFile"]`) and the approval-gated quarantine restore
 * (`HeldBackThemesPort["restore"]`). Every assertion is a type assertion — a renamed approval field,
 * a member that turns optional, or a widened result fails `tsc`, not a runtime branch.
 */

test("trashTheme takes exactly the theme id and resolves with nothing", () => {
  expectTypeOf<Parameters<ThemesPort["trashTheme"]>>().toEqualTypeOf<[required: { themeId: string }]>();
  expectTypeOf<ReturnType<ThemesPort["trashTheme"]>>().toEqualTypeOf<Promise<void>>();
});

test("deleteThemeFile takes the theme id and path and resolves with the deleted path", () => {
  expectTypeOf<Parameters<ThemeExplorePort["deleteThemeFile"]>>().toEqualTypeOf<
    [required: { themeId: string; path: string }, optional?: Record<string, never>]
  >();
  expectTypeOf<ReturnType<ThemeExplorePort["deleteThemeFile"]>>().toEqualTypeOf<Promise<{ path: string }>>();
});

test("restore requires the checked digest AND the approval token, and resolves with the restored theme", () => {
  expectTypeOf<Parameters<HeldBackThemesPort["restore"]>>().toEqualTypeOf<
    [required: { themeId: string; approvedDigest: string; confirmationToken: string }, optional?: Record<string, never>]
  >();
  expectTypeOf<ReturnType<HeldBackThemesPort["restore"]>>().toEqualTypeOf<Promise<HeldBackRestoreResult>>();
  expectTypeOf<HeldBackRestoreResult>().toEqualTypeOf<{
    theme: { id: string; name: string; status: "valid" | "invalid" };
    restoredFrom: string;
  }>();
});
