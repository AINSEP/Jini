/** `{ query: "a=1" }` -> `"?a=1"`; an empty query string adds nothing to the path. */
export function querySuffix({ query }: { readonly query: string }, _optional: Record<string, never> = {}): string {
  return query ? `?${query}` : '';
}
