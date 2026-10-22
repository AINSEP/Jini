import type { VerifiedOriginRequestContext, OriginRegistryPort, OriginSettingRepoPort, RedirectTargetContext, EgressTargetContext } from "./ports.js";
import { OriginNotVerifiedError, createVerifiedOrigin, type VerifiedOrigin } from "./types.js";

export { OriginNotVerifiedError };

export interface NormalizedTarget {
  scheme: "https" | "http";
  host: string;
  port: number;
}

/**
 * Check the original string before the WHATWG parser strips whitespace/controls or converts a
 * backslash to a slash. A stored backslash plus a request tail can become a browser-followed
 * cross-host Location even when a parsed-path check sees only slashes. Storage validation and
 * redirect reads must use this same raw predicate; checking a reserialized url.href checks too late.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control chars are the POINT — F3 requires rejecting C0/DEL and backslash in a raw candidate URL before the WHATWG parser silently strips them. See this constant's own doc comment. See docs/decisions/DR-001-redirect-normalization.md.
const FORBIDDEN_RAW_CHARS = /[\\\s\x00-\x1F\x7F]/;

/** Reject parser-ambiguous backslashes, whitespace and controls before URL normalization.
 * @complexity O(raw.length) time, O(1) space; pure.
 * @example hasForbiddenRawUrlCharacter({ raw: "/a b" }); // true
 */
export function hasForbiddenRawUrlCharacter({ raw }: { raw: string }): boolean {
  return FORBIDDEN_RAW_CHARS.test(raw);
}

function parseCandidateUrl(rawUrl: string): URL | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  if (hasForbiddenRawUrlCharacter({ raw: rawUrl })) return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function schemeOf(parsed: URL): "https" | "http" | null {
  if (parsed.protocol === "https:") return "https";
  if (parsed.protocol === "http:") return "http";
  return null;
}

function defaultPortFor(scheme: "https" | "http"): number {
  return scheme === "https" ? 443 : 80;
}

// Explicit ports and scheme defaults (443 for HTTPS, 80 for HTTP) must compare identically.
function resolvePort(parsed: URL, scheme: "https" | "http"): number | null {
  const port = parsed.port ? Number(parsed.port) : defaultPortFor(scheme);
  if (!Number.isInteger(port) || port <= 0) return null;
  return port;
}

// WHATWG parsing performs IDNA/case normalization; the remaining single trailing DNS dot must
// be removed consistently from candidates, trusted origins and allowlists.
/** Normalize absolute HTTP(S) candidates, refusing ambiguous input and userinfo with null.
 * HTTP normalization enables development same-origin checks; cross-origin decisions require HTTPS.
 * @complexity O(rawUrl.length) time; parser-bound space. Pure; parse errors return null.
 * @example normalizeOriginCandidate({ rawUrl: "https://Example.com./path" });
 */
export function normalizeOriginCandidate({ rawUrl }: { rawUrl: string }): NormalizedTarget | null {
  const parsed = parseCandidateUrl(rawUrl);
  if (!parsed) return null;

  const scheme = schemeOf(parsed);
  if (!scheme) return null;

  if (parsed.username !== "" || parsed.password !== "") return null;

  const host = stripTrailingDot(parsed.hostname.toLowerCase());
  if (!host) return null;

  const port = resolvePort(parsed, scheme);
  if (port === null) return null;

  return { scheme, host, port };
}

function stripTrailingDot(host: string): string {
  return host.endsWith(".") ? host.slice(0, -1) : host;
}

function effectivePort(origin: Pick<VerifiedOrigin, "scheme" | "port">): number {
  return origin.port ?? (origin.scheme === "https" ? 443 : 80);
}

// URL.origin strings preserve a trailing dot: https://site. and https://site reach the same
// server even though browsers keep their cookie/script origins separate. This destination rule
// compares normalized hosts so redirect validation and reserved-destination checks cannot disagree.
/** Compare scheme, normalized host and effective port against trusted evidence.
 * The target must already be normalized by normalizeOriginCandidate; basePath is not an origin boundary.
 * @complexity O(canonical.host.length) time and space; pure.
 * @example isSameOrigin({ target, canonical });
 */
export function isSameOrigin({ target, canonical }: { target: NormalizedTarget; canonical: VerifiedOrigin }): boolean {
  if (canonical.scheme !== target.scheme) return false;
  if (stripTrailingDot(canonical.host.toLowerCase()) !== target.host) return false;
  return effectivePort(canonical) === target.port;
}

export interface OriginRegistryDeps {
  repo: OriginSettingRepoPort;
}

/** Canonical-origin and independent redirect/egress decisions over caller-owned storage.
 * @example new OriginRegistry({ repo });
 */
export class OriginRegistry implements OriginRegistryPort {
  private readonly repo: OriginSettingRepoPort;

  constructor(deps: OriginRegistryDeps) {
    this.repo = deps.repo;
  }

  // This repository selects one origin per workspace; optional site/locale/origin keys do not
  // currently select a different origin. Missing evidence must not trigger request-host guessing.
  /** Resolve stored evidence or throw OriginNotVerifiedError; never derive trust from request headers.
   * One repository lookup; O(1) additional time/space excluding the adapter.
   */
  async canonicalOrigin(ctx: VerifiedOriginRequestContext): Promise<VerifiedOrigin> {
    const origin = await this.repo.findByWorkspaceId({ workspaceId: ctx.workspaceId });
    if (!origin) {
      throw new OriginNotVerifiedError({ message: `no verified origin registered for workspace '${ctx.workspaceId}'` });
    }
    return createVerifiedOrigin(origin);
  }

  /** Allow the canonical origin or an exact redirect-allowlist HTTPS host; errors return false.
   * @complexity O(URL length + allowlist host bytes) time/space; at most two repository reads.
   */
  async isAllowedRedirectTarget({ context: ctx, url }: { context: RedirectTargetContext; url: string }): Promise<boolean> {
    return this.isAllowedTarget(ctx, url, (workspaceId) => this.repo.findRedirectAllowlist({ workspaceId }));
  }

  /** Apply the same fail-closed rule using the separate egress destination allowlist.
   * @complexity O(URL length + allowlist host bytes) time/space; at most two repository reads.
   */
  async isAllowedEgressTarget({ context: ctx, url }: { context: EgressTargetContext; url: string }): Promise<boolean> {
    return this.isAllowedTarget(ctx, url, (workspaceId) => this.repo.findEgressAllowlist({ workspaceId }));
  }

  /** Normalize before looking up trust, then check same origin before the HTTPS-only host allowlist.
   * Storage/parse errors return false; O(URL length + allowlist host bytes) time/space.
   */
  private async isAllowedTarget(
    ctx: { workspaceId: string; siteId?: string },
    rawUrl: string,
    loadAllowlist: (workspaceId: string) => Promise<string[]>
  ): Promise<boolean> {
    try {
      const target = normalizeOriginCandidate({ rawUrl });
      if (!target) return false;

      const canonical = await this.canonicalOrigin({ workspaceId: ctx.workspaceId, ...(ctx.siteId === undefined ? {} : { siteId: ctx.siteId }) });
      if (isSameOrigin({ target, canonical })) return true;

      // Cross-origin allowlist path is https-only, unconditionally  — the. See docs/decisions/DR-001-redirect-normalization.md.
      // dev-capability http exception above applies ONLY to the same-origin comparison, never
      // to a cross-origin allowlisted target. See docs/decisions/DR-001-redirect-normalization.md.
      if (target.scheme !== "https") return false;

      const allowlist = await loadAllowlist(ctx.workspaceId);
      const allowSet = new Set(allowlist.map((host) => stripTrailingDot(host.trim().toLowerCase())));
      return allowSet.has(target.host);
    } catch {
      // Fail closed: an unverified origin, a repo error, or any unexpected
      // exception must never be treated as "allowed".
      return false;
    }
  }
}
