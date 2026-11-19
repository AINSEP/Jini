/**
 * @file The CSRF gate for browser writes.
 *
 * Why on top of a `SameSite=Strict` session cookie: a browser request must prove it came from
 * this origin's own scripts. A browser always sends `Origin` on a cross-origin or POST fetch,
 * and a sandboxed frame's requests carry `Origin: null`, which never matches: the frame must
 * go through the host page. Fetch metadata, when the browser sends it, must agree. This is
 * browser protection, not proof against a client that forges every header; such a client
 * still needs the session cookie.
 */

/** The host of a bare http(s) origin string, or null for anything else (including "null"). */
function originHost({ origin }: { origin: string }, _optional: Record<string, never> = {}): string | null {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === origin ? url.host : null;
  } catch {
    return null;
  }
}

/** True only for a browser request whose `Origin` is exactly this server's host.
 * @complexity O(1). */
export function isSameOriginBrowserWrite(
  required: { readonly origin: string | undefined; readonly host: string | undefined; readonly fetchSite: string | undefined },
  _optional: Record<string, never> = {},
): boolean {
  const { origin, host, fetchSite } = required;
  if (!origin || !host) return false;
  if (fetchSite !== undefined && fetchSite !== "same-origin") return false;
  return originHost({ origin }) === host;
}
