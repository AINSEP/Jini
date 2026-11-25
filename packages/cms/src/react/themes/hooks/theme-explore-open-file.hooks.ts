/**
 * @file Open-file predicates for the Explore screen — split out of `use-theme-explore.hooks.ts`
 * rather than grown inline, for the same complexity-ceiling reason `theme-explore-url.hooks.ts`
 * was. Plain functions over structural shapes (no `ThemeExploreFile` import), so that file can
 * import FROM this one without a circular import.
 */

/**
 * Whether `loaded`, the theme and path the editor buffer was last set from, is the open file. A
 * `null` selection never matches.
 *
 * @complexity O(1).
 */
export function isOpenFileLoaded(
  { loaded, themeId, selected }: { loaded: { themeId: string; path: string } | null; themeId: string; selected: string | null }, _optional = {}
): boolean {
  return loaded !== null && loaded.themeId === themeId && loaded.path === selected;
}

/**
 * Whether a list-reconciling refresh leaves the open file selected: it is still listed, or its
 * loaded buffer holds unsaved text. A removed clean file gives way to the ordinary default; a removed
 * dirty file keeps its buffer (and the leave guard that comes with it).
 *
 * @complexity O(f) in `serverFiles`, plus O(s) in the text length for the buffer comparison.
 */
export function keepsOpenFileSelected({
  serverFiles,
  open,
  themeId,
}: {
  serverFiles: ReadonlyArray<{ path: string }>;
  open: { selected: string | null; source: string; savedSource: string; loadedFile: { themeId: string; path: string } | null };
  themeId: string;
}, _optional = {}): boolean {
  const selectedStillExists = serverFiles.some((file) => file.path === open.selected);
  const hasUnsavedText = isOpenFileLoaded({ loaded: open.loadedFile, themeId: themeId, selected: open.selected }) && open.source !== open.savedSource;
  return selectedStillExists || hasUnsavedText;
}
