import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
/**
 * @file `RedirectResolver` (read-path resolution) + `registerRedirectsPhaseHandlers`
 * (routing-chain adapter) — SPEC-009 REQ-09/10/18/19/20; ADR-PIPE-009 C-006/C-007.
 *
 * Purpose:
 * Owns the read-path open-redirect oracle call (C-013 in the implementation
 * outline) — the single highest-risk contract in this feature. Gathers
 * phase-eligible candidate rules from `RedirectRepoPort`'s three lookup
 * methods (`lookupExact`/`lookupLongestPrefix`/`listDynamic`), hands them to
 * `RedirectMatcher.match` for precedence/tie-break/interpolation, then
 * validates the FULLY-INTERPOLATED `location` via
 * `OriginRegistryPort.isAllowedRedirectTarget` in EVERY code path before ever
 * returning a `matched: true` outcome (INV-03), and then — for a destination that is same-origin
 * with the workspace's own verified origin, which the oracle allows by construction — the shared
 * reserved-path rule from `./reserved-destination.ts`'s `checkSameOriginDestination`. The second
 * half has to live here rather than only at the write chokepoint because interpolation happens on
 * THIS path: the stored `toTarget` is a template, and `Location` is what comes out of it.
 *
 * Oracle-call discipline (documented, load-bearing): `isAllowedRedirectTarget`
 * only accepts a fully-qualified, WHATWG-parseable candidate URL (see
 * `origin/origin.ts`'s `normalizeOriginCandidate` — a bare relative path like
 * `/new` fails to parse with no base and would otherwise always resolve to
 * "not allowed"). So a plain relative `location` is first resolved to an
 * absolute URL against the workspace's own verified canonical origin (making
 * the oracle call against a genuinely absolute, same-origin-by-construction
 * candidate) before being handed to the oracle — this satisfies "call the
 * oracle in every code path" literally while keeping ordinary same-site
 * redirects (the overwhelmingly common case) working. A `location` that
 * already looks absolute or protocol-relative (contains a scheme prefix or
 * starts with `//`) is passed to the oracle exactly as interpolated, since
 * resolving it against the canonical origin first would corrupt it. If the
 * workspace has no verified origin registered at all, this fails closed
 * (`{ matched: false }`) rather than guessing — matches `origin`'s own
 * fail-closed posture (`OriginNotVerifiedError`).
 *
 * Architectural role:
 * Feature logic (`RedirectPhaseHandlerResolver`, implements `RedirectResolver`)
 * + a thin composition-root registration function
 * (`registerRedirectsPhaseHandlers`) that adapts to/from `routing`'s
 * `RouteResolvePhaseHandler` shape. No Express/route code.
 */
import type { Clock as ClockPort, IdGenerator as IdGeneratorPort } from "@jini-ai/core/primitives";
import type { DomainEvent, OutboxPort } from "../core/index.js";
import { checkRedirectLocation, type RedirectTargetOracle } from "./target-gate.js";

import type {
  RedirectHitEvent,
  RedirectMatcher,
  RedirectRepoPort,
  RedirectResolverWithRefusals,
  RedirectResolutionReport,
} from "./ports.js";
import type { RedirectRecord, RedirectRequest, RedirectResolution } from "./types.js";

/** The bounded dynamic (wildcard) set cap (behavior.spec.md §3/§4, OQ-01). */
const DYNAMIC_SET_LIMIT = 500;

export interface RedirectPhaseHandlerDeps {
  repo: RedirectRepoPort;
  matcher: RedirectMatcher;
  originRegistry: RedirectTargetOracle;
  /** First path segments reserved by the composing host; no product-policy default. */
  reservedSegments: ReadonlySet<string>;
  /**
   * Hit-recording deps (W-008) — OPTIONAL so unit tests exercising the
   * oracle gate alone (T006) don't need to stub them. When present, a
   * successful resolution enqueues a `redirect.hit` outbox event,
   * fire-and-forget (never awaited before the outcome is returned, never
   * allowed to affect the resolution — REQ-21/AC-26).
   */
  hits?: { outbox: OutboxPort; clock: ClockPort; idGen: IdGeneratorPort };
}

/**
 * `RedirectResolver` implementation — the resolution entry point the routing-
 * chain adapter (`registerRedirectsPhaseHandlers`) calls per phase.
 */
export class RedirectPhaseHandlerResolver implements RedirectResolverWithRefusals {
  constructor(private readonly deps: RedirectPhaseHandlerDeps, _optional: Record<string, never> = {}) {}

  /**
   * @complexity O(1) exact/prefix (index-backed) + O(k) dynamic scan, k =
   * the capped dynamic-set size (500).
   */
  async resolve(request: RedirectRequest, _optional: Record<string, never> = {}): Promise<RedirectResolution> {
    return (await this.resolveWithRefusals(request, {})).resolution;
  }

  /**
   * Same resolution and hit effects, with explicit refusal evidence for SPA/HTTP adapters.
   * @returns The unchanged legacy resolution plus any rejected finished Location.
   * @complexity O(1) exact/prefix retrieval plus O(k) capped dynamic candidate scan.
   */
  async resolveWithRefusals(request: RedirectRequest, _optional: Record<string, never> = {}): Promise<RedirectResolutionReport> {
    const includeOverrideOnly = request.phase === "pre_content";
    const lookupBase = { workspaceId: request.workspaceId, includeOverrideOnly };

    const [exact, prefix, dynamic] = await Promise.all([
      this.deps.repo.lookupExact({ ...lookupBase, path: request.path }),
      this.deps.repo.lookupLongestPrefix({ ...lookupBase, path: request.path }),
      this.deps.repo.listDynamic({ ...lookupBase, limit: DYNAMIC_SET_LIMIT }),
    ]);

    const candidates: RedirectRecord[] = [exact, prefix, ...dynamic].filter(
      (r): r is RedirectRecord => r !== null
    );
    if (candidates.length === 0) return { resolution: { matched: false }, refused: [] };

    const resolution = this.deps.matcher.match({ request, rules: candidates });
    if (!resolution.matched) return { resolution: { matched: false }, refused: [] };

    // INV-03: the read-path open-redirect oracle gate — MUST run in every
    // code path before ever returning a matched:true outcome.
    const verdict = await checkRedirectLocation({
      context: { workspaceId: request.workspaceId }, location: resolution.location,
      oracle: this.deps.originRegistry, reservedSegments: this.deps.reservedSegments,
    }, {});
    if (verdict.kind === "refused") {
      return { resolution: { matched: false }, refused: [{ redirectId: resolution.redirectId, location: resolution.location, reason: verdict.reason }] };
    }

    this.recordHitFireAndForget(request.workspaceId, resolution.redirectId);
    return { resolution, refused: [] };
  }

  /**
   * W-008: enqueue a `redirect.hit` event, fire-and-forget. MUST NOT be
   * awaited before the redirect response is sent, and MUST NOT let an
   * enqueue failure affect the resolution outcome (REQ-21/AC-26).
   */
  private recordHitFireAndForget(workspaceId: string, redirectId: string): void {
    if (!this.deps.hits) return;
    const { outbox, clock, idGen } = this.deps.hits;
    const event: RedirectHitEvent = {
      id: idGen.newId(),
      name: "redirect.hit",
      occurredAt: clockNowIso({ clock: clock }),
      aggregateId: redirectId,
      workspaceId,
      payload: { workspaceId, redirectId, at: clockNowIso({ clock: clock }) },
    };
    // See redirects.ts's `enqueueMutatedEvent` comment for why this cast is needed (a named
    // interface payload isn't auto-assignable to DomainEvent's default Record<string,unknown>).
    void outbox.enqueue(event as unknown as DomainEvent).catch(() => {
      // Best-effort — a dropped hit-count enqueue never affects the redirect response (INV-06).
    });
  }
}

/**
 * Create the read-path resolver with the required origin oracle and host path policy.
 * @param required Repository, matcher, oracle and reserved path segments.
 * @param optional Optional best-effort hit recording, independent of resolution.
 * @returns A resolver that checks the fully interpolated Location before returning a match.
 * @complexity O(1) construction; resolve inherits the bounded candidate scan.
 * @example createRedirectResolver({ repo, matcher, originRegistry, reservedSegments }, {});
 */
export function createRedirectResolver(
  required: Omit<RedirectPhaseHandlerDeps, "hits">,
  optional: Pick<RedirectPhaseHandlerDeps, "hits"> = {},
): RedirectResolverWithRefusals {
  return new RedirectPhaseHandlerResolver({ ...required, ...optional });
}
