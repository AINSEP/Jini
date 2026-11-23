import { useCallback, useState } from "react";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import type { QueryResult } from "@jini-ai/core/fetch";
import { useFetchQuery, useInvalidate } from "../../../react/kit.js";
import { useContentRefreshSubscription } from "../../../shell/hooks/use-content-refresh-subscription.hooks.js";

import type { DashboardActivityRow } from "../dashboard-view.types.js";
import { ACTIVE_THEME_RESOURCE, activeThemeName, mergeRecent, shouldShowDefaultPasswordBanner, shouldShowSiteKeyBanner, siteKeyBannerCopy } from "../rules.js";
import { t as translate } from "../dashboard-i18n.js";

import type { DashboardPort } from "./dashboard-port.hooks.js";
import { useAdminBootScope } from "../../../shell/lib/admin-boot-scope.js";

import { type Translate } from '@jini-ai/core/text';
/** Best-effort read — `localStorage` throws outright in some privacy modes (same caveat
 *  a draft-backup store documents at length). A read that fails just shows the
 *  banner again, which is harmless: it is advisory and its truth is recomputed from the server on
 *  every load (see `rules.ts`'s `shouldShowDefaultPasswordBanner`).
 *  @complexity Time/space: O(1). */
function readDefaultPasswordBannerDismissedBy({ storageKey }: { storageKey: string }, _optional = {}): string | null {
  return orFallbackSync({ work: () => {
    return localStorage.getItem(storageKey);
  }, fallback: null, step: "Read password banner dismissal" });
}

/** Best-effort write — silent no-op on any storage failure, for the same reason the read above is.
 *  @complexity Time/space: O(1). */
function writeDefaultPasswordBannerDismissedBy({ storageKey, principalId }: { storageKey: string; principalId: string }, _optional = {}): void {
  // best-effort; see this file's header note on the Dismiss control.
  orFallbackSync({ work: () => {
    localStorage.setItem(storageKey, principalId);
  }, fallback: undefined, step: "Remember password banner dismissal" });
}

/**
 * @file Everything the Dashboard screen loads, so `Dashboard.tsx` is only markup.
 *
 * Extracted verbatim — same state, same order, same effect, same error strings.
 *
 * Error handling: every fetch owns its own error slot rather than sharing one, because these are
 * independent data sources and a failed comment count should not blank a post count that loaded
 * fine (audit finding, `ADS-memory/reports/audits/20260801-admin-adversarial-ux-audit.md`, exec
 * summary #5 — the original had no `.catch()` at all, so any rejection left the cards showing "…"
 * forever with no indication anything was wrong). A failed stat renders an em-dash plus the reason
 * in its own card, at the same size the healthy card occupies; see `.jini-dash-stat-*.is-error`.
 *
 * @tradeoffs Five GETs on the landing screen instead of the previous two. Accepted because each is
 * a list this admin already serves elsewhere, they run concurrently, and none blocks render — the
 * screen paints its full layout immediately and each value fills in independently. The alternative
 * (a single aggregate `/dashboard` endpoint) would be one round trip but needs a new server route
 * and a new response contract to maintain; that is worth doing if this screen grows, and is not
 * worth it for five reads that already exist.
 *
 * Counts are `list().length`, not a server-side count, so they are bounded by whatever page size
 * those endpoints return. Correct for the scale this admin targets today; if any list grows past a
 * single page the count silently becomes "items on the first page" and would need a real count
 * endpoint. Flagged rather than pre-solved.
 *
 * `deps.port` is injected (see `dashboard-port.hooks.ts`) rather than reaching for an API client
 * directly, so a test can describe each of the five reads against `createFakeDashboardPort`
 * instead of stubbing global `fetch`. The host's own `useWiredDashboard` is the
 * zero-argument-dependencies pair it hands `Dashboard.tsx` as `useDashboardHook`.
 *
 * `deps.t`/`deps.locale` (2026-08-11, standing i18n rule — a component with a hook gets a BOUND
 * `t` from that hook, not its own `useAdminLocale()`/dictionary import) are ALSO now injected
 * dependencies rather than values this hook resolved for itself: `Dashboard.tsx` needs a bound
 * translator, and `deps.locale` is what THIS hook's own error strings resolve against via the
 * `translate(locale, key)` two-arg import (aliased to avoid colliding with the injected one-arg
 * `t`). The host's `useWiredDashboard` resolves both from its own admin-locale hook.
 *
 * `deps.describeError` and `deps.passwordBannerDismissedKey` are the host's too: the first is its
 * API client's error-to-copy base case (which errors may show their own words is the client's
 * contract, not this screen's), the second a storage key namespaced under the host's own prefix.
 *
 * 2026-08-14: this closes the port-conversion gap an earlier pass in this file's history left
 * disclosed ("NOT converted to the full port pattern... scoped as i18n-only... left as a disclosed
 * gap, not silently expanded") — the dispatch that added `deps.t` deliberately deferred the
 * 5-endpoint port because it was a materially larger diff than that pass's own scope; this pass's
 * scope is exactly "convert the admin DI seams still missing one," so the deferred half lands now.
 */

export interface StatState {
  value: number | null;
  error: string | null;
}

const PENDING: StatState = { value: null, error: null };

export interface DashboardController {
  posts: StatState;
  published: number | null;
  pages: StatState;
  drafts: number | null;
  media: StatState;
  comments: StatState;
  themeId: string | null;
  /** The active theme's `theme.json` display name, or its id when it has none — what the
   *  Appearance card shows. `null` until the presentation read settles. */
  themeName: string | null;
  themeError: string | null;
  /** `null` until at least one of `listPosts`/`listPages` settles — the caller renders a loading
   *  state for the "Recently updated" panel. */
  recent: DashboardActivityRow[] | null;
  /** Bound translator — `key` already resolved against the caller's locale, so `Dashboard.tsx`
   *  never imports `useAdminLocale`/`DASHBOARD_DICT` itself. See this file's header. */
  t: Translate;

  /** Password-banner plan (2026-09-24), Slice 3 — whether the default-password nag should render.
   *  `rules.ts`'s `shouldShowDefaultPasswordBanner`, applied to this hook's own fetched status and
   *  dismissed flag. */
  showDefaultPasswordBanner: boolean;
  /** Hides the banner for this browser and persists that choice (best-effort). */
  dismissDefaultPasswordBanner: () => void;

  /** Site-key plan (2026-09-24) §A.6 — whether the site-key warning banner should render.
   *  `rules.ts`'s `shouldShowSiteKeyBanner`, applied to this hook's own fetched state. */
  showSiteKeyBanner: boolean;
  /** The banner's own copy for the current state (`rules.ts`'s `siteKeyBannerCopy`) — `""` whenever
   *  {@link showSiteKeyBanner} is `false`. */
  siteKeyBannerMessage: string;
}

export interface DashboardDependencies {
  port: DashboardPort;
  /** Resolves this hook's OWN `describeApiError` fallback strings via the direct `translate`
   *  import above — see this file's header for why that's a separate concern from `t`. */
  locale: string;
  /** Bound translator, passed straight through to {@link DashboardController.t} — see this file's
   *  header for why it arrives as a dependency rather than this hook calling `useAdminLocale()`
   *  itself. */
  t: Translate;
  /** The host API client's error-to-copy base case: the rejection's own words when the client
   *  vouches for them, else `fallback`. */
  describeError: (input: { e: unknown; fallback: string }) => string;
  /** Per-browser storage key for the default-password Dismiss. The stored value is the principal
   *  id that dismissed it, so a different user signing in on the same browser still sees their own
   *  nag. Namespace it under the host's own prefix so it can never collide with an unrelated key. */
  passwordBannerDismissedKey: string;
}

type DescribeError = DashboardDependencies["describeError"];

/** Runs one stat read and, on rejection, rethrows it as this hook's own message: the rejection's
 *  own text when the host's `describeError` vouches for it, else `key` translated against `locale`.
 *  @complexity Time/space: O(1) beyond the read itself. */
async function readOrDescribe<T>({ read, locale, key, describeError }: { read: () => Promise<T>; locale: string; key: string; describeError: DescribeError }): Promise<T> {
  try { return await read(); }
  catch (error) { throw new Error(describeError({ e: error, fallback: translate({ locale, key }) })); }
}

/** The five stat reads, each owning its own query and error slot (see this file's header).
 *  @complexity Time/space: O(n) per settled list read for the `entry.post` unwrap. */
function useStatQueries({ port, locale, describeError }: { port: DashboardPort; locale: string; describeError: DescribeError }) {
  const postsQueryFetch = useCallback(() => readOrDescribe({
    read: async () => (await port.listPosts()).posts.map(entry => entry.post), locale, key: "failed to load posts", describeError,
  }), [port, locale, describeError]);
  // Posts and pages each feed a stat card and the merged activity list from one shared read.
  const postsQuery = useFetchQuery({ key: ["posts", "list"], fetch: postsQueryFetch }, { staleTime: 0 });
  const pagesQueryFetch = useCallback(() => readOrDescribe({
    read: async () => (await port.listPages()).posts.map(entry => entry.post), locale, key: "failed to load pages", describeError,
  }), [port, locale, describeError]);
  const pagesQuery = useFetchQuery({ key: ["pages", "list"], fetch: pagesQueryFetch }, { staleTime: 0 });
  const mediaQueryFetch = useCallback(() => readOrDescribe({ read: () => port.listMedia(), locale, key: "failed to load media", describeError }), [port, locale, describeError]);
  const mediaQuery = useFetchQuery({ key: ["media"], fetch: mediaQueryFetch }, { staleTime: 0 });
  const commentsQueryFetch = useCallback(() => readOrDescribe({
    read: () => port.listCommentsQueue({ status: "pending" }), locale, key: "failed to load comments", describeError,
  }), [port, locale, describeError]);
  const commentsQuery = useFetchQuery({ key: ["dashboard", "pending-comments"], fetch: commentsQueryFetch }, { staleTime: 0 });
  const themeQueryFetch = useCallback(() => readOrDescribe({
    read: () => port.getPresentation(), locale, key: "failed to load the active theme", describeError,
  }), [port, locale, describeError]);
  const themeQuery = useFetchQuery({ key: THEME_KEY, fetch: themeQueryFetch }, { staleTime: 0 });
  useActiveThemeRefresh();
  return { postsQuery, pagesQuery, mediaQuery, commentsQuery, themeQuery };
}

/** Shared with the Themes screen's presentation read, so either screen's reload serves both. */
const THEME_KEY = ["themes", "presentation"] as const;

/** Re-reads the active theme when content changes out of band — a chat run's `theme_set_active`
 *  while the Dashboard stays mounted beside the dock (owner 11-02: the Appearance card kept the
 *  previous theme's name). Mount reads already cover activations made on the Themes screen.
 *  @complexity O(1) per notification; one presentation re-read. */
function useActiveThemeRefresh(): void {
  const invalidate = useInvalidate();
  const refresh = useCallback(() => invalidate({ key: THEME_KEY }), [invalidate]);
  useContentRefreshSubscription({ resource: ACTIVE_THEME_RESOURCE, onRefresh: refresh });
}

/** One stat card's state: `count({ data })` once the read settles, `null` while pending or failed.
 *  @complexity Time/space: whatever `count` costs. */
function statState<T>({ query, count }: { query: QueryResult<T>; count: (required: { data: T }, optional?: Record<string, never>) => number }): StatState {
  return { value: query.data === undefined ? null : count({ data: query.data }), error: query.error?.message ?? null };
}

/** How many `rows` carry `status`, or `null` while the rows are still pending.
 *  @complexity Time: O(n); space: O(n) for the filtered copy. */
function countWithStatus({ rows, status }: { rows: ReadonlyArray<{ status: string }> | undefined; status: string }): number | null {
  return rows?.filter(row => row.status === status).length ?? null;
}

/** Posts and pages feed both counts and activity without another request — `null` until at least
 *  one of the two settles.
 *  @complexity Time: O(n log n) via `mergeRecent`. */
function recentActivity({ posts, pages }: { posts: DashboardActivityRow[] | undefined; pages: DashboardActivityRow[] | undefined }): DashboardActivityRow[] | null {
  return posts || pages ? mergeRecent({ prev: posts ?? null, incoming: pages ?? [] }) : null;
}

type DashboardStats = Pick<DashboardController,
  "posts" | "published" | "pages" | "drafts" | "media" | "comments" | "themeId" | "themeName" | "themeError" | "recent">;

/** Every stat field the controller carries, derived from the five settled-or-pending reads.
 *  @complexity Time: O(n log n) in the combined post/page row count (the `recent` merge). */
function deriveStats(queries: ReturnType<typeof useStatQueries>): DashboardStats {
  const { postsQuery, pagesQuery, mediaQuery, commentsQuery, themeQuery } = queries;
  return {
    posts: statState({ query: postsQuery, count: ({ data: rows }, _optional = {}) => rows.length }),
    published: countWithStatus({ rows: postsQuery.data, status: "published" }),
    pages: statState({ query: pagesQuery, count: ({ data: rows }, _optional = {}) => rows.length }),
    drafts: countWithStatus({ rows: pagesQuery.data, status: "draft" }),
    media: statState({ query: mediaQuery, count: ({ data }, _optional = {}) => data.media.filter(item => item.status === "active").length }),
    comments: statState({ query: commentsQuery, count: ({ data }, _optional = {}) => data.items.length }),
    themeId: themeQuery.data?.settings.activeThemeId ?? null,
    themeName: themeQuery.data ? activeThemeName(themeQuery.data) : null,
    themeError: themeQuery.error?.message ?? null,
    recent: recentActivity({ posts: postsQuery.data, pages: pagesQuery.data }),
  };
}

/** The default-password nag: its advisory status read plus the per-browser dismiss.
 *  @complexity Time/space: O(1) per render. */
function useDefaultPasswordBanner({ port, storageKey }: { port: DashboardPort; storageKey: string }): Pick<DashboardController, "showDefaultPasswordBanner" | "dismissDefaultPasswordBanner"> {
  // Failed advisory status reads mean no banner, not a stat error or evidence of a safe state.
  const { principalId, queryScope } = useAdminBootScope();
  const passwordQueryFetch = useCallback(() => port.getPasswordStatus({ principalId }), [port, principalId]);
  const passwordQuery = useFetchQuery({ key: ["identity", "password-status", queryScope], fetch: passwordQueryFetch });
  // null until the status fetch settles (or forever if it fails): the banner is advisory,
  // so shouldShowDefaultPasswordBanner treats unknown status as "don't show".
  const passwordStatus = passwordQuery.data ?? null;
  // Lazy initializer: read once, at mount, not on every render.
  const [dismissedBy, setDismissedBy] = useState<string | null>(() => readDefaultPasswordBannerDismissedBy({ storageKey }));
  return {
    showDefaultPasswordBanner: shouldShowDefaultPasswordBanner(
      { usesDefault: passwordStatus?.usesDefaultPassword ?? null,
      dismissed: passwordStatus !== null && dismissedBy === passwordStatus.principalId },
    ),
    dismissDefaultPasswordBanner: () => {
      if (passwordStatus === null) return;
      writeDefaultPasswordBannerDismissedBy({ storageKey, principalId: passwordStatus.principalId });
      setDismissedBy(passwordStatus.principalId);
    },
  };
}

/** The site-key warning: its advisory status read plus the banner's copy.
 *  @complexity Time/space: O(1) per render. */
function useSiteKeyBanner({ port, t }: { port: DashboardPort; t: Translate }): Pick<DashboardController, "showSiteKeyBanner" | "siteKeyBannerMessage"> {
  // Site-key plan §A.6 — same advisory shape as the password status read:
  // a failed fetch means no banner, not an error card.
  const siteKeyQueryFetch = useCallback(() => port.getSiteKeyState(), [port]);
  const siteKeyQuery = useFetchQuery({ key: ["site-key", "state"], fetch: siteKeyQueryFetch }, { staleTime: 0 });
  // undefined until the site-key status fetch settles (or forever if it fails).
  // shouldShowSiteKeyBanner treats undefined as "don't show".
  const siteKeyState = siteKeyQuery.data?.state;
  return { showSiteKeyBanner: shouldShowSiteKeyBanner({ state: siteKeyState }), siteKeyBannerMessage: siteKeyBannerCopy({ state: siteKeyState, t }) };
}

/**
 * @param deps `port`/`locale`/`t`/`describeError`/`passwordBannerDismissedKey` — see {@link DashboardDependencies}.
 * @returns The dashboard screen's full controller — see {@link DashboardController}.
 * @complexity Time/space: O(1) per call — five independent, concurrent round trips on mount.
 */
export function useDashboard({ port, locale, t, describeError, passwordBannerDismissedKey }: DashboardDependencies): DashboardController {
  const stats = deriveStats(useStatQueries({ port, locale, describeError }));
  return { ...stats, t, ...useDefaultPasswordBanner({ port, storageKey: passwordBannerDismissedKey }), ...useSiteKeyBanner({ port, t }) };
}

