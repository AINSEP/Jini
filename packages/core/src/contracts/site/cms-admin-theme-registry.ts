import type { PresentationSettings, ThemeTier } from "./cms-admin-theme-types.js";

/**
 * @file What `use-themes.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md` and `Jini redirects/SOURCE-RATIONALE.md` (the
 * canonical reference): this file declares, `themes-dependencies.hooks.ts` binds the real `api`
 * client, and nothing else under `features/themes` imports `lib/api` for these three routes. NOT
 * shared with `theme-explore-port.hooks.ts` — that hook edits a single theme's FILES (a different
 * resource), while this one manages the theme REGISTRY (available themes, active theme).
 *
 * This hook doesn't call `useAdminLocale()`/`t()` — every message is hardcoded English — so unlike
 * `media-port.hooks.ts`/`widgets-port.hooks.ts` there is no accompanying `locale` dependency.
 */
export interface ThemesPort {
  getPresentation(): Promise<{
    settings: PresentationSettings;
    availableThemeIds: string[];
    availableThemes: Array<{ id: string; name?: string; tier: ThemeTier; previewImageUrl?: string | null; builtIn?: boolean }>;
  }>;
  rescanThemes(): Promise<{ added: string[]; removed: string[]; total: number; availableThemeIds: string[]; duplicateIds: string[] }>;
  setActiveTheme(required: { activeThemeId: string }, optional?: Record<string, never>): Promise<{ settings: PresentationSettings; availableThemeIds: string[] }>;
  /** Copy a theme into a new one named `newName` (server derives the id). Resolves with the copy's id and name. */
  duplicateTheme(required: { themeId: string; newName: string }, optional?: Record<string, never>): Promise<{ theme: { id: string; name: string } }>;
  /** Move a whole theme to the Trash (the generic `POST /trash/items`, `type: "theme"`). The server
   *  refuses the active theme (`THEME_ACTIVE`); restoring happens from the Trash screen. */
  trashTheme(required: { themeId: string }): Promise<void>;
}
