/**
 * @file Comparison key for literal redirect sources (Bug A, 2026-10-22).
 *
 * Imported WordPress permalinks (`/2022/06/13/craving/`) reach the store with or without their
 * trailing slash and with or without percent-encoding, while Express hands the resolver the
 * request path exactly as the visitor typed it. Comparing raw strings made such rules "active but
 * never matching". Exact matching and exact lookups compare this key instead; stored patterns and
 * the request path themselves are never rewritten.
 */

/** Decode one path segment; an encoded `/` stays encoded so it never reads as a separator. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment).replace(/\//g, "%2F");
  } catch {
    // A malformed escape is compared literally: it can only ever equal the same malformed text.
    return segment;
  }
}

/**
 * Whether two literal paths name the same resource under {@link redirectPathKey}.
 * @complexity O(a + b).
 */
export function sameRedirectPath(required: { a: string; b: string }, _optional: Record<string, never> = {}): boolean {
  return redirectPathKey({ path: required.a }, {}) === redirectPathKey({ path: required.b }, {});
}

/**
 * The canonical key two literal paths share when they name the same resource: segments
 * percent-decoded, trailing slashes dropped (root stays `/`). Case is preserved.
 * @param required.path A site-relative path or exact `fromPattern`.
 * @returns The comparison key.
 * @complexity O(path length).
 * @example redirectPathKey({ path: "/2022/06/13/craving/" }, {}); // "/2022/06/13/craving"
 */
export function redirectPathKey(required: { path: string }, _optional: Record<string, never> = {}): string {
  const decoded = required.path.split("/").map(decodeSegment).join("/");
  let end = decoded.length;
  while (end > 1 && decoded[end - 1] === "/") end -= 1;
  return decoded.slice(0, end) || "/";
}
