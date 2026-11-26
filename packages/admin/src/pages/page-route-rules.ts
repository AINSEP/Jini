import type { RowMenuItem } from "../react/index.js";
import type { Translate } from "@jini-ai/core/text";

/** The subset of a page {@link pageAdminPath} reads — kept narrow, same reasoning as
 *  {@link SavablePage} below, so a collision record (`ThemePageSlugCollision`/
 *  `ThemeExploreSlugCollision`, both `{ id, slug, title, kind }`) satisfies it structurally with no
 *  cast, alongside a real `AdminPost`. */
export interface PageAdminHandle {
  id: string;
  slug: string;
}

/** The callbacks a Theme Page row's menu needs. Passed in rather than imported, same reasoning as
 *  `PageRowMenuHandlers` (`@jini-ai/admin/pages/pages-list-rules`) — in particular, `onEdit` takes a `pageId` rather than
 *  building the Theme Studio href itself, so this module stays free of navigation: the caller
 *  (`ThemePagesTab.tsx`) already holds the narrowed, non-null `themeId` `themeStudioHref` needs, and
 *  is the one place that calls it. */
export interface ThemePageRowMenuHandlers {
  onOpenDetails: (pageId: string) => void;
  onEdit: (required: { pageId: string }) => void;
}


/** Readable admin alias for the root page; a real `home` slug uses its id to avoid a collision. */

/**
 * The in-SPA path to a page's admin editor — `/pages/<handle>`, the bare route path `navigate()`
 * (`lib/router.ts`) expects, or that `adminHref()` (same module) turns into a real `<a href>`.
 *
 * Prefers the slug, with `home` as the readable alias for the literal root slug `"/"`
 * (`post.ts`'s `ROOT_SLUG`, gated to `kind: "page"`). The page-editor route is registered as
 * `/:slug` — one path segment (`panels.tsx`) — so `/` cannot match it, the bug `45101306` fixed
 * by switching to id-always. The editor maps `home` back to `/` before fetching. The alias wins:
 * a real page whose legal slug is `home` uses its id, preserving access without reserving a
 * public slug. `getAdminPostByIdOrSlug` (`host src/features/post/post.ts`) resolves an
 * ordinary slug or id server-side (slug checked first, id as the fallback).
 *
 * Deliberately returns the bare route path rather than a full href or two id/slug-flavored
 * variants — a caller building a real `<a href>` wraps this in `adminHref()`; a caller driving the
 * SPA router passes it straight to `navigate()`. Baking a prefix in here would make it wrong for
 * whichever caller didn't want it; the previous per-call-site `` `/pages/${page.slug}` `` /
 * `` `/pages/${page.id}` `` templates are exactly the caller-side duplication this function replaces.
 *
 * @complexity O(1).
 */
function pageAdminPath({ page, deps }: { page: PageAdminHandle; deps: Parameters<typeof createPageRouteRules>[0]["deps"] }, _optional: Record<string, never> = {}): string {
  if (page.slug === "/") return `${deps.routeBase}/${deps.rootAlias}`;
  return `${deps.routeBase}/${page.slug === deps.rootAlias ? page.id : page.slug}`;
}

/**
 * The row-action menu for one Theme Page row — pulled out of `ThemePagesTab.tsx`'s `DataTable`
 * cell for the same reason `pageRowMenuItems` (`@jini-ai/admin/pages/pages-list-rules`) was: a claim worth a test, which it cannot have
 * while it is a closure inside a table cell reachable only by rendering and opening a popover.
 *
 * A theme page has no `PostRecord` behind it (see `Pages.tsx`'s own header on this tab's history),
 * so there is nothing here to disable or delete — just `Details` (the row's full facts, opened in
 * `ThemePageDetailsModal.tsx`) and `Edit` (the same Theme Studio destination the table's own Theme
 * Studio column links to, listed directly under `Details` per the 2026-08-31 owner request that
 * moved it here from the modal's own footer — see `ThemePageDetailsModal.tsx`'s own header, PART 3,
 * for that history). Kept as its own function (rather than a bare inline array at the call site) so
 * a future third action lands here, not as a second ad hoc array shape.
 *
 * Takes an already-bound {@link Translate} rather than a raw `locale`, unlike `pageRowMenuItems`
 * — `ThemePagesTab.tsx`'s own helpers (`themePagePublishState`, `lockedPublishReason`, …) all take
 * `t: Translate` already, and this row menu is built inside that same component, so matching ITS
 * established convention avoids threading a second, redundant `locale` value through the same tree.
 *
 * @complexity O(1) — exactly two entries, no iteration.
 */
function themePageRowMenuItems({ row, handlers, t, deps }: { row: { pageId: string }; handlers: ThemePageRowMenuHandlers; t: Translate; deps: Parameters<typeof createPageRouteRules>[0]["deps"] }, _options = {}): RowMenuItem[] {
  return [
    { key: deps.actions.details.key, label: t(deps.actions.details.label), onSelect: () => handlers.onOpenDetails(row.pageId) },
    { key: deps.actions.edit.key, label: t(deps.actions.edit.label), onSelect: () => handlers.onEdit({ pageId: row.pageId }) },
  ];
}


/**
 * What the Pages template `<select>` should show for a Page's `templateChoice` (bare-page ruling
 * 2026-09-23, S6). Before this ruling, `value={templateChoice ?? ""}` was enough because `null` and
 * `""` rendered identically (both fell back to the theme's page shell) — showing `null` as
 * `""`/"No template chosen" was a harmless simplification. Now they diverge: `""` is a bare page (no
 * theme chrome at all) and `null` still renders the theme's own page shell ("Theme default"), so
 * displaying a `null` Page as `""` would claim a render it does not do.
 *
 * `null` maps to whichever of {@link STATIC_TIER_PAGE_SHELL_TEMPLATES} (`pages-default.html`, then
 * the legacy `page-shell.html`) `availableTemplates` actually lists — the REAL filename the live
 * render already resolves through (`resolveStaticTierPageShellFallback`,
 * `host src/features/theme/static-render.ts`), so picking it back explicitly in the UI is a
 * no-op. When the active theme ships neither name (a declarative/handlebars theme, or a static theme
 * with no page shell at all), there is no real filename to show, so this returns
 * {@link THEME_DEFAULT_SENTINEL} instead — the one case the picker renders one extra, synthetic
 * "Theme default" option for. {@link pickerValueToChoice} maps it back to `null`.
 *
 * `""` and a real filename pass straight through unchanged — the picker's value already IS the
 * stored `templateChoice` for those two cases; only `null` needs translating into something a
 * `<select>` can render as a real option.
 *
 * @complexity O(n) in `availableTemplates.length` — one bounded scan of the two shell candidates.
 */
function pagePickerValue({ templateChoice, availableTemplates, deps }: { templateChoice: string | null; availableTemplates: string[]; deps: Parameters<typeof createPageRouteRules>[0]["deps"] }, _options = {}): string {
  if (templateChoice !== null) return templateChoice;
  const shipped = deps.shellNames.find((name) => availableTemplates.includes(name));
  return shipped ?? deps.THEME_DEFAULT_SENTINEL;
}

export function createPageRouteRules({ deps }: { deps: {
  THEME_DEFAULT_SENTINEL: string;
  routeBase: string; rootAlias: string; shellNames: readonly string[];
  actions: { details: { key: string; label: string }; edit: { key: string; label: string } };
} }, _optional = {}) {
  return {
    pageAdminPath: (page: PageAdminHandle, _optional = {}) => pageAdminPath({ page, deps }),
    themePageRowMenuItems: (required: Omit<Parameters<typeof themePageRowMenuItems>[0], "deps">, _optional = {}) => themePageRowMenuItems({ ...required, deps }),
    pagePickerValue: (required: Omit<Parameters<typeof pagePickerValue>[0], "deps">, _optional = {}) => pagePickerValue({ ...required, deps }),
  };
}
