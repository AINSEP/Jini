import { useCallback, useMemo, useState } from "react";
import { useFetchQuery, useFetchMutation, useCachedLoader } from "../../react/kit.js";
import type { ThemePagesFileEntry, ThemePagesPort, ThemePageSlugCollision } from "./theme-pages-port.hooks.js";

/**
 * @file The "Theme Pages" tab's data — the active theme's own bundled `pages/*.html`, one row per
 * page-shaped file, now carrying enough per-row detail to drive a publish toggle and a "see more"
 * disclosure (2026-08-30) instead of the bare id list this used to be.
 *
 * **Why this now makes two requests, not one.** The active theme id and its page list used to ride
 * on the same `getPresentation()` response (`activeThemeStaticPageIds`, computed server-side as a
 * bare `Object.keys(activeTheme.pages)` — every page id, including `index`/`404`/a declared
 * template shell, with no publish state at all). That's no longer enough: this tab needs to tell a
 * real candidate page apart from those three non-candidate shapes, and show whether each candidate
 * is actually live. Theme Studio's Explore screen already resolves both facts, off `getThemeDetail`
 * (`files[].published`, straight from the server's `isStandaloneThemePage` — see `theme-pages-
 * port.hooks.ts`'s own header) — but that route needs the theme id as an argument, which is exactly
 * what `getPresentation()` still supplies. The two calls are therefore chained, not independent:
 * `getPresentation()` resolves `activeThemeId`, then `getThemeDetail(activeThemeId)` resolves the
 * page rows.
 *
 * `port` is injected — see `theme-pages-port.hooks.ts` — rather than importing `lib/api` directly,
 * so a test can describe the load against `createFakeThemePagesPort` instead of stubbing global
 * `fetch`. The host binds the live port and its `noThemeId` sentinel.
 */

/** One row the "Theme Pages" tab renders — everything the Pages screen's `ThemePagesTab` needs to decide
 *  publish/locked state and the "see more" detail, with none of `getThemeDetail`'s group/readable/
 *  editable noise this tab never reads. */
export interface ThemePageRow {
  /** Basename minus `.html` — the same id `theme.ts`'s `isStandaloneThemePage`/
   *  `ThemeManifest.publishedPages` key candidate pages by. */
  pageId: string;
  /** Full theme-relative path (e.g. `render/pages/about.html`) — the one extra fact this tab's
   *  "see more" disclosure reveals for a real candidate page; see `ThemePagesTab.tsx`. */
  filePath: string;
  /** Straight from the server's `isStandaloneThemePage` — `null` for `index`/`404`/a declared
   *  template shell, the same three-way `null` contract `ThemeExploreFile.published`
   *  (`use-theme-explore.hooks.ts`) already established for the identical route. */
  published: boolean | null;
  /** False for a page the theme author added after the site's own copy was made — no original to
   *  reset it from. Surfaced in the row's details modal. */
  resettable: boolean;
  /** The live content record occupying this page's own slug, or `null` when none does — straight
   *  from `getThemeDetail`'s own `collidingContent`. See `ThemePagesFileEntry.collidingContent`
   *  (`theme-pages-port.hooks.ts`) for the full contract and `ThemePageDetailsModal.tsx` for where
   *  this tab shows it. */
  collidingContent: ThemePageSlugCollision | null;
}

export interface ThemePagesController {
  /** `null` until the initial load settles — the caller renders a loading state. `[]` once loaded
   *  means the active theme is genuinely not `static`-tier or ships no pages — not an error. */
  pages: ThemePageRow[] | null;
  /** `pages`' own length, or `0` while still loading (`pages === null`) — the Pages screen's TabBar
   *  count for this tab. Derived here (2026-09-04, complexity-ceiling pass) rather than as a
   *  `themePages?.length ?? 0` expression in the Pages screen itself, the same "derive it beside the
   *  state it reads" move. */
  pageCount: number;
  /**
   * The id of the theme `pages` came from — `null` until presentation settles.
   * Retained if the subsequent detail read fails, so that failure does not erase its prerequisite.
   *
   * Needed because each row links into the theme studio (`/admin/themes/explore?theme=&page=`) and
   * every publish call needs it, and a page id alone does not say WHICH theme's copy to act on.
   */
  activeThemeId: string | null;
  error: string | null;
  /**
   * The `pageId` of the row whose publish round trip is currently in flight, or `null`. Per-row
   * rather than one screen-wide flag: unlike Theme Studio's Explore (one file selected at a time),
   * every row here is visible and independently actionable at once, so disabling every switch while
   * any one of them saves would freeze rows that have nothing to do with the in-flight request.
   */
  savingPageId: string | null;
  /** Publish or unpublish one row. A no-op — no request, no state change — when `activeThemeId`
   *  hasn't resolved yet, matching `use-theme-explore.hooks.ts`'s own "acts on nothing rather than
   *  send a request that can't possibly be correct" shape for its equivalent guard. */
  setPagePublished: (pageId: string, published: boolean) => Promise<void>;
}

/**
 * `f.path.slice(f.path.lastIndexOf("/") + 1)` minus `.html` — the same basename-minus-extension
 * page id derivation `use-theme-explore.hooks.ts`'s `fileLabel` and `theme-explore-
 * dependencies.hooks.ts`'s fake `setPagePublished` both already use for this exact route. Kept as
 * its own one-line function here (rather than imported from a sibling feature) because this hook
 * has no other reason to reach into `features/themes` for one line of string arithmetic — the two
 * features independently agreeing on the same derivation is the port-narrowing convention this
 * file's own header describes, not an accidental duplication.
 *
 * @complexity O(1).
 */
function pageIdFromPath({ path }: { path: string }, _options = {}): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.html$/, "");
}

/**
 * Keep only `"page"`-group entries and map each to a {@link ThemePageRow}.
 *
 * @complexity O(n) in `entries.length` — one filter, one map, no nesting.
 */
function mapThemePageRows(entries: readonly ThemePagesFileEntry[]): ThemePageRow[] {
  return entries
    .filter((f) => f.group === "page")
    .map((f) => ({
      pageId: pageIdFromPath({ path: f.path }),
      filePath: f.path,
      published: f.published ?? null,
      resettable: f.resettable,
      collidingContent: f.collidingContent ?? null,
    }));
}

/** Action errors take precedence over presentation and dependent-detail load failures. */
function themePagesError({ actionError, presentationError, detailError }: {
  actionError: string | null; presentationError: Error | null; detailError: Error | null;
}): string | null {
  return actionError ?? presentationError?.message ?? detailError?.message ?? null;
}

/** Project the tab's loading/count state and action-before-load error precedence together. */
function themePagesDisplayState(
  { data, actionError, presentationError, detailError }: {
    data: { pages: ThemePageRow[] } | undefined;
    actionError: string | null;
    presentationError: Error | null;
    detailError: Error | null;
  },
  _options: Record<string, never> = {},
): Pick<ThemePagesController, "pages" | "pageCount" | "error"> {
  const pages = data?.pages ?? null;
  const error = themePagesError({ actionError, presentationError, detailError });
  const pageCount = pages === null ? 0 : pages.length;
  return { pages, pageCount, error };
}

/**
 * @complexity Time/space: O(1) plus the O(n) row mapping above — two chained round trips on mount,
 * one on each publish toggle.
 */
export function useThemePages(
  { port, noThemeId }: { port: ThemePagesPort; noThemeId: string },
  _optional: Record<string, never> = {},
): ThemePagesController {
  // Resolve prerequisites separately: a detail failure must not erase the theme id
  // already returned by presentation, and a switched theme owns a different detail key.
  const fetchPresentation = useCallback(async () => {
    try { return await port.getPresentation(); }
    catch (error) { throw new Error(error instanceof Error ? error.message : "failed to load theme pages"); }
  }, [port]);
  const presentation = useFetchQuery({ key: ["themes", "presentation"], fetch: fetchPresentation }, { staleTime: 0 });
  const activeThemeId = presentation.data?.settings.activeThemeId ?? null;
  const key = useMemo(() => ["themes", "page-publish-state", activeThemeId ?? ""] as const, [activeThemeId]);
  const fetchPages = useCallback(async () => {
    try {
      // `noThemeId` (the host's "no theme" sentinel) is an operator choice, not an id; fetching it would only 404.
      const detail = activeThemeId === null || activeThemeId === noThemeId ? null : await port.getThemeDetail({ themeId: activeThemeId });
      return { pages: detail ? mapThemePageRows(detail.files) : [] };
    } catch (error) { throw new Error(error instanceof Error ? error.message : "failed to load theme pages"); }
  }, [port, activeThemeId]);
  /* Read-lifecycle rationale retained from the preceding implementation.
   * The query cache now supplies these ordering and lifetime guarantees.
   * `noThemeId` ("none" in the host) is the operator-chosen no-theme sentinel, not a real theme id —
   * `getThemeDetail(noThemeId)` 404s server-side, which used to surface as this hook's
   * `error` and put an error banner on a screen the operator disabled on purpose. There is no
   * theme detail to fetch in that state, so this short-circuits straight to the same `[]` an
   * installed-but-pageless theme resolves to (`ThemePagesTab`'s existing empty state), rather
   * than making a call that can only ever fail.
   *
   */
  const query = useFetchQuery({ key, fetch: fetchPages }, { enabled: activeThemeId !== null, staleTime: 0 });
  const loader = useCachedLoader({ key, fetch: fetchPages }, { staleTime: 0 });
  const [actionError, setError] = useState<string | null>(null);
  const publish = useFetchMutation({ run: ({ input }: { input: { themeId: string; pageId: string; published: boolean } }) => port.setPagePublished({ themeId: input.themeId, page: input.pageId, published: input.published }) }, { invalidates: [["themes"]] });
  const [savingPageId, setSavingPageId] = useState<string | null>(null);

  const setPagePublished = useCallback(
    async (pageId: string, published: boolean) => {
      if (activeThemeId === null) return;
      setSavingPageId(pageId);
      setError(null);
      try {
        const r = await publish.mutate({ input: { themeId: activeThemeId, pageId, published } });
        const current = loader.peek();
        if (current) loader.replace({ value: { ...current, pages: current.pages.map(p => p.pageId === r.page ? { ...p, published: r.published } : p) } });
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to update publish state");
      } finally {
        setSavingPageId(null);
      }
    },
    [activeThemeId, publish.mutate, loader]
  );

  const { pages, pageCount, error } = themePagesDisplayState({
    data: query.data, actionError, presentationError: presentation.error, detailError: query.error,
  });

  return { pages, pageCount, activeThemeId, error, savingPageId, setPagePublished };
}
