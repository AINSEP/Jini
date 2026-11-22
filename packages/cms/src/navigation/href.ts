/**
 * @file The single href standard for author-authored links: `isAllowedHref` decides, `toAllowedHref`
 * coerces, `ALLOWED_HREF_SHAPES_DESCRIPTION` describes. A host (public renderer, static export,
 * menu widgets) imports these from `@jini-ai/cms/navigation` rather than keeping its own copy.
 * Lives beside `menu-service.ts` (its first consumer) in its own file so the menu service stays under
 * its size ceiling.
 */

/**
 * Fixed placeholder origins {@link isAllowedHref} resolves a claimed same-origin-relative href
 * against, to compare the RESOLVED origin rather than the raw string shape. They mirrored the host's
 * public renderer's identically-named constant byte-for-byte while the host kept its own copy — see
 * the host's own header (now retired with that copy) for why a fixed placeholder origin is sufficient
 * (only the relationship between the resolved URL's origin and this one is ever inspected, never the
 * placeholder value itself).
 *
 * Two of them, because one is not enough: a protocol-relative href aimed at a single placeholder's own
 * host (`//safehref.invalid/x`) resolves to that placeholder's origin and would pass as "same origin"
 * although it is off-origin. An href is same-origin only when it resolves to the base's origin under
 * BOTH bases; a protocol-relative href carries its own host, which cannot equal both bases' hosts, so it
 * is refused whatever the host or port spelling. Reserved `.invalid` hosts; no request is ever made.
 * `https:` bases because a `/…` href cannot change the scheme, so the scheme is irrelevant to the
 * comparison.
 */
const SAFE_HREF_RESOLUTION_BASES: readonly string[] = ["https://safehref.invalid/", "https://safehref-other.invalid/"];

/** What a coercing caller renders for an href the allowlist refuses: an inert in-page anchor. */
const REFUSED_HREF = "#";

/** True when `href` resolves to each base's own origin; an href the URL parser rejects is not same-origin. */
function resolvesToBaseOrigin({ href }: { href: string }): boolean {
  try {
    return SAFE_HREF_RESOLUTION_BASES.every((base) => new URL(href, base).origin === new URL(base).origin);
  } catch {
    return false;
  }
}

/**
 * The CANONICAL href allowlist for an author-authored link — same accepted shapes (`#…`, same-origin
 * `/…`, `http(s)://`, `mailto:`) as the host's render-time `safeHref` in `render.ts` and its
 * `features/theme/static-render.ts` duplicate had. **This is the single source of truth** exported
 * from this package's public surface (`navigation/index.ts` -> `@jini-ai/cms/navigation`) so the
 * dependency runs the direction that is actually legal — the host already depends on `@jini-ai/cms`, not
 * the reverse — rather than each consumer hand-copying the predicate.
 *
 * The two host-side copies (`render.ts:252`, `features/theme/static-render.ts:210`, both a coercing
 * `value => passes ? value : "#"` wrapper around the identical predicate below) have **been
 * retired onto this** (2026-11-17), through {@link toAllowedHref} — that edit was intentionally out of
 * the earlier change's scope (a `check:boundaries` no-deep-import concern was NOT what blocked it:
 * `render.ts` already imported `@jini-ai/cms/core`, and `features/theme` already imported
 * `@jini-ai/cms/core` too, so both call sites may legally import `@jini-ai/cms/navigation` directly —
 * verified by grep, not assumed). Until that follow-up landed, the host's menu href allowlist sync check
 * behaviorally gated the three copies against the same adversarial table so a divergence failed CI
 * instead of drifting silently; it now gates this function itself and fails if a host copy comes back.
 *
 * Replaced a `URL_SCHEME_DENYLIST` (`startsWith` on a lowercased, `.trim`ed string)
 * that failed open: the WHATWG `URL` parser strips TAB/LF/CR from ANYWHERE in the input and folds a
 * leading backslash to `/` for `http(s)`, so `"java\tscript:alert"`, `" javascript:alert"`,
 * `"file:// etc/passwd"`, `"blob:…"`, `"about:blank"`, `"//evil.example"` (protocol-relative), and
 * `"/\evil.example"` all resolved to a dangerous or off-origin target while never matching any
 * `startsWith` prefix in the old list. An allowlist closes the whole bypass class at once (case,
 * embedded control characters, and scheme are all irrelevant to an allowlist the same way) rather
 * than needing a new prefix bolted on per newly-discovered shape.
 *
 * A `#…` target needs no further check: the WHATWG URL parser always resolves a fragment-only reference
 * against the CURRENT page's own origin, no matter what precedes or follows the `#`.
 *
 * The `/…` branch is NOT a plain prefix check. A value can start with a single leading `/` and still
 * resolve OFF origin once a browser parses it: `"//evil.example"` (protocol-relative — resolved against
 * the page's own scheme, landing on an attacker host), `"/\evil.example"` (a browser folds a backslash to
 * a forward slash for `http(s)`), and a TAB/LF/CR planted between the leading `/` and the rest (the parser
 * strips those three from ANYWHERE in the input, not just the ends `.trim()` covers, so `"/\t/evil.example"`
 * reconstitutes `"//evil.example"`). Resolving against fixed placeholder origins and comparing origins
 * closes all of them at once, and stays correct for whatever equivalent shape is found next.
 *
 * A protocol-relative href (`//host/x`, `/\host/x`, with or without a port) is never allowed, whatever
 * the host — including a placeholder host of {@link SAFE_HREF_RESOLUTION_BASES}.
 *
 * `validateTarget`'s caller REJECTS on a `false` result (`MenuValidationError`, surfaced as HTTP 400)
 * rather than silently coercing the way {@link toAllowedHref}'s render-time callers degrade to `"#"` — a
 * write-time author-facing path should say so, not quietly rewrite the input. Verified against the
 * workspace's stored menu data (`content.db`, `content.seed.db`) before the allowlist replaced the
 * denylist: every existing `url`-kind href already starts with `#` or `/`, so that tightening rejects
 * nothing that exists today — it governs `createMenu` too, so it also reaches the Jini MCP agent-tool
 * path, not just hrefs written through the host's admin editor.
 *
 * @param rawHref - The href to check. Untrusted: a non-string (raw widget-prop JSON can carry
 * `undefined`, `null`, a number or an object) is refused with `false`, never thrown on.
 * @returns `true` when `rawHref` passes the allowlist, `false` otherwise.
 * @complexity O — a handful of string checks plus two `URL` constructions on the `/…` branch.
 */
export function isAllowedHref({ rawHref }: { rawHref: unknown }, _optional: Record<string, never> = {}): boolean {
  if (typeof rawHref !== "string") return false;
  const href = rawHref.trim();
  if (href.startsWith("#")) return true;
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return true;
  return href.startsWith("/") && resolvesToBaseOrigin({ href });
}

/**
 * Coerces an untrusted href to one safe to render: the trimmed href when {@link isAllowedHref} allows
 * it, otherwise `"#"`. Every render-time caller needs exactly this, so it lives next to the predicate
 * instead of being rewritten (and drifting) per caller.
 *
 * @param rawHref - The href to coerce; any value, since callers hand raw JSON.
 * @returns The trimmed `rawHref` when allowed, `"#"` for a refused or non-string input.
 */
export function toAllowedHref({ rawHref }: { rawHref: unknown }, _optional: Record<string, never> = {}): string {
  if (typeof rawHref !== "string" || !isAllowedHref({ rawHref })) return REFUSED_HREF;
  return rawHref.trim();
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
