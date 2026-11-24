import type { DashboardActivityRow, DashboardSiteKeyState } from "../dashboard-view.types.js";

/**
 * @file What `use-dashboard.hooks.ts` needs from the outside world, as an interface rather than a
 * direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md` (canonical spec) and
 * `Jini redirects/SOURCE-RATIONALE.md` (canonical reference implementation): this file declares,
 * `dashboard-dependencies.hooks.ts` binds the real `api` client, and nothing else under
 * `features/dashboard` imports `lib/api`.
 *
 * `listMedia`/`listCommentsQueue`/`getPresentation` are narrowed to only the field this hook
 * actually reads off each response (an active-status flag, an items count, one theme id) — same
 * narrowing precedent `theme-pages-port.hooks.ts` uses for its own `getPresentation()` slice.
 * `listPosts`/`listPages` keep the full `AdminPost` shape: both the stat cards AND the merged
 * "Recently updated" activity list (`rules.ts`'s `mergeRecent`/`activityRowHref`) read several
 * fields off the same rows, the same "genuinely used in full" case `media-port.hooks.ts` names for
 * keeping `AdminMedia` unnarrowed.
 * Now: the HOST binds its real API clients into a `DashboardPort` and its own `useWiredDashboard`,
 * and nothing in this screen imports a client (`redirects/SOURCE-RATIONALE.md` is the reference
 * implementation). `listPosts`/`listPages` deliver {@link DashboardActivityRow}; a host's full post
 * type satisfies it structurally.
 */
export interface DashboardPort {
  listPosts(): Promise<{ posts: Array<{ post: DashboardActivityRow }> }>;
  listPages(): Promise<{ posts: Array<{ post: DashboardActivityRow }> }>;
  listMedia(): Promise<{ media: Array<{ status: string }> }>;
  listCommentsQueue(options: { status: "pending" }, optional?: Record<string, never>): Promise<{ items: unknown[] }>;
  getPresentation(): Promise<{ settings: { activeThemeId: string }; availableThemes?: Array<{ id: string; name?: string }> }>;
  /** Password-banner plan (2026-09-24), Slice 3 — whether the SIGNED-IN caller's own stored
   *  credential still verifies against the default password (`GET /auth/me/password-status`,
   *  Slice 2). A sixth independent read, same "each source owns its own error slot" shape the rest
   *  of this port already documents above. `principalId` is the caller's own id (from `/auth/me`),
   *  so the per-browser Dismiss is remembered per user — another account signing in on the same
   *  browser still gets its own nag. */
  getPasswordStatus(input?: { principalId?: string | null }): Promise<{ usesDefaultPassword: boolean; principalId: string }>;
  /** Site-key plan (2026-09-24) §A.6 — a seventh independent read, same "each source owns its own
   *  error slot, advisory, swallowed on failure" shape `getPasswordStatus` above documents. Narrowed
   *  to just `state` (`GET .../system/site-key`'s full response also carries `active`/`source`/
   *  `fingerprint`/`keyFilePath`, none of which the dashboard's own warning banner needs — the
   *  Security → site key tab is the one place that reads the rest). */
  getSiteKeyState(): Promise<{ state: DashboardSiteKeyState }>;
}
