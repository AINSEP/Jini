/**
 * @file Site-timezone date formatting for rendered dates (Bug D, 2026-10-22).
 *
 * A stored timestamp is an instant (`...Z`); the calendar day a visitor should see for it depends on
 * the SITE's zone, not on whichever zone the rendering process happens to run in. Formatting with
 * `toLocaleDateString` and no `timeZone` used the server's zone (UTC in every deployment), so a post a
 * Los Angeles site published at 11pm showed the next day. Static pages have no JavaScript to correct
 * this in the browser, so the label must be right when the server renders it.
 *
 * The machine-readable `<time datetime>` value stays the unchanged ISO instant; only the human label
 * is zoned. Hosts supply the zone through {@link SiteTimeZonePort} (a site setting in practice); a
 * missing, failing or invalid zone renders UTC, the behavior every site had before.
 */

/** The zone used when a site has none configured, or a configured one is not a valid IANA name. */
export const DEFAULT_SITE_TIME_ZONE = "UTC";

/** Host-supplied read of a site's configured IANA zone. May return an unvalidated string. */
export interface SiteTimeZonePort {
  resolveTimeZone(required: { workspaceId: string }): Promise<string>;
}

/**
 * `timeZone` trimmed when `Intl` accepts it as a zone, else {@link DEFAULT_SITE_TIME_ZONE}. Pure.
 * @complexity O(1) — one formatter construction.
 */
export function normalizeTimeZone(required: { timeZone: unknown }, _optional: Record<string, never> = {}): string {
  if (typeof required.timeZone !== "string") return DEFAULT_SITE_TIME_ZONE;
  const trimmed = required.timeZone.trim();
  try {
    // `Intl.DateTimeFormat` throws a RangeError for an unknown zone; `""` is rejected the same way.
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return DEFAULT_SITE_TIME_ZONE;
  }
}

/**
 * The site's zone through `siteTimeZone`, normalized. Never throws: no port, a failing read, or an
 * invalid value all render {@link DEFAULT_SITE_TIME_ZONE}, so a settings outage cannot break a page.
 * @complexity One port read.
 */
export async function resolveSiteTimeZoneSafely(
  required: { workspaceId: string },
  optional: { siteTimeZone?: SiteTimeZonePort } = {},
): Promise<string> {
  if (!optional.siteTimeZone) return DEFAULT_SITE_TIME_ZONE;
  try {
    return normalizeTimeZone({ timeZone: await optional.siteTimeZone.resolveTimeZone(required) });
  } catch {
    return DEFAULT_SITE_TIME_ZONE;
  }
}

/** The parsed instant, or `undefined` for a malformed timestamp. */
function parseInstant(iso: string): Date | undefined {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * The short en-US label a post card or header shows (e.g. "Sep 3, 2026"), as the calendar day in
 * `timeZone` (default UTC; an invalid zone renders UTC). A malformed timestamp degrades to the raw
 * string rather than "Invalid Date". Pure.
 * @complexity O(1).
 */
export function formatDateLabel(required: { iso: string }, optional: { timeZone?: string } = {}): string {
  const parsed = parseInstant(required.iso);
  if (!parsed) return required.iso;
  const timeZone = normalizeTimeZone({ timeZone: optional.timeZone ?? DEFAULT_SITE_TIME_ZONE });
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
}

/**
 * The `YYYY-MM-DD` calendar day in `timeZone` (default UTC; an invalid zone renders UTC). A malformed
 * timestamp keeps the first ten characters, which is what the plain `iso.slice(0, 10)` this replaces
 * returned for it. Pure.
 * @complexity O(1).
 */
export function formatIsoDate(required: { iso: string }, optional: { timeZone?: string } = {}): string {
  const parsed = parseInstant(required.iso);
  if (!parsed) return required.iso.slice(0, 10);
  const timeZone = normalizeTimeZone({ timeZone: optional.timeZone ?? DEFAULT_SITE_TIME_ZONE });
  // `en-CA` formats a date as `YYYY-MM-DD`.
  return parsed.toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
}
