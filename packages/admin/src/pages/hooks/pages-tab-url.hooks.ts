/**
 * @file The Pages screen's `?tab=` deep link — mirrors `features/themes/hooks/theme-explore-
 * url.hooks.ts`'s split (own file, plain `history.replaceState`, not this app's `navigate()`) for
 * the same reason: `Pages.tsx`'s `activeTab` is pure view-chrome state (owner ruling — see that
 * declaration's own comment in `Pages.tsx`), so this has nothing to do with data loading; it only
 * reads and writes the address bar.
 *
 * Owner ask (2026-08-30): `http://localhost:5173/admin/pages?tab=themes` should open directly on
 * the Theme Pages tab. The URL word is `themes` (plural, matching the tab's own visible label
 * "Theme Pages") rather than the internal tab id `"theme"` (singular — `Pages.tsx`'s `TabBar` `id`,
 * unchanged since it also names the `usePagesHook`/`useThemePagesHook` seam and every existing
 * test). Translating between the two spellings is this file's whole job, the same boundary
 * `theme-explore-url.hooks.ts` draws between `?page=`'s wire value and the internal file `path`.
 */
export type PagesTabId = "mine" | "theme";

const TAB_PARAM = "tab";
const THEME_TAB_PARAM_VALUE = "themes";

/**
 * `?tab=` → the tab to open on. The only recognized value is `"themes"`; everything else — absent,
 * empty, or an unrecognized string (a typo, an old link) — resolves to `"mine"`, this screen's own
 * pre-existing default. That is a deliberate choice, not a silent wrong-tab render: `"mine"` is
 * exactly what already rendered before this param existed, for every one of those same inputs, so
 * an unrecognized value falls back to the same place absence always did rather than guessing at a
 * closest match or leaving neither tab selected.
 *
 * Read once, by `Pages`'s own initial `useState` — this screen has no equivalent of Explore's
 * "not found" toast because there is only one other value to fall back to, not a whole file list a
 * request could have missed.
 *
 * @complexity O(1).
 */
export function resolvePagesTabFromUrl({}: {}, { search = window.location.search }: { search?: string } = {}): PagesTabId {
  return new URLSearchParams(search).get(TAB_PARAM) === THEME_TAB_PARAM_VALUE ? "theme" : "mine";
}

/**
 * Mirror the active tab into `?tab=` — deliberately plain `window.history.replaceState`, NOT this
 * app's own `navigate()`. `navigate()` dispatches `jini:admin-navigate`, which every mounted screen
 * treats as a real navigation and re-renders on; routing a same-screen tab click through it would
 * make switching tabs look like leaving and re-entering the Pages screen for no reason. `replace`,
 * not a new history entry, matching every other in-page control that writes itself into this app's
 * URL (`writeThemeExploreSelectionToUrl`'s own precedent): the back button should undo a real
 * navigation, not every tab click.
 *
 * `"mine"` DELETES the param rather than writing `tab=mine` — it is this screen's default, so a URL
 * with no `tab` at all and a URL with `tab=mine` should not silently drift into two spellings of the
 * same state. The address bar still changes on every tab switch either way (a `tab=themes` question
 * mark appearing or disappearing), which is what round-tripping requires.
 *
 * @complexity O(1).
 */
export function writePagesTabToUrl({ tab }: { tab: PagesTabId }, _optional: Record<string, never> = {}): void {
  const url = new URL(window.location.href);
  if (tab === "theme") {
    url.searchParams.set(TAB_PARAM, THEME_TAB_PARAM_VALUE);
  } else {
    url.searchParams.delete(TAB_PARAM);
  }
  window.history.replaceState(null, "", url);
}
