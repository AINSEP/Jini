// Generic `Intl`-backed timezone helpers: detect the runtime's local IANA
// timezone, list every timezone the runtime knows about, and derive a short
// "city" label from a timezone id for compact UI display. Framework-free —
// no React, no DOM beyond the standard `Intl` global.
//
// Pure Intl utilities live here so schedule-picker and other features share the same rules.

/** A conservative fallback list used only when the runtime doesn't support
 *  `Intl.supportedValuesOf('timeZone')` (e.g. older JS engines). */
const FALLBACK_TIMEZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
] as const;

/**
 * Resolve the runtime's local IANA timezone (e.g. `'America/Los_Angeles'`).
 * Falls back to `'UTC'` if `Intl` throws or resolves nothing.
 */
export function detectLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Every IANA timezone id the runtime knows about (via
 * `Intl.supportedValuesOf('timeZone')`), always including `'UTC'`. Falls
 * back to a small hardcoded list on runtimes without `supportedValuesOf`.
 */
export function listSupportedTimezones(): string[] {
  try {
    const fn = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof fn === 'function') {
      const list = fn('timeZone');
      if (Array.isArray(list) && list.length > 0) {
        return list.includes('UTC') ? list : ['UTC', ...list];
      }
    }
  } catch {
    /* fall through to the static fallback list below */
  }
  return [...FALLBACK_TIMEZONES];
}

/**
 * Short display label for a timezone id: `'UTC'` stays `'UTC'`; anything
 * else takes the last `/`-segment and replaces underscores with spaces
 * (`'America/Los_Angeles'` -> `'Los Angeles'`).
 */
export function tzCityLabel(timezone: string): string {
  if (timezone === 'UTC') return 'UTC';
  // `String.split` always returns an array with at least one element, so
  // `.pop()` on it is never `undefined` here — the non-null assertion just
  // satisfies `Array.prototype.pop`'s generically-optional return type.
  const last = timezone.split('/').pop()!;
  return last.replace(/_/g, ' ');
}
