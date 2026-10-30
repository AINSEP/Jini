import { trimTrailingChars } from './trim-chars.js';
// Build a locale-segmented URL against a host-supplied base and locale-map,
// e.g. for linking out to a marketing/docs site in the reader's language.
//
// Ported from an origin helper that hardcoded one product's own marketing
// domain and locale table inline — that's product identity, not reusable
// logic, so it's dropped here. What's actually generic and worth keeping is
// the resolution algorithm: map the active locale to a URL segment (falling
// back to no segment — i.e. the base's default language — for locales the
// target site doesn't support), then join it onto the base. `baseUrl` and
// `localeSegments` are supplied by the caller.

export interface LocalizedUrlOptions {
  baseUrl: string;
  /** Maps a locale code to the target site's URL segment for that locale. */
  localeSegments?: Record<string, string>;
}

export function buildLocalizedUrl(locale: string, options: LocalizedUrlOptions): string {
  const base = trimTrailingChars(options.baseUrl, '/');
  const segment = options.localeSegments?.[locale];
  return segment ? `${base}/${segment}/` : `${base}/`;
}
