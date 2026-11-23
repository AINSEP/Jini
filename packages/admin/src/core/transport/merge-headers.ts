/**
 * @file The one request-header merge stage. `createHttpTransport` (`./http.ts`) and
 * `createAdminHttp` (`shell/lib/admin-http/request.ts`) both call it, so the JSON default, the
 * case-insensitive precedence and the HeadersInit handling have a single body.
 */

/** A merged header set: one entry per case-insensitive name, spelled as its winning source spelled it. */
export type MergedHeaders = Record<string, string>;

/**
 * Headers normalizes names and accepts every HeadersInit form; object spreads lose
 * Headers instances and treat tuple arrays as numeric keys instead of header entries.
 * Later sources win: the JSON default, then the transport's own, then the call's.
 *
 * A caller's own `Content-Type`, in any letter case, replaces the default outright, since two
 * values would be sent joined with a comma. Values are read through `Headers`, so duplicates
 * within one source combine exactly as `fetch` would combine them; inputs are never mutated.
 *
 * @complexity O(h) in the total header count across sources.
 */
export function mergeRequestHeaders(
  { sources }: { readonly sources: readonly (HeadersInit | undefined)[] },
  _optional: Record<string, never> = {},
): MergedHeaders {
  const merged = new Map<string, readonly [name: string, value: string]>([['content-type', ['Content-Type', 'application/json']]]);
  for (const source of sources) {
    if (source === undefined) continue;
    const spelling = sourceSpellings({ source });
    new Headers(source).forEach((value, name) => merged.set(name, [spelling.get(name) ?? name, value]));
  }
  return Object.fromEntries(merged.values());
}

/** The caller's own spelling of each header name; a Headers instance has already lowercased them. */
function sourceSpellings({ source }: { readonly source: HeadersInit }): Map<string, string> {
  if (source instanceof Headers) return new Map();
  const entries: readonly (readonly string[])[] = Array.isArray(source) ? source : Object.entries(source);
  return new Map(entries.map(([name = '']) => [name.toLowerCase(), name]));
}
