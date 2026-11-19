/**
 * Builds a route template from the host's base and captured params, dropping queries and fragments.
 * Unmatched segments retain their encoding; malformed encoding stays raw rather than throwing.
 * @complexity O(p + s) map operations for p params and s segments; O(p + s) auxiliary space.
 */
export function toRouteTemplate(
  { base, routePath, params }: { base: string; routePath: string; params: Readonly<Record<string, string>> },
  _optional: Record<string, never> = {},
): string {
  const queryOrFragment = routePath.search(/[?#]/);
  const path = queryOrFragment === -1 ? routePath : routePath.slice(0, queryOrFragment);
  const names = new Map(Object.entries(params).map(([name, value]) => [value, name]));
  const segments = path.split('/').filter(Boolean).map((segment) => {
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch { /* Keep malformed encoding raw. */ }
    const name = names.get(decoded);
    return name ? `:${name}` : segment;
  });
  return [base, ...segments].join('/');
}
