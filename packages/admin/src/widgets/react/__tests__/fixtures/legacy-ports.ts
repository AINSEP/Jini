import type { AdminWidget, AdminWidgetType, AdminWidgetWhereUsed } from "../../../models.js";

/**
 * @file What `use-widgets-library.hooks.ts` and `use-widget-instance-editor.hooks.ts` need from
 * the outside world, as an interface rather than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md` and `redirects-port.hooks.ts` (the
 * canonical reference): this file declares, `widgets-dependencies.hooks.ts` binds the real `api`
 * client, and nothing else under `features/widgets` imports `lib/api` for these five routes. One
 * shared port rather than one per hook — both hooks read/write the same widget-INSTANCE resource
 * (`AdminWidget`); region/placement routes are a different resource, covered by the separate
 * `WidgetRegionsPort` next to `use-widget-region-editor.hooks.ts`/`use-widget-regions.hooks.ts`.
 *
 * `describeApiError`/`ApiError` stay direct imports in the hooks that use this port — pure
 * error-classification, no I/O, same reasoning as `redirects-port.hooks.ts`'s own exclusion of
 * `describeApiError`.
 */
export interface WidgetsPort {
  listWidgets(options?: { widgetType?: string | undefined; includeInactive?: boolean | undefined }): Promise<{ widgets: AdminWidget[]; skippedCount?: number | undefined; skippedIds?: string[] | undefined }>;
  getWidget(id: string): Promise<{ widget: AdminWidget; whereUsed: AdminWidgetWhereUsed }>;
  /** No `options` (`api.createWidget`'s own `slug` override) — narrowed to what's actually called:
   *  `use-widget-instance-editor.hooks.ts` always calls this with one argument. Forwarding a second
   *  positional `undefined` when nothing was passed is observably different from omitting the
   *  argument entirely (an exact-arity `toHaveBeenCalledWith` assertion on the real `api.createWidget`
   *  spy distinguishes them) — narrowing here, not widening the wrapper, is what keeps the port a
   *  true callee-rename with zero behavior change. */
  createWidget(input: { widgetType: AdminWidgetType; title: string; config: Record<string, unknown> }): Promise<{ widget: AdminWidget }>;
  /** `title` is optional (SPEC-043 ui.spec §4.3): omitted keeps the widget's current title. */
  updateWidget(target: { id: string; baseVersion: number; config: Record<string, unknown>; title?: string | undefined }): Promise<{ widget: AdminWidget }>;
  /** Moves a widget instance to the Trash via the generic single-item route
   *  (`POST .../trash/items`, `api.trash({ type: "widget", id })`) — the same route every other
   *  admin delete button now goes through (see `trash-delete-architecture.md`). The Trash screen
   *  owns restore/purge from here; this port no longer has a purge method at all. */
  trashWidget(id: string): Promise<{ ok: true; version: number | null }>;
}

import type { AdminWidgetArea, AdminWidgetPlacement, AdminWidgetRegionBinding } from "../../../models.js";

/**
 * @file What `use-widget-region-editor.hooks.ts` and `use-widget-regions.hooks.ts` need from the
 * outside world, as an interface rather than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md` and `redirects-port.hooks.ts` (the
 * canonical reference): this file declares, `widget-regions-dependencies.hooks.ts` binds the real
 * `api` client, and nothing else under `features/widgets` imports `lib/api` for these four routes.
 * One shared port rather than one per hook — both hooks read/write the region/placement resource
 * (`AdminWidgetRegionBinding`/`AdminWidgetArea`/`AdminWidgetPlacement`), a DIFFERENT resource from
 * the widget-INSTANCE routes covered by the sibling `WidgetsPort` next to
 * `use-widgets-library.hooks.ts`/`use-widget-instance-editor.hooks.ts`.
 *
 * `describeApiError`/`ApiError` stay direct imports in the hooks that use this port — pure
 * error-classification, no I/O, same reasoning as `redirects-port.hooks.ts`'s own exclusion of
 * `describeApiError`.
 */
export interface WidgetRegionsPort {
  listWidgetRegions(): Promise<{ regions: AdminWidgetRegionBinding[] }>;
  bindWidgetRegion(regionKey: string): Promise<{ area: AdminWidgetArea }>;
  getWidgetRegion(regionKey: string): Promise<{ area: AdminWidgetArea; placements: AdminWidgetPlacement[] }>;
  mutateWidgetRegionPlacements(target: {
    regionKey: string;
    baseVersion: number;
    placements: Array<{ placementId: string; widgetEntryId: string; enabled: boolean }>;
  }): Promise<{ area: AdminWidgetArea }>;
  /** The one widget-INSTANCE read this resource needs: a just-added placement's title/type, which
   *  the region's own placement list only carries for rows it has already saved. */
  getWidget(id: string): Promise<{ widget: Pick<AdminWidget, "title" | "widgetType"> }>;
}
