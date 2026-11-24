/**
 * @file Whether a url belongs to a site this launch supervises — the origin test behind the host's
 * guest navigation policy and speech sender check, extracted so it is verified without Electron.
 * It is the predicate `guest-navigation.ts`'s `isSupervisedGuestUrl` port expects a host to supply.
 */

/**
 * `true` when `raw` parses as a URL whose origin is one of `sites`' own server origins. An
 * unparseable url is never supervised.
 *
 * @complexity O(n) in `sites`.
 */
export function isSupervisedSiteUrl(
  { raw, sites }: { raw: string; sites: Iterable<{ readonly server: { readonly origin: string } }> },
  _optional = {},
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return [...sites].some((entry) => new URL(entry.server.origin).origin === url.origin);
}
