/**
 * @file Which chat links count as "the owner's own site or admin".
 *
 * Owner decision 2026-11-21 (reverses 2026-10-08, when every chat link opened a new tab): a link to
 * the owner's own site or admin navigates the current tab from its text, with a small icon right
 * after it for a new tab. Links to any other website keep opening a new tab. This is the one place
 * that decides which is which, so the markdown renderer (which draws the icon) and the pane's click
 * guard (which leaves own links to the browser or the host's router) cannot disagree.
 */

/** The page's own origin, or `''` where there is no `window` (server render), which matches nothing. */
export function currentOrigin(_required: Record<string, never> = {}, _options = {}): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

/**
 * Whether `href` points at `origin`'s own site: an in-app path, or an absolute URL on exactly that
 * origin (scheme, host and port). A same-document `#anchor`, `mailto:`, a protocol-relative `//host`
 * and anything unparseable are not own links, so each keeps the behaviour it had.
 *
 * @param input.href - The link target as written (a path) or resolved (absolute).
 * @param input.origin - The origin that counts as own; usually {@link currentOrigin}.
 * @returns `true` when the link text should navigate this tab.
 * @complexity O(n) in the href length (one URL parse); no I/O.
 */
export function isOwnLinkHref({ href, origin }: { href: string; origin: string }, _options = {}): boolean {
  if (href.startsWith('//')) return false;
  if (href.startsWith('/')) return true;
  try {
    return origin !== '' && new URL(href).origin === origin;
  } catch {
    return false;
  }
}
