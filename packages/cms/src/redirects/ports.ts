/**
 * @file Port + seam contracts for the `redirects` Tier-2 library (ADR-033).
 *
 * ADR-006 accounting (rule-of-two):
 * - `RedirectRepoPort` is a genuine port — it rides the ADR-015 seam with two
 *   adapters built now (in-memory for tests + Drizzle/SQLite for persistence),
 *   matching every other feature in `src/features/*`.
 * - `RedirectMatcher` and `RedirectHitSink` are declared here as ordinary
 *   INTERNAL SEAMS, not ADR-006 ports. Neither has a second adapter under
 *   construction today: the matcher's plausible-second is an edge/CDN compiler
 *   (emit an nginx `map` / Cloudflare ruleset), the hit sink's is an external
 *   analytics store — both real, neither built now. Per ADR-006 they stay
 *   ordinary code with a documented seam, promoted to a port the day the second
 *   adapter is real. They are typed as interfaces purely for testability.
 *
 * Architectural role:
 * INTERFACES ONLY — no feature logic.
 *
 * Grounding: ADR-006 (rule-of-two), ADR-015 (repo behind a port), ADR-009
 * (typed calls / outbox / hooks), ADR-022 (chokepoint writes record a revision
 * in the same tx; bounded matching = the totality/bounded-cost trust primitive),
 * ADR-021 (permission strings enforced by the calling gateway, not the repo).
 */
import type { ISODateTime, UUID } from "@jini-ai/core/primitives";
import type { RedirectLocationRefusalReason } from "./target-gate.js";
import type { DomainEvent } from "../core/index.js";
import type {
  ListRedirectsFilter,
  RedirectHitStats,
  RedirectRecord,
  RedirectRequest,
  RedirectResolution,
  RedirectRevision,
} from "./types.js";

/**
 * Persistence port for redirect rules + their revision ledger + tombstones.
 * The single write chokepoint (ADR-022 §4a): `save` MUST persist the record and
 * its {@link RedirectRevision} in one transaction; no other module writes the
 * `redirects` / `redirect_revisions` tables (CI import-graph canary, ADR-027
 * precedent).
 */
export interface RedirectRepoPort {
  findById(required: { workspaceId: UUID; id: UUID }, optional?: Record<string, never>): Promise<RedirectRecord | null>;

  /** Index-backed O(1) exact-path lookup (active rules only). */
  lookupExact(required: {
    workspaceId: UUID;
    path: string;
    includeOverrideOnly: boolean;
  }, optional?: Record<string, never>): Promise<RedirectRecord | null>;

  /** Longest-prefix match over active `prefix` rules (index/trie-backed). */
  lookupLongestPrefix(required: {
    workspaceId: UUID;
    path: string;
    includeOverrideOnly: boolean;
  }, optional?: Record<string, never>): Promise<RedirectRecord | null>;

  /**
   * The bounded "dynamic" set: active `wildcard` + `regex` rules in evaluation
   * order (specificity → priority → recency). Returned capped; callers evaluate
   * them through {@link RedirectMatcher} only after exact/prefix miss.
   */
  listDynamic(required: {
    workspaceId: UUID;
    includeOverrideOnly: boolean;
    limit: number;
  }, optional?: Record<string, never>): Promise<RedirectRecord[]>;

  list(filter: ListRedirectsFilter, optional?: Record<string, never>): Promise<RedirectRecord[]>;

  /**
   * Resolve where an existing rule with the given `fromPattern` already points,
   * used at write time for cycle detection + chain collapsing (ADR-033 §6).
   */
  findByFromPattern(required: {
    workspaceId: UUID;
    fromPattern: string;
  }, optional?: Record<string, never>): Promise<RedirectRecord | null>;

  /** Chokepoint write: upsert the record and append its revision in one tx. */
  save(required: { record: RedirectRecord; revision: RedirectRevision }, optional?: Record<string, never>): Promise<void>;

  /** Tombstone (soft-delete): flip status + append a tombstone revision in one tx. */
  tombstone(required: { workspaceId: UUID; id: UUID; revision: RedirectRevision }, optional?: Record<string, never>): Promise<void>;
}

/**
 * INTERNAL SEAM (not an ADR-006 port). Pure, bounded matching of a request
 * against the dynamic rule set. Implementations MUST be total and
 * bounded-cost — linear-time / RE2 semantics, an anchored pattern, and a
 * per-request evaluation cap — because this is the request-hot-path expression
 * evaluator ADR-022's amendment designates a trust-boundary primitive. No
 * backtracking regex engine may back this.
 */
export interface RedirectMatcher {
  /**
   * Return the first matching rule with captures interpolated into `location`,
   * or `{ matched: false }`. `rules` is the already-ordered, already-capped
   * dynamic set from {@link RedirectRepoPort.listDynamic}.
   */
  match(required: {
    request: RedirectRequest;
    rules: RedirectRecord[];
  }, optional?: Record<string, never>): RedirectResolution;

  /**
   * Compile-time validation of a single pattern (called at the write
   * chokepoint): rejects unbounded/backtracking constructs before a rule is
   * ever stored, so an unsafe pattern cannot reach the hot path.
   */
  validatePattern(required: {
    matchType: RedirectRecord["matchType"];
    fromPattern: string;
  }, optional?: Record<string, never>): { ok: true } | { ok: false; reason: string };
}

/**
 * INTERNAL SEAM (not an ADR-006 port). Best-effort, off-hot-path hit
 * aggregation. The resolver emits a {@link RedirectHitEvent} via the outbox
 * (ADR-009 async lane); an idempotent handler folds it into the
 * `redirect_hits` sidecar through this sink. A dropped increment loses a
 * statistic, never a redirect.
 */
export interface RedirectHitSink {
  record(required: { workspaceId: UUID; redirectId: UUID; at: ISODateTime }, optional?: Record<string, never>): Promise<void>;
  getStats(required: { workspaceId: UUID; redirectId: UUID }, optional?: Record<string, never>): Promise<RedirectHitStats | null>;
  listStats(required: { workspaceId: UUID }, optional?: Record<string, never>): Promise<RedirectHitStats[]>;
}

/**
 * Application service consulted by the routing resolution chain. It is invoked
 * twice per request lifecycle: `pre_content` (override rules only) and
 * `post_content` (the 404-fill pass). The exact registration contract with the
 * (not-yet-designed) `routing` library is OWED by the future routing ADR —
 * ADR-033 §4 specifies the redirects side and flags the seam as co-dependent.
 */
export interface RedirectResolver {
  resolve(request: RedirectRequest, optional?: Record<string, never>): Promise<RedirectResolution>;
}

/* ------------------------------------------------------------------ *
 * Events (ADR-009 lane 2 — outbox, async) + Hooks (lane 3 — sync)     *
 * ------------------------------------------------------------------ */

export interface RedirectMutatedEventPayload {
  workspaceId: UUID;
  redirectId: UUID;
  change: "created" | "updated" | "tombstoned";
}
export type RedirectMutatedEvent = DomainEvent<RedirectMutatedEventPayload>;

export interface RedirectHitEventPayload {
  workspaceId: UUID;
  redirectId: UUID;
  at: ISODateTime;
}
export type RedirectHitEvent = DomainEvent<RedirectHitEventPayload>;

/**
 * Sync filter hook (ADR-009 lane 3): lets a plugin transform or short-circuit a
 * resolution — e.g. an i18n plugin rewriting the target per locale, or an SEO
 * plugin adding canonicalization. Declared-before-attached; ordered by explicit
 * priority. Conditional (geo/device/auth) redirects are the named v1-deferred
 * feature that lands ON this hook, not in core.
 */
export interface RedirectResolveHookContext {
  request: RedirectRequest;
  /** The resolution core computed; the hook returns it unchanged or replaces it. */
  resolution: RedirectResolution;
}
export type RedirectResolveHook = (
  ctx: RedirectResolveHookContext
) => RedirectResolution | Promise<RedirectResolution>;

// Structural host routing contracts: no dependency on a product routing registry.
export interface RouteResolveContext {
  readonly workspaceId: UUID;
  readonly siteId?: string;
  readonly locale?: string;
  readonly originKey?: string;
  /**
   * TODO(ADR-040): compose canonicalUrl from OriginRegistryPort.canonicalOrigin(ctx)
   * once src/origin exists. Until then, a caller that knows the verified origin
   * may pass it here; absent, canonicalUrl falls back to the relative path.
   */
  readonly originOverride?: string;
}

/** Terminal decision a phase resolver may return; anything else falls through. */
export type RouteResolvePhaseOutcome =
  | { readonly kind: "redirect"; readonly location: string; readonly statusCode: number }
  | { readonly kind: "resolved"; readonly path: string }
  | { readonly kind: "not_found" };

/** Payload handed to the bound {@link SlugChangeCapture} inside the rename transaction. */
export interface SlugChangeCaptureInput {
  readonly workspaceId: UUID;
  readonly entryId: UUID;
  readonly oldPath: string;
  readonly newPath: string;
  readonly actor: UUID;
  readonly changeSetId?: UUID;
}

/**
 * The single named slot content's write chokepoint calls inside the rename
 * transaction (ADR-039 §4). Declared here by routing (content knows nothing of
 * redirects); implemented by the redirects library; wired by the composition
 * root. **No slot implementation may be plugin-supplied** (Round-2 amendment 1
 * — the slot is core-resident by definition).
 *
 * Constraints on any bound implementation (Round-2 amendment 2): idempotent by
 * `changeSetId`, no external I/O, no in-tx publish (an outbox row may be
 * written in-tx per the transactional-outbox pattern, but dispatch happens
 * post-commit), and a strict lock order of content row before redirect rows.
 *
 * Fail-closed nuance (Round-2 amendment 3, not enforced by this library):
 * absent binding is a no-op only before Redirects is installed, or while
 * slug-preservation is disabled for the workspace. Once link-preservation is
 * enabled, a slug-changing rename with no bound capture MUST fail
 * `LINK_PRESERVATION_UNAVAILABLE` rather than silently skip the redirect. That
 * enforcement belongs to the content write chokepoint (which knows whether
 * preservation is enabled) and to Redirects (which doesn't exist yet in this
 * repo) — this library only exposes the registration slot.
 */
export interface SlugChangeCapture {
  onSlugChange(input: SlugChangeCaptureInput, optional?: Record<string, never>): Promise<void>;
}

/** Refusal evidence never exposes a redirect that bypassed the INV-03 gate. */
export interface RedirectRefusal {
  redirectId: UUID;
  location: string;
  reason: RedirectLocationRefusalReason;
}
export interface RedirectResolutionReport {
  resolution: RedirectResolution;
  refused: RedirectRefusal[];
}
/** The legacy resolver plus refusal evidence for adapters that must report declines. */
export interface RedirectResolverWithRefusals extends RedirectResolver {
  resolveWithRefusals(request: RedirectRequest, optional?: Record<string, never>): Promise<RedirectResolutionReport>;
}
