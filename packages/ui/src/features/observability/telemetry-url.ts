/** Returns an HTTP(S) URL's origin/path, or a relative pathname, with no credentials/query/fragment.
 * Invalid and opaque URLs are omitted. O(n) time/space in input length. */
export function telemetryUrl({ value }: { value: unknown }, _options = {}): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || /\s/.test(value)) return undefined;
  try {
    const parsed = new URL(value, 'https://telemetry.invalid/');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return /^[a-z][a-z0-9+.-]*:|^\/\//i.test(value) ? `${parsed.origin}${parsed.pathname}` : parsed.pathname;
  } catch {
    return undefined;
  }
}
