/**
 * @file The canonical author-link href allowlist (`isAllowedHref`) and its accepted-shapes description.
 * Lives beside `menu-service.ts` (its first consumer) in its own file so the menu service stays under
 * its size ceiling.
 */

/**
 * Fixed placeholder origin {@link isAllowedHref} resolves a claimed same-origin-relative href
 * against, to compare the RESOLVED origin rather than the raw string shape. Mirrors
 * the host's public renderer's identically-named constant
 * byte-for-byte — see that file's own header for why a fixed placeholder origin is sufficient (only
 * the relationship between the resolved URL's origin and this one is ever inspected, never the
 * placeholder value itself).
 */ 
// eslint-disable-next-line sonarjs/no-clear-text-protocols -- Reserved .invalid sentinel used only for URL parsing and origin comparison; no request is made.
const SAFE_HREF_RESOLUTION_BASE = "http://safehref.invalid/";
const SAFE_HREF_RESOLUTION_ORIGIN = new URL(SAFE_HREF_RESOLUTION_BASE).origin;

/**
 * The CANONICAL href allowlist for an author-authored link — same accepted shapes (`#…`, same-origin
 * `/…`, `http(s)://`, `mailto:`) as the host's render-time `safeHref` in `render.ts` and its
 * `features/theme/static-render.ts` duplicate. **This is now the single source of truth** exported
 * from this package's public surface (`navigation/index.ts` -> `@jini-ai/cms/navigation`) so the
 * dependency runs the direction that is actually legal — the host already depends on `@jini-ai/cms`, not
 * the reverse — rather than each consumer hand-copying the predicate.
 *
 * The two host-side copies (`render.ts:252`, `features/theme/static-render.ts:210`, both a coercing
 * `value => passes ? value : "#"` wrapper around the identical predicate below) have **not yet been
 * retired to import this** — that edit is intentionally out of this change's scope (a
 * `check:boundaries` no-deep-import concern is NOT what blocks it: `render.ts` already imports
 * `@jini-ai/cms/core` today, and `features/theme` already imports `@jini-ai/cms/core` too, so both
 * call sites may legally import `@jini-ai/cms/navigation` directly — verified by grep, not assumed).
 * Until that follow-up lands, the host's menu href allowlist sync check
 * behaviorally gates the three copies against the same adversarial table so a divergence fails CI
 * instead of drifting silently.
 *
 * Replaced (this change) a `URL_SCHEME_DENYLIST` (`startsWith` on a lowercased, `.trim`ed string)
 * that failed open: the WHATWG `URL` parser strips TAB/LF/CR from ANYWHERE in the input and folds a
 * leading backslash to `/` for `http(s)`, so `"java\tscript:alert"`, `" javascript:alert"`,
 * `"file:// etc/passwd"`, `"blob:…"`, `"about:blank"`, `"//evil.example"` (protocol-relative), and
 * `"/\evil.example"` all resolved to a dangerous or off-origin target while never matching any
 * `startsWith` prefix in the old list. An allowlist closes the whole bypass class at once (case,
 * embedded control characters, and scheme are all irrelevant to an allowlist the same way) rather
 * than needing a new prefix bolted on per newly-discovered shape.
 *
 * `validateTarget`'s caller REJECTS on a `false` result (`MenuValidationError`, surfaced as HTTP 400)
 * rather than silently coercing the way `safeHref`'s render-time callers degrade to `"#"` — a
 * write-time author-facing path should say so, not quietly rewrite the input. Verified against the
 * workspace's stored menu data (`content.db`, `content.seed.db`) before this change: every existing
 * `url`-kind href already starts with `#` or `/`, so this tightening rejects nothing that exists
 * today — it governs `createMenu` too, so it also reaches the Jini MCP agent-tool path, not just
 * hrefs written through the host's admin editor.
 *
 * @param rawHref - The href to check, already confirmed non-empty by `validateTarget`. Any string is
 * otherwise a valid input — this function performs no other precondition checks.
 * @returns `true` when `rawHref` passes the allowlist, `false` otherwise.
 * @complexity O — a handful of string checks plus one `URL` construction on the `/…` branch.
 */ 
export function isAllowedHref({ rawHref }: { rawHref: string }, _optional: Record<string, never> = {}): boolean {
  const href = rawHref.trim();
  if (href.startsWith("#")) return true;
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return true;
  if (href.startsWith("/")) {
    try {
      return new URL(href, SAFE_HREF_RESOLUTION_BASE).origin === SAFE_HREF_RESOLUTION_ORIGIN;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Human-readable description of {@link isAllowedHref}'s accepted shapes — the single source of truth
 * for both `validateTarget`'s rejection message below and `agent-tools.ts`'s published JSON Schema
 * `href` description, so an author-facing 400 and an LLM-facing tool description can never drift out
 * of sync with each other the way three independent copies of the URL-checking LOGIC itself did
 * before this change.
 */ 
export const ALLOWED_HREF_SHAPES_DESCRIPTION =
  "an in-page anchor ('#...'), a same-origin relative path ('/...'), an 'http://' or 'https://' URL, or a 'mailto:' address";

