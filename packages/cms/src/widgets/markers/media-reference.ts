/** `assetId`/`transformName` become media URL path segments, so shape is checked before
 * either value is trusted into a path: non-empty, bounded, and free of `/`/whitespace so an
 * author-authored ref can never smuggle an extra path segment. An id that fails this is treated
 * exactly like an absent transform name: safe placeholder degrade, never a malformed URL.
 * Shared by media and gallery config and document rendering so their media-reference contracts cannot drift.
 * @complexity O(n) in the reference length, with a 200-character bound; no I/O.
 */
export function isPlausibleMediaRefId({ value }: { value: unknown }, _optional: Record<string, never> = {}): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[^\s/]+$/.test(value);
}

export function plausibleMediaRefId({ value }: { value: unknown }, _optional: Record<string, never> = {}): string | undefined { return isPlausibleMediaRefId({ value }) ? (value as string) : undefined; }
