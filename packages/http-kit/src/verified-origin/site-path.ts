/**
 * @file Shared site-path checks: decoded, dot-resolved segments and origin tracking.
 *
 * Why the rule is not `path.startsWith("/admin")`:
 * - `/administer-survey` is ordinary site content and must keep working, so the comparison is per
 *   SEGMENT, not per prefix.
 * - `/%61dmin` is compared AFTER one percent-decode, not on the raw bytes. Express (which routes on
 *   the raw path) and browsers (which do not decode `%61` in a path) do NOT treat it as `/admin`; a
 *   proxy or server that decodes before routing does. Refusing it is deliberate over-refusal — the
 *   safe direction for a rule whose job is to keep public redirects and fetches off the admin
 *   surface.
 * - `/ADMIN` reaches the same Express mount (Express matches paths case-insensitively by default),
 *   so the comparison is case-folded.
 * - `/blog/../admin` is `/admin` by the time a browser issues the request, so dot segments are
 *   resolved first.
 *
 */

/** {@link checkSitePathname}'s verdict. Every arm is a refusal except `ok`. */
export type SitePathCheck =
  | { kind: "ok" }
  /** `decodeURIComponent` threw — a stray or truncated `%` sequence. */
  | { kind: "malformed-encoding" }
  /** Decodes to a backslash (a `/` to URL parsers) or a C0/C1 control character (CR/LF splitting). */
  | { kind: "disallowed-character" }
  | { kind: "reserved"; surface: string };

/** {@link checkSiteRelativeTarget}'s verdict — {@link SitePathCheck} plus the two structural arms
 *  that only apply when the input is still a raw, unparsed reference. */
export type SiteRelativeTargetCheck =
  | SitePathCheck
  /** `new URL()` could not parse it at all. */
  | { kind: "unparseable" }
  /** Parses, but resolves to a DIFFERENT host — e.g. `/\evil.example`, which starts with a single
   *  slash yet is `//evil.example` to a URL parser, so a `startsWith("//")` test never sees it. */
  | { kind: "off-origin" };

/**
 * Two hosts this deployment can never actually reach, used only so `new URL()` has a base to
 * resolve a site-relative reference against. `.invalid` is reserved by RFC 2606 precisely for this.
 *
 * There are TWO because one base is NAMEABLE (t85 independent review, 2026-09-16). With a single
 * base, `//reserved-path-probe.invalid/x` resolves to that very origin, so "did the origin survive"
 * answered yes for a reference that leaves the site — reachable as `/store/buy`'s `returnTo`, which
 * sent `Location: //reserved-path-probe.invalid/x`. Requiring the resolved origin to TRACK whichever
 * base it was given leaves no origin an input can name, which is a structural answer rather than a
 * denylist of the sentinel's spellings (the same reasoning as the probe itself — see
 * {@link checkSiteRelativeTarget}). Both are bare origins, so a reference resolves to the same
 * pathname against either.
 */
const PROBE_ORIGIN = "http://reserved-path-probe.invalid";
const SECOND_PROBE_ORIGIN = "http://reserved-path-probe-2.invalid";

/**
 * Whether `value` contains a C0 or C1 control character.
 *
 * CR/LF in a request target is HTTP request splitting and in a `Location` header is response
 * splitting; NUL and friends are path-truncation tricks.
 *
 * @param required.value - Any string, already decoded or not.
 * @returns `true` if any code unit is in `U+0000`–`U+001F` or `U+007F`–`U+009F`.
 * @complexity O(n) in the string length.
 * @example hasControlCharacter({ value: "/ok" }, {}); // => false
 */
export function hasControlCharacter(
  { value }: { value: string },
  _optional: Record<string, never> = {},
): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Resolve `.` and `..` segments, RFC 3986 §5.2.4 style, on an already-decoded path.
 *
 * Done by hand rather than with a second `new URL()` pass because a decoded path can contain a
 * literal `?` or `#` (from `%3F`/`%23`), and the URL parser would treat those as a query/fragment
 * delimiter and TRUNCATE the path — turning `/x#/../admin` into `/x` and losing the very segment
 * this check exists to find. A browser does no such thing: it never decodes `%23` before splitting
 * the path, so the truncation would be a false negative, not a match for real behavior.
 *
 * Empty segments are dropped, so `//admin` collapses to `/admin`. That is deliberately stricter
 * than a URL parser (which preserves `//`); over-matching here only ever refuses more.
 *
 * @param path - A decoded path, expected to start with `/`.
 * @returns The path with dot segments removed, always starting with `/`.
 * @complexity O(n) in the path length.
 * @example resolveDotSegments("/blog/../admin"); // => "/admin"
 */
function resolveDotSegments(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return `/${out.join("/")}`;
}

/**
 * The actual per-segment rule, on a pathname string that is guaranteed to have come from a real
 * `URL` (see {@link checkSitePathname}, this function's only caller). Kept private: a bare
 * string carries no proof it was ever parsed — the query/fragment stripping, dot-segment removal
 * relative to a real origin, etc. are exactly what `new URL()` already did before that caller
 * reaches this. Do not export this directly.
 *
 * Order is load-bearing: decode ONCE, then resolve dot segments, then compare the first segment
 * case-folded. Decoding first is what catches `/%61dmin` (over-refusal for Express and browsers, a
 * real match for a decoding proxy — see the module doc); resolving dot segments after the decode is
 * what catches `/blog/%2e%2e/admin`. Exactly one decode pass models one decoding intermediary:
 * `/%2561dmin` would need two, so it stays allowed.
 *
 * @param pathname - An already-parsed `URL`'s `.pathname` (no query, no fragment).
 * @returns `{ kind: "ok" }` when it is ordinary site content; otherwise the arm naming the refusal.
 * @complexity O(n) in the pathname length.
 */
function checkDecodedSitePathname(pathname: string, reservedSegments: ReadonlySet<string>): SitePathCheck {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { kind: "malformed-encoding" };
  }
  if (decoded.includes("\\") || hasControlCharacter({ value: decoded }, {})) return { kind: "disallowed-character" };

  const first = (resolveDotSegments(decoded).split("/")[1] ?? "").toLowerCase();
  if (reservedSegments.has(first)) return { kind: "reserved", surface: first };
  return { kind: "ok" };
}

/**
 * Classify an already-parsed URL's pathname against the admin application's URL space.
 *
 * Takes the {@link URL} itself, not a bare pathname string, so this cannot be handed a raw,
 * unparsed reference by accident: a string has no way to prove it went through `new URL()` first,
 * and this rule's whole design (see the module doc) depends on comparing the DECODED, dot-resolved
 * form a URL parser would actually produce. A caller that only has a raw string — a stored redirect
 * target, anything from user input — must go through {@link checkSiteRelativeTarget} instead, which
 * parses it (and rejects what doesn't parse) before this check ever runs.
 *
 * PRECONDITION: the caller has already established that `url` is on the site's own origin. This
 * function reads only `pathname`, so `new URL("//admin", base)` (host `admin`, pathname `/`)
 * returns `ok`. It deliberately does not compare origins itself: `platform/routing` cannot use
 * `features/origin`'s normalizer, and a string `URL.origin` comparison is wrong for redirect
 * candidates (`https://site./admin`). Callers: `checkSiteRelativeTarget` (probe-origin check),
 * `site-inspection`'s `resolveWithinOrigin`, and `features/redirects/reserved-destination.ts` (the
 * origin oracle's `isSameOrigin`).
 *
 * @param required.url - An already-parsed `URL`; only `url.pathname` is read.
 * @param required.reservedSegments - First segments reserved by the host, stored case-folded.
 * @returns `{ kind: "ok" }` when it is ordinary site content; otherwise the arm naming the refusal.
 * @complexity O(n) in the pathname length.
 * @example checkSitePathname({ url: new URL("/administer-survey", "http://x.invalid"), reservedSegments: new Set(["admin", "api"]) }, {}); // => { kind: "ok" }
 * @example checkSitePathname({ url: new URL("/%61dmin/settings", "http://x.invalid"), reservedSegments: new Set(["admin", "api"]) }, {}); // => { kind: "reserved", surface: "admin" }
 */
export function checkSitePathname(
  { url, reservedSegments }: { url: URL; reservedSegments: ReadonlySet<string> },
  _optional: Record<string, never> = {},
): SitePathCheck {
  return checkDecodedSitePathname(url.pathname, reservedSegments);
}

/**
 * Classify a raw, site-relative reference (a stored redirect target, a caller-supplied path)
 * against the admin application's URL space, including the structural check that it is site-
 * relative at all.
 *
 * The structural pass runs FIRST and matters on its own: `/\evil.example` begins with exactly one
 * slash, so a `startsWith("//")` or scheme test calls it site-relative, while `new URL()` — and
 * every browser following a `Location` — reads the backslash as a separator and lands on
 * `evil.example`. Resolving against a probe origin and asserting the origin TRACKED that base is a
 * structural answer to that instead of a pattern someone has to keep correct — done against two
 * different bases so the probe origin itself is not a nameable way to pass (see
 * {@link PROBE_ORIGIN}).
 *
 * @param required.raw - The untrusted reference, expected to be site-relative.
 * @param required.reservedSegments - First segments reserved by the host, stored case-folded.
 * @returns `{ kind: "ok" }` when it stays on this site and names ordinary content; otherwise the
 * arm naming the refusal.
 * @complexity O(n) in the reference length.
 * @example checkSiteRelativeTarget({ raw: "/new", reservedSegments: new Set(["admin", "api"]) }, {}); // => { kind: "ok" }
 * @example checkSiteRelativeTarget({ raw: "/\\evil.example", reservedSegments: new Set(["admin", "api"]) }, {}); // => { kind: "off-origin" }
 */
export function checkSiteRelativeTarget(
  { raw, reservedSegments }: { raw: string; reservedSegments: ReadonlySet<string> },
  _optional: Record<string, never> = {},
): SiteRelativeTargetCheck {
  if (hasControlCharacter({ value: raw }, {})) return { kind: "disallowed-character" };
  let parsed: URL;
  let reparsed: URL;
  try {
    parsed = new URL(raw, PROBE_ORIGIN);
    reparsed = new URL(raw, SECOND_PROBE_ORIGIN);
  } catch {
    return { kind: "unparseable" };
  }
  if (parsed.origin !== PROBE_ORIGIN || reparsed.origin !== SECOND_PROBE_ORIGIN) return { kind: "off-origin" };
  return checkSitePathname({ url: parsed, reservedSegments }, {});
}
