/**
 * @file Core type definitions for the `redirects` Tier-2 library (ADR-033).
 *
 * Purpose:
 * Declares the row/record shapes, the resolution result, and the command
 * envelopes the redirects subsystem introduces. Redirect rules are operational
 * routing state layered over the (future) `routing` library — they are NOT
 * `entries` (ADR-022): modelling them as content would generate an editorial
 * revision on every hit-count touch (INV-3 violation) and put high-write
 * telemetry on the content chokepoint. Redirects therefore own dedicated,
 * core-owned tables that reuse ADR-022's *discipline* (single write chokepoint,
 * append-only revisions, ULIDs, bounded validation, CI canary) — the same call
 * ADR-027 (media sidecars) and ADR-028 (settings ledger) made.
 *
 * Architectural role:
 * INTERFACES AND TYPES ONLY — no feature logic. Concrete matchers, repos, and
 * the resolver service satisfy these contracts elsewhere.
 *
 * Grounding: ADR-033 (this subsystem), ADR-022 (chokepoint/revision discipline,
 * pluginId attribution, bounded expression language), ADR-021 (flat permission
 * strings, composite workspace scoping), ADR-007 (workspaceId everywhere),
 * ADR-009 (typed calls / outbox events / hooks), ADR-015 (repo behind a port).
 */
import type { ISODateTime, UUID } from "@jini-ai/core/primitives";

/**
 * HTTP status a matched rule emits. 301/308 are permanent (cacheable, SEO
 * link-equity transfer); 302/307 are temporary. 307/308 preserve the request
 * method + body (the RFC 7538 successors to 301/302), which matters for
 * non-GET routes; the admin default is 301.
 */
export type RedirectStatusCode = 301 | 302 | 307 | 308;

/**
 * How a rule's `fromPattern` is matched against an incoming path.
 * - `exact`    — full-path equality; index-backed O(1) lookup.
 * - `prefix`   — longest-prefix match; index/trie-backed, with optional tail
 *                pass-through to the target (`/old` → `/new` maps `/old/x` → `/new/x`).
 * - `wildcard` — glob with `*` capture segments; interpolated into the target
 *                via `$1..$n`. Part of the bounded "dynamic" seam.
 * - `regex`    — anchored, bounded (linear-time / RE2-semantics) regular
 *                expression with `$1..$n` capture interpolation. Authoring is
 *                gated behind `redirects.use_regex` (ADR-021) and OFF by default:
 *                arbitrary regex is exactly the unbounded-expression trust hazard
 *                ADR-022's amendment forbids, so it stays a named, gated seam.
 */
export const REDIRECT_MATCH_TYPES = ["exact", "prefix", "wildcard", "regex"] as const;
export type RedirectMatchType = (typeof REDIRECT_MATCH_TYPES)[number];

/**
 * Provenance of a rule. `auto_slug_change` rows are minted by core inside the
 * content write transaction (never-break-links, ADR-033 §5) and carry the entry
 * lineage below; `manual` and `import` come from operators/AI/migration.
 */
export const REDIRECT_SOURCES = ["manual", "auto_slug_change", "import"] as const;
export type RedirectSource = (typeof REDIRECT_SOURCES)[number];

/** Lifecycle of a rule. Disabled rules are retained (audit) but never matched. */
export const REDIRECT_STATUSES = ["active", "disabled"] as const;
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number];

/**
 * A single redirect rule — a row in the core-owned `redirects` table.
 * Written only through the redirects chokepoint, which records a
 * {@link RedirectRevision} in the same transaction (ADR-022 §4a).
 */
export interface RedirectRecord {
  /** ULID — stable identity (ADR-022 §4c). */
  id: UUID;
  /** Tenant boundary; part of every composite FK (ADR-007/021). */
  workspaceId: UUID;
  matchType: RedirectMatchType;
  /** Normalized source pattern (leading slash, no trailing slash, lower-cased host-relative path). */
  fromPattern: string;
  /**
   * Resolved destination — a normalized site-relative path, or an absolute URL.
   * Absolute/off-site targets are an open-redirect vector: they require
   * `redirects.manage` + host allowlist (ADR-033 §7), enforced at write time.
   */
  toTarget: string;
  statusCode: RedirectStatusCode;
  status: RedirectStatus;
  /**
   * When true the rule is consulted BEFORE live content resolution (retire a
   * live URL). Default false: rules only fill the 404 path so reusing an old
   * slug for new content transparently reclaims it. Setting `override` needs
   * `redirects.manage`.
   */
  override: boolean;
  /** Explicit tie-breaker within an equal-specificity band (higher wins). */
  priority: number;
  source: RedirectSource;
  /** Provenance for `auto_slug_change` rows — the entry whose slug moved. */
  sourceEntryId?: UUID | undefined;
  /** Old/new path captured at the slug change (auto rows only). */
  fromPathAtCapture?: string | undefined;
  toPathAtCapture?: string | undefined;
  /** Principal that caused the write (ADR-021). For auto rows, the slug-change actor. */
  createdByPrincipal: UUID;
  /** Originating plugin, or undefined for core/operator writes (ADR-022 attribution). */
  createdByPluginId?: string | undefined;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Monotonic per-record revision counter (ADR-022 §4c). */
  version: number;
}

/**
 * Append-only revision of a rule (ADR-022 §4b): full post-state snapshot +
 * actor + attribution + monotonic sequence, written in the same transaction as
 * the mutation. Deletes tombstone; the ledger is never rewritten.
 */
export interface RedirectRevision {
  redirectId: UUID;
  workspaceId: UUID;
  /** Monotonic sequence per redirect. */
  seq: number;
  /** Complete state after the mutation (or the tombstone marker). */
  state: RedirectRecord;
  tombstoned: boolean;
  actorId: UUID;
  pluginId?: string | undefined;
  recordedAt: ISODateTime;
}

/**
 * Operational hit telemetry — a row in the core-owned `redirect_hits` sidecar.
 * DELIBERATELY excluded from the revision discipline above (narrows ADR-022
 * INV-3, exactly as ADR-027 does for `asset_renditions`): counters are
 * high-write, best-effort, and non-critical to the never-break-links guarantee.
 * Updated asynchronously off the request hot path (ADR-009 outbox lane), so a
 * dropped increment loses a statistic, never a redirect.
 */
export interface RedirectHitStats {
  redirectId: UUID;
  workspaceId: UUID;
  hitCount: number;
  lastHitAt?: ISODateTime | undefined;
}

/**
 * Where in the request pipeline a resolution attempt runs.
 * - `pre_content`  — only `override` rules are eligible (retire a live URL).
 * - `post_content` — the default 404-fill pass (all active rules).
 */
export type RedirectResolvePhase = "pre_content" | "post_content";

/** Normalized inbound request handed to the resolver by the routing chain. */
export interface RedirectRequest {
  workspaceId: UUID;
  /** Normalized, query-stripped request path (e.g. `/old/page`). */
  path: string;
  phase: RedirectResolvePhase;
}

/**
 * Outcome of a resolution attempt. `location` already has wildcard/regex
 * captures interpolated and (for prefix rules) any tail appended. Resolution
 * follows AT MOST ONE hop — chains are collapsed at write time (ADR-033 §6), so
 * the request path never chases A→B→C.
 */
export type RedirectResolution =
  | { matched: false }
  | {
      matched: true;
      redirectId: UUID;
      location: string;
      statusCode: RedirectStatusCode;
      matchType: RedirectMatchType;
    };

/** Create-rule command envelope (mirrors the features/* Required/Deps/Input idiom). */
export interface CreateRedirectInput {
  workspaceId: UUID;
  matchType: RedirectMatchType;
  fromPattern: string;
  toTarget: string;
  statusCode: RedirectStatusCode;
  override?: boolean | undefined;
  priority?: number | undefined;
  actorId: UUID;
  pluginId?: string | undefined;
}

/** Update-rule command envelope. */
export interface UpdateRedirectInput {
  workspaceId: UUID;
  id: UUID;
  matchType?: RedirectMatchType | undefined;
  fromPattern?: string | undefined;
  toTarget?: string | undefined;
  statusCode?: RedirectStatusCode | undefined;
  status?: RedirectStatus | undefined;
  override?: boolean | undefined;
  priority?: number | undefined;
  actorId: UUID;
  pluginId?: string | undefined;
}

/** Filter for admin/AI listing. */
export interface ListRedirectsFilter {
  workspaceId: UUID;
  status?: RedirectStatus | undefined;
  source?: RedirectSource | undefined;
  matchType?: RedirectMatchType | undefined;
}

/** Validation / safety failures raised by the redirects chokepoint. */
export class RedirectNotFoundError extends Error {}
export class RedirectValidationError extends Error {}
export class RedirectConflictError extends Error {}
/** Raised when a create/update would introduce a cycle that cannot be collapsed. */
export class RedirectLoopError extends Error {}
/**
 * Raised by the write chokepoint (`redirects.ts`) when an absolute/off-site
 * `toTarget` fails `OriginRegistryPort.isAllowedRedirectTarget` (REQ-08,
 * errors.spec.md `REDIRECT_TARGET_NOT_ALLOWED`). The read-path oracle
 * rejection (`phase-handler.ts`, REQ-09/10) never raises this — it resolves
 * to `{ matched: false }` instead (never surfaced as an HTTP error).
 */
export class RedirectTargetNotAllowedError extends Error {}
