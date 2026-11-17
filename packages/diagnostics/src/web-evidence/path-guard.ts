import { hasControlCharacter } from "@jini-ai/core/contracts/server/verified-origin";

/**
 * @file The path guard for tools that fetch a route of the host's OWN site: a caller-supplied
 * path is validated allowlist-style, then resolved against an origin the host minted, so no input
 * can steer the request to another host. The host's own pathname policy (which surfaces are
 * reserved) is injected as `checkPathname`; nothing here names a surface.
 *
 * Not the same as `resolveSameOriginUrl` in `same-origin.ts`, which only joins a normalized path
 * onto a verified base for the headless-browser collector. This one is the stricter, error-class
 * raising check for a request the host sends itself.
 */

/** Longest path string accepted before validation even begins. */
export const MAX_PATH_LENGTH = 2_048;

/**
 * Raised when `path` is not a fetchable same-origin path. Its own class so a tool layer can
 * publish the input schema back with it: every rejection here is one a DIFFERENT `path` would fix.
 */
export class SameOriginPathError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "SameOriginPathError";
  }
}

/**
 * Refuses any `..` segment in a raw path, before and after ONE percent-decode.
 *
 * Runs on the RAW string rather than a parsed `URL.pathname` because `new URL()` resolves `..`
 * away silently — see the call site's own comment. One decode pass is the right depth: a
 * double-encoded `%252e%252e` decodes to the literal text `%2e%2e`, which a static-file handler
 * treats as a filename, not as traversal.
 *
 * @param required.pathOnly - The raw path with any query string already removed.
 * @param required.raw - The caller's original string, for the error message.
 * @throws {SameOriginPathError} On a raw or singly-encoded `..` segment, or on a malformed
 * percent-encoding (which cannot be decoded and therefore cannot be cleared).
 * @complexity O(L) in the path length.
 * @example assertNoTraversalSegment({ pathOnly: "/a/%2e%2e/b", raw: "/a/%2e%2e/b" }); // throws
 */
export function assertNoTraversalSegment({ pathOnly, raw }: { pathOnly: string; raw: string }, _optional = {}): void {
  for (const segment of pathOnly.split("/")) {
    if (segment === "..") {
      throw new SameOriginPathError({ message: `path must not contain a '..' segment (encoded or not): '${raw}'.` });
    }
    if (!segment.includes("%")) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new SameOriginPathError({ message: `path contains a malformed percent-encoding: '${raw}'.` });
    }
    if (decoded === "..") {
      throw new SameOriginPathError({ message: `path must not contain a '..' segment (encoded or not): '${raw}'.` });
    }
  }
}

/**
 * The syntactic rejections that operate on the raw caller value, before any URL parsing happens.
 * Split out of {@link resolveSameOriginPath} purely to keep that function's own complexity below
 * the repo's gate — the checks, their order, and every message are unchanged.
 *
 * @throws {SameOriginPathError} On the first rule `raw` fails.
 * @returns `raw`, narrowed to `string`, once every rule has passed.
 */
export function assertRawPathShape({ raw }: { raw: unknown }, _optional = {}): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new SameOriginPathError({ message: "path must be a non-empty string, e.g. '/' or '/blog/hello'." });
  }
  if (raw.length > MAX_PATH_LENGTH) {
    throw new SameOriginPathError({ message: `path must be at most ${MAX_PATH_LENGTH} characters, got ${raw.length}.` });
  }
  if (!raw.startsWith("/")) {
    throw new SameOriginPathError({ message: `path must start with '/' — this tool fetches a route on THIS site and never accepts a full URL or a remote host. Got '${raw}'.` });
  }
  if (raw.startsWith("//")) {
    throw new SameOriginPathError({ message: "path must not start with '//' — a protocol-relative path resolves to a different host, which this tool never fetches." });
  }
  if (raw.includes("\\")) {
    throw new SameOriginPathError({ message: "path must not contain a backslash — URL parsers treat '\\' as '/'." });
  }
  if (hasControlCharacter({ value: raw })) {
    throw new SameOriginPathError({ message: "path must not contain control characters (including CR/LF)." });
  }
  // BEFORE `new URL()`, because the URL parser RESOLVES `..` away rather than reporting it:
  // `new URL("/a/../../etc/passwd", base).pathname` is already `/etc/passwd`, so a check on the
  // parsed pathname sees nothing to reject. Silent normalization is exactly the "rewrite rather
  // than refuse" behavior this validator must not have — a caller that wrote `..` gets told so.
  const queryStart = raw.indexOf("?");
  assertNoTraversalSegment({ pathOnly: queryStart === -1 ? raw : raw.slice(0, queryStart), raw });
  return raw;
}

/**
 * Parses `raw` against `base` and asserts the result stayed on `base`'s origin. Split out of
 * {@link resolveSameOriginPath} purely to keep that function's own complexity below the repo's
 * gate — the structural same-origin assertion itself is unchanged.
 *
 * @throws {SameOriginPathError} If `raw` does not parse, or parses off-origin.
 */
export function resolveWithinOrigin({ raw, base }: { raw: string; base: string }, _optional = {}): URL {
  const baseUrl = new URL(base);
  let resolved: URL;
  try {
    resolved = new URL(raw, baseUrl);
  } catch {
    throw new SameOriginPathError({ message: `path is not a valid URL path: '${raw}'.` });
  }
  if (resolved.origin !== baseUrl.origin) {
    throw new SameOriginPathError({ message: `path resolved off-origin (to '${resolved.origin}') — this tool only fetches routes on this site.` });
  }
  return resolved;
}

/**
 * What the host's pathname policy says about a resolved pathname. `refused` carries the host's own
 * complete refusal sentence (for example a reserved surface), so this module never names a surface.
 */
export type PathnameVerdict =
  | { kind: "ok" }
  | { kind: "malformed-encoding" }
  | { kind: "disallowed-character" }
  | { kind: "refused"; reason: string };

/**
 * Why a resolved pathname was refused, phrased for this module's caller.
 *
 * Split out of {@link assertNoDisallowedDecodedForm} so the wording lives next to the verdict
 * union it exhausts: with an explicit `string | null` return type and no `default` arm, a future
 * case added to `PathnameVerdict` is a compile error here rather than a silent fall-through to
 * "allowed".
 *
 * The reserved-surface rule itself is deliberately NOT restated here: the host owns it, and a
 * second copy of a denylist is how one of them ends up a decode or a case-fold behind the other.
 *
 * @param required.check - The verdict from the host's pathname policy.
 * @param required.raw - The original caller-supplied path, for the error message only.
 * @returns The refusal message, or `null` when the path is allowed.
 * @complexity O(1).
 */
function disallowedFormReason({ check, raw }: { check: PathnameVerdict; raw: string }, _optional = {}): string | null {
  switch (check.kind) {
    case "ok":
      return null;
    case "malformed-encoding":
      return `path contains a malformed percent-encoding: '${raw}'.`;
    case "disallowed-character":
      return "path decodes to a backslash or control character, which is refused.";
    case "refused":
      return check.reason;
    default: {
      const unhandled: never = check;
      throw new TypeError(`Unknown site path verdict: ${String(unhandled)}`);
    }
  }
}

/**
 * Applies the host's pathname policy to the resolved pathname and maps its verdict onto this
 * module's own error type. Split out purely to keep {@link resolveSameOriginPath} below the repo's
 * complexity gate.
 *
 * @throws {SameOriginPathError} On a malformed encoding, a decoded backslash/control character,
 * or a pathname the host policy refuses.
 */
function assertNoDisallowedDecodedForm(
  { resolved, raw, checkPathname }: { resolved: URL; raw: string; checkPathname: (required: { url: URL }) => PathnameVerdict },
  _optional = {},
): void {
  const reason = disallowedFormReason({ check: checkPathname({ url: resolved }), raw });
  if (reason !== null) throw new SameOriginPathError({ message: reason });
}

/**
 * Validates and canonicalizes a caller-supplied site path against the loopback origin this module
 * minted, following canonicalize-then-validate order.
 *
 * Each rule closes a specific hole rather than being defensive in general:
 * - **must be a non-empty string within {@link MAX_PATH_LENGTH}** — bounds the work every later
 *   check does.
 * - **must start with `/`** — rejects an absolute URL (`http://evil.example/x`) and a bare relative
 *   path, both of which would resolve somewhere other than this site's root.
 * - **must not start with `//`** — a protocol-relative URL resolves to a DIFFERENT HOST while still
 *   starting with a slash. This is the single most commonly missed same-origin bypass.
 * - **no backslash anywhere** — `\` is treated as `/` by URL parsers and browsers, so `/\evil.com`
 *   is a protocol-relative URL wearing a disguise.
 * - **no C0/C1 control characters** — CR/LF in a request target is HTTP request splitting; NUL and
 *   friends are path-truncation tricks.
 * - **`new URL(raw, base)` must keep `base`'s origin** — the structural assertion. Everything above
 *   is belt; this is braces, and it compares against the origin this process minted rather than
 *   against a pattern someone has to keep correct.
 * - **no `..` segment after ONE percent-decode** — blocks `%2e%2e` and its double-encoded variants
 *   from reaching a static-file handler. `..` cannot escape the origin, but it can escape a
 *   directory, and a single decode pass is enough because the check runs on the decoded form and
 *   rejects a remaining `%` sequence that decodes to a traversal.
 * - **the host's pathname policy** (`checkPathname`) — the resolved pathname is handed to the policy the
 *   caller injects. This module does not know which surfaces a host reserves; see
 *   `site-path-policy.ts` for this site's rule and why it exists.
 *
 * @param raw - The caller's path, untrusted.
 * @param base - The loopback origin this call minted, e.g. `http://127.0.0.1:53142`.
 * @param checkPathname - The host's pathname policy, run on the resolved URL.
 * @returns The canonical `pathname + search` to request, re-encoded by the URL parser.
 * @throws {SameOriginPathError} With a message naming the specific rule that rejected it, so the
 * model can fix the input in one turn instead of guessing.
 * @complexity O(L) in the path length, bounded by {@link MAX_PATH_LENGTH}.
 * @example resolveSameOriginPath({ raw: "/blog/hello", base: "http://127.0.0.1:53142", checkPathname: () => ({ kind: "ok" }) }); // => "/blog/hello"
 */
export function resolveSameOriginPath(
  { raw, base, checkPathname }: { raw: unknown; base: string; checkPathname: (required: { url: URL }) => PathnameVerdict },
  _optional = {},
): string {
  const path = assertRawPathShape({ raw });
  const resolved = resolveWithinOrigin({ raw: path, base });
  assertNoDisallowedDecodedForm({ resolved, raw: path, checkPathname });
  return `${resolved.pathname}${resolved.search}`;
}
