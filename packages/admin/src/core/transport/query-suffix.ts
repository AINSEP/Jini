/** `"a=1"` -> `"?a=1"`; an empty query string adds nothing to the path. */
export function querySuffix(query: string): string {
  return query ? `?${query}` : '';
}
