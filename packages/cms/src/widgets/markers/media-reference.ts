/** Mirrors the public renderer's `MAX_MEDIA_REF_ID_LENGTH`/`PLAUSIBLE_MEDIA_REF_ID_PATTERN`
 * shape check for an assetId/transformName that will become a `/m/` URL path segment. Widgets
 * must not depend on the host renderer above it in the layering: this check guards repository
 * lookup keys, and the renderer re-checks immediately before URL templating as defense in depth.
 * Shared by media and gallery config so their media-reference contracts cannot drift.
 * @complexity O(n) in the reference length, with a 200-character bound; no I/O.
 */
export function isPlausibleMediaRefId({ value }: { value: unknown }, _optional: Record<string, never> = {}): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[^\s/]+$/.test(value);
}
