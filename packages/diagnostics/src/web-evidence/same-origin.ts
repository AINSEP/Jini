/**
 * @file The same-origin boundary for `site_collect_page_evidence` — the one place that decides
 * which URL a headless browser is allowed to open on this workspace's behalf.
 *
 * ---------------------------------------------------------------------------
 * Unrepresentability first, validation second
 * ---------------------------------------------------------------------------
 * The tool's input accepts **site-relative paths**, never URLs. That is deliberate and it is the
 * primary guarantee: a caller (including a model that has been talked into fetching
 * `http://169.254.169.254/latest/meta-data/`) has no input field in which an absolute URL, a host,
 * or a scheme can be expressed at all. {@link normalizeSitePath} then refuses every syntactic form
 * that could smuggle an authority through a field that is supposed to hold a path —
 * `//evil.example`, `https://evil.example`, `\\evil.example`, and anything carrying a raw control
 * character or a `..` segment.
 *
 * The origin the path is joined to comes from `OriginRegistryPort.canonicalOrigin` ( F2),
 * which is the workspace's own verified origin and is never derived from a request `Host` header
 * or from tool input. So "same-origin" here is not a comparison the caller can influence: the
 * origin is fixed by the workspace, and only the path varies.
 *
 * {@link isSameOriginUrl} is the SECOND layer, for the one thing the first cannot cover: a page
 * that responds with a redirect to somewhere else. The browser follows redirects, so the URL that
 * actually got loaded has to be re-checked after the fact against the same canonical origin, and a
 * page that left the origin is recorded as evidence and dropped rather than inspected.
 *
 * Architectural role:
 * Pure string/URL logic. No I/O, no browser, no repo — `collect-page-evidence.ts` composes this
 * with the real origin lookup and the real browser port.
 * See docs/decisions/DR-001-trusted-evidence-addresses.md.
 */
/** Caller-owned origin verification data; no origin is derived from request input. */
export interface VerifiedOrigin {
 readonly scheme: "http" | "https"; readonly host: string; readonly port?: number;
 readonly basePath?: string; readonly verifiedAt: string; readonly source: string;
}
export interface VerifiedOriginPort {
 canonicalOrigin(required: { workspaceId: string }): Promise<VerifiedOrigin>;
}

/** Longest site-relative path this tool will accept. Well past any real page URL; exists so a
 *  pathological input cannot be handed to a browser at all. */
const MAX_PATH_LENGTH = 2048;

/** Raw C0 controls, DEL, and whitespace — the characters that let a crafted string mean one thing
 *  to a validator and another to a URL parser. Mirrors `origin/origin.ts`'s
 *  `normalizeOriginCandidate`, which rejects the same class for the same reason. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the entire purpose — a raw CR/LF/NUL in a path is exactly the smuggling vector this refuses.
const FORBIDDEN_CHARACTERS = /[\u0000-\u0020\u007f]/;

export type SitePathRejectionReason =
  | "empty"
  | "too-long"
  | "absolute-url"
  | "protocol-relative"
  | "backslash"
  | "not-absolute-path"
  | "forbidden-character"
  | "traversal";

export type NormalizeSitePathResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: SitePathRejectionReason; readonly message: string };

/**
 * The syntactic rejections that only need the trimmed raw string — every one of these fires before
 * a fragment is ever stripped or a leading slash ever added. Split out of {@link normalizeSitePath}
 * purely to keep that function's own complexity below the repo's gate; the checks, their order, and
 * every message are unchanged.
 *
 * @returns The rejection, or `null` if `trimmed` passes every syntactic check.
 * @complexity O(n) in the path's own length.
 */
function rejectionForRawPath(trimmed: string): NormalizeSitePathResult | null {
  if (trimmed.length === 0) return reject("empty", "path is empty");
  if (trimmed.length > MAX_PATH_LENGTH) {
    return reject("too-long", `path is ${trimmed.length} characters, over the ${MAX_PATH_LENGTH}-character cap`);
  }
  if (FORBIDDEN_CHARACTERS.test(trimmed)) {
    return reject("forbidden-character", "path contains a control character or embedded whitespace");
  }
  // `\` is a path separator to some URL parsers and a literal to others; a value containing one is
  // never a path this tool should try to interpret. Checked BEFORE the scheme test so `\\host` is
  // reported as what it is rather than as a generic "not a path".
  if (trimmed.includes("\\")) {
    return reject("backslash", "path contains a backslash, which some URL parsers treat as an authority separator");
  }
  if (trimmed.startsWith("//")) {
    return reject("protocol-relative", "path is protocol-relative ('//host/…'), which names a different origin");
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return reject("absolute-url", "path is an absolute URL; this tool accepts site-relative paths only and never fetches another origin");
  }
  return null;
}

/**
 * Normalizes one caller-supplied site-relative path, or explains why it is not one.
 *
 * Accepts a leading-slash path with an optional query string (`/pricing`, `/blog/post?draft=1`).
 * A missing leading slash is added rather than rejected — `pricing` is an unambiguous typo for
 * `/pricing`, and there is no authority it could be confused with once every other form below is
 * already refused.
 *
 * A fragment is stripped: it never reaches the server, so it cannot change what is observed, and
 * keeping it would make two citations of the same evidence look like different pages.
 *
 * @throws Nothing — every rejection is returned, matching this codebase's convention for expected
 * validation outcomes (`agent-plugins/manifest.ts`, `plugin-runtime/discovery.ts`).
 * @complexity O(n) in the path's own length.
 */
export function normalizeSitePath({ raw }: { raw: string }): NormalizeSitePathResult {
  const trimmed = raw.trim();

  const syntaxRejection = rejectionForRawPath(trimmed);
  if (syntaxRejection) return syntaxRejection;

  const withoutFragment = trimmed.split("#", 1)[0] as string;
  // Always non-empty and always leading-slash by construction (either `withoutFragment` already
  // started with "/", or one was just prepended) — `rejectionForRawPath` has already refused the
  // only two raw forms that could make this empty (the empty string and a `//`-prefixed one).
  const absolute = withoutFragment.startsWith("/") ? withoutFragment : `/${withoutFragment}`;

  // Refused rather than resolved. Resolving would be safe (the join below is `new URL`-based and
  // cannot escape the origin), but a `..` in a caller-supplied path means the caller believes it is
  // somewhere it is not, and silently rewriting it would produce evidence cited against a path
  // nobody asked for.
  if (absolute.split("/").includes("..")) {
    return reject("traversal", "path contains a '..' segment; give the resolved path instead");
  }

  return { ok: true, path: absolute };
}

function reject(reason: SitePathRejectionReason, message: string): NormalizeSitePathResult {
  return { ok: false, reason, message };
}

/**
 * Renders a `VerifiedOrigin` as a base URL string (`https://example.com`, `http://localhost:3000`).
 *
 * Duplicated locally rather than imported: `newsletter/unsubscribe.ts`, `newsletter/confirmation.ts`,
 * `redirects/phase-handler.ts` and `members/write-service.ts` each already keep their own private
 * copy of this three-line join, and `origin/` deliberately exports no shared formatter. Adding a
 * fifth private copy is the existing convention; promoting one into `origin/` is a cross-cutting
 * change that belongs to that module's owner, not to this feature.
 *
 * @complexity O(1).
 */
export function verifiedOriginToBaseUrl({ origin }: { origin: VerifiedOrigin }): string {
  const authority = origin.port === undefined ? origin.host : `${origin.host}:${origin.port}`;
  return `${origin.scheme}://${authority}${origin.basePath ?? ""}`;
}

/**
 * Joins a normalized site path onto a workspace's verified origin, preserving the origin's own
 * base path.
 *
 * **Not `new URL(path, baseUrl)`** — that was the first implementation and it was wrong, caught by
 * this module's own test rather than by review: a leading-slash path is ROOT-relative, so
 * `new URL("/pricing", "https://example.test/site/")` resolves to `https://example.test/pricing`
 * and silently discards the `/site` base path a `VerifiedOrigin` may carry. Not a security hole
 * (the result is still same-origin) but a correctness one: every citation would then name a page
 * the operator does not have.
 *
 * So the base path is prepended explicitly, and the result is resolved against `base.origin` — a
 * bare origin with no path of its own, which is what makes the "cannot escape" property hold no
 * matter what `path` contains. Leading slashes on `path` are collapsed to exactly one before the
 * join specifically so a `//host` value (which {@link normalizeSitePath} already refuses, but which
 * a future caller could reach this function with directly) degrades to the harmless `/host` rather
 * than being read as an authority.
 *
 * @throws {TypeError} If `baseUrl` is not a parseable URL. Unreachable for a `VerifiedOrigin`
 * rendered by {@link verifiedOriginToBaseUrl}; not caught here so a malformed registry row fails
 * loudly at the composition root rather than being reported as a per-page evidence gap.
 * @complexity O(n) in the joined URL's length.
 */
export function resolveSameOriginUrl({ baseUrl, path }: { baseUrl: string; path: string }): string {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const rootRelative = `/${path.replace(/^\/+/, "")}`;
  return new URL(`${basePath}${rootRelative}`, base.origin).toString();
}

/**
 * Whether `candidateUrl` is on the same origin as `baseUrl` — scheme, host, and effective port all
 * equal. The post-navigation check: a page is allowed to redirect within its own site, and is not
 * allowed to redirect this tool onto somebody else's.
 *
 * Fails closed: an unparseable candidate is not same-origin.
 *
 * @complexity O(n) in the two URLs' lengths.
 */
export function isSameOriginUrl({ baseUrl, candidateUrl }: { baseUrl: string; candidateUrl: string }): boolean {
  try {
    const base = new URL(baseUrl);
    const candidate = new URL(candidateUrl);
    return base.protocol === candidate.protocol && base.host === candidate.host;
  } catch {
    return false;
  }
}
