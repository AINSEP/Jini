import type { AdminMenu, AdminMenuAuthoring, AdminMenuItem } from "../api/menus-api.types.js";
import type { MenuPageChoice } from "../page-link-rules.js";

/**
 * @file What `use-menu-editor.hooks.ts` and `use-menus.hooks.ts` need from the outside world, as
 * an interface rather than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md` and `Jini redirects/SOURCE-RATIONALE.md` (the
 * canonical reference): this file declares, `menus-dependencies.hooks.ts` binds the real `api`
 * client, and nothing else under `features/menus` imports `lib/api` for these five routes. One
 * shared port rather than one per hook — both hooks read/write the same `/menus` resource.
 *
 * Neither hook calls `useAdminLocale()` or `t()` — every message in this feature is hardcoded
 * English (see `use-menu-editor.hooks.ts`/`use-menus.hooks.ts`'s own `e instanceof Error ?
 * e.message : "failed to ..."` fallbacks) — so unlike `media-port.hooks.ts`/`widgets-port
 * .hooks.ts`, this port has no accompanying `locale` dependency to inject alongside it.
 *
 * `trash` (Trash rewrite, 2026-09-21, `trash-delete-architecture.md`) moves a menu to Trash. A
 * trashed menu is hidden from
 * `listMenus()` by the server's own default filter, and the Trash screen owns restore/purge from
 * here.
 */
export interface MenusPort {
  listPages?: (required: Record<string, never>, optional?: Record<string, never>) => Promise<{ pages: MenuPageChoice[] }>;
  listMenus(): Promise<{ menus: AdminMenu[] }>;
  getMenu(required: { id: string }, optional?: Record<string, never>): Promise<{ menu: AdminMenu }>;
  /** `options.mode`/`options.html` author an HTML-mode menu; omitted, the server keeps its default. */
  createMenu(required: { input: { title: string; slug: string }; options: { items?: AdminMenuItem[] } & AdminMenuAuthoring }, optional?: Record<string, never>): Promise<{ menu: AdminMenu }>;
  /** `options.mode`/`options.html` omitted keep the stored values, so an items save never drops HTML. */
  updateMenuTree(
    required: { target: { id: string; expectedVersion: number; items: AdminMenuItem[] };
      options: { title?: string; slug?: string } & AdminMenuAuthoring },
    optional?: Record<string, never>
  ): Promise<{ menu: AdminMenu }>;
  /** Moves a menu to the Trash via the generic single-item route (`POST .../trash/items`,
   *  `api.trash({ type: "menu", id })`) — the same route every other admin delete button now goes
   *  through. No purge method here any more; the Trash screen owns that. */
  trash(target: { id: string }): Promise<{ ok: true; version: number | null }>;
}
