/** Guards reference keys that become URL path segments, so lookup and rendering share the same shape check.
 * @complexity O(n) in the reference length, with a 200-character bound; no I/O.
 */
export function isPlausibleMediaRefId({ value }: { value: unknown }, _optional: Record<string, never> = {}): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[^\s/]+$/.test(value);
}

export function plausibleMediaRefId({ value }: { value: unknown }, _optional: Record<string, never> = {}): string | undefined { return isPlausibleMediaRefId({ value }) ? (value as string) : undefined; }
