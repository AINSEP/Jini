/**
 * @file The one-time `#boot=<token>` fragment a zip-launched host opens the admin with (the host's
 * run-from-zip plan, Q2/S2). The
 * launcher opens `http://127.0.0.1:<port>/admin/#boot=<token>`; the host admin app's boot effect calls
 * {@link takeBootToken} once, on mount, to read the token and scrub it from the URL bar in the same
 * synchronous pass — before anything else in that effect runs, including the network call that
 * redeems it. No logic belongs in the host app's boot-effect `.tsx` sibling (memory
 * `component_logic_belongs_hooks`), so this pure helper is the one place that parses or mutates the
 * fragment.
 *
 * Security properties, each one load-bearing (plan's own "Warnings for writers" / Sign-in row):
 * - The token is read from `location.hash`, which the browser never sends to the server and never
 *   puts in a `Referer` header — unlike a query string, which both do.
 * - `history.replaceState` runs before this function returns, so the token spends at most one
 *   paint in the URL bar and is never pushed as its own history entry (a `pushState` or a real
 *   navigation would leave it in Back history forever).
 * - This module never logs the token and never returns it to anything but its one caller.
 */

/** The subset of `Location` this module reads. Narrowed (not the whole DOM `Location`) so a test
 *  can pass a plain object instead of a real `window.location`. */
type BootTokenLocation = Pick<Location, "hash" | "pathname" | "search">;

/** The subset of `History` this module writes through. Narrowed to the one method used, for the
 *  same testability reason as {@link BootTokenLocation}. */
type BootTokenHistory = Pick<History, "replaceState">;

/**
 * Reads and consumes a `#boot=<token>` fragment.
 *
 * @param location - `window.location` (or an equivalent) — read only, never written.
 * @param history - `window.history` (or an equivalent) — `replaceState` is called at most once,
 *   only when a non-empty `boot` param was actually found.
 * @returns the raw token, or `null` when the hash has no non-empty `boot` param. A `null` result
 *   never calls `replaceState` — there is nothing to remove, so the URL is left exactly as it was.
 * @complexity O(n) in the number of `&`-separated hash params; one `URLSearchParams` pass, no
 *   nested iteration.
 */
export function takeBootToken({ location, history }: { location: BootTokenLocation; history: BootTokenHistory }, _optional: Record<string, never> = {}): string | null {
  const rawHash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(rawHash);
  const token = params.get("boot");
  if (!token) return null;

  // Every OTHER hash param is kept, in place, next to the ones present before this ran — only
  // `boot` itself is removed. An empty remainder collapses to no hash at all, rather than a bare
  // trailing `#`.
  params.delete("boot");
  const rest = params.toString();
  const fragment = rest ? "#" + rest : "";
  const nextUrl = `${location.pathname}${location.search}${fragment}`;
  history.replaceState(null, "", nextUrl);

  return token;
}
