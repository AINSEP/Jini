/**
 * @file Route model types.
 *
 * ## Route paths vs URLs — the distinction this module exists to keep straight
 *
 * Carried over from Tovu's `lib/router.ts`, where collapsing these two is documented as the exact
 * mistake that produced `/admin/#/section/settings` URLs:
 *
 * - a **route path** is base-agnostic and is what the matcher consumes: `/`, `/settings`,
 *   `/posts/abc`
 * - a **URL** is what goes in an `href` or the address bar: `/admin/`, `/admin/settings`
 *
 * `adminHref` converts the first into the second; `currentRoutePath` recovers the first from a
 * pathname. Nothing else should be doing string surgery on a location.
 */

/** A resolved route. */
export interface AdminRoute {
  /**
   * The matched panel's id, or `null` when nothing matched.
   *
   * `null` is not an error state the shell must handle specially — the documented behaviour, kept
   * from Tovu, is that an unrecognized path falls through to the dashboard rather than rendering
   * an empty placeholder for a typo.
   */
  readonly panelId: string | null;

  /**
   * Which of the panel's views to render. `null` means the panel's own index view (`/users`), as
   * opposed to one of its detail routes (`/users/abc`).
   */
  readonly view: string | null;

  /** Captured `:name` segments from the matched pattern. Empty for an index route. */
  readonly params: Readonly<Record<string, string>>;

  /** Parsed query string. Always present, possibly empty. */
  readonly query: URLSearchParams;
}
