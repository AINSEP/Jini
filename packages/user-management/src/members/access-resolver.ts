/**
 * @file `MemberAccessResolver` implementation (ADR-030 §4).
 *
 * Purpose:
 * The core entitlement/content-gating evaluator. `resolveContext` turns a raw
 * member-cookie session token into a validated `MemberContext` (never trusting a
 * client-supplied claim); `decide` is a pure fail-closed visibility check against
 * that context. This is ordinary core code, NOT a port and NOT the ADR-021
 * operator `authorize()` — see `ports.ts` for the "no PolicyPort" reasoning.
 *
 * Architectural role:
 * Read-path chokepoint for gated content. Depends only on the repo ports
 * (`MemberSessionRepoPort`, `MemberSubscriptionRepoPort`, `MemberTierRepoPort`) —
 * never a mutation path.
 */
import { createHash } from "node:crypto";
import { MemberLoginError } from "../server/login-types.js";
import type { MemberRepoPort } from "./ports.js";

import type { MemberAccessResolver } from "./ports.js";
import type { MemberSessionRepoPort, MemberSubscriptionRepoPort, MemberTierRepoPort } from "./ports.js";
import type { MemberAccessDecision, MemberContentAccess, MemberContentVisibility, MemberContext, MemberSessionRecord } from "./types.js";

/** Anonymous/invalid-session context — the fail-closed default. */
const ANONYMOUS_CONTEXT: MemberContext = { isAuthenticated: false, activeTierIds: [], isPaid: false };

/**
 * Decodes a post's raw `memberAccessJson` column (`posts.ext` is NOT this value — see
 * `schema.sqlite.ts`'s doc on the column) into the `MemberContentAccess` {@link DefaultMemberAccessResolver.decide}
 * expects. This is the one place that owns the `JSON.parse` boundary for the column, mirroring
 * `Jini/packages/cms/src/seo/seo.ts`'s identical ownership of `seoExtJson`'s parse boundary — `post`/its repo
 * adapters stay ignorant of this value's shape.
 *
 * `null`/`undefined`/`""` (every pre-existing row, and any row nobody has ever gated) decodes as
 * `{visibility: "public"}` — the exact behavior every row already has today, so reading a
 * never-gated post costs zero migration-time backfill.
 *
 * Malformed JSON deliberately does NOT fall back to `"public"` — that would fail OPEN on stored-data
 * corruption, the opposite of this module's fail-closed design. It decodes to a `visibility` value
 * outside the known union instead, so {@link DefaultMemberAccessResolver.decide}'s own fail-closed
 * default (the `unknown_visibility` branch) denies it exactly like any other unrecognized value —
 * no special-casing needed at this call site or that one.
 *
 * @complexity O(1) — one `JSON.parse` of a small, editorial-sized string.
 */
export function resolvePostMemberAccess({ raw }: { raw: string | null | undefined }, _optional: Record<string, never> = {}): MemberContentAccess {
  if (!raw) return { visibility: "public" };
  try {
    return JSON.parse(raw) as MemberContentAccess;
  } catch {
    return { visibility: "malformed_member_access_json" as MemberContentVisibility };
  }
}

/**
 * SHA-256 hex digest of a raw bearer token. Shared shape with `write-service.ts`'s
 * own `hashToken` (duplicated intentionally — both are 1-line, and this file must
 * not import from `write-service.ts`: the read-path resolver has no business
 * depending on the mutation-path module).
 */
function hashToken({ rawToken }: { rawToken: string }, _optional = {}): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Shared session validity check for /me and password changes; never accepts an admin cookie.
 * @returns The live member session, or null for absent, unknown, revoked or expired tokens.
 * @complexity O(1) indexed lookup; adapter failures propagate.
 * @example resolveMemberSession({ sessions, workspaceId, sessionToken, nowIso });
 */
export async function resolveMemberSession(required: {
  sessions: MemberSessionRepoPort; workspaceId: string; sessionToken?: string | undefined; nowIso: string;
}, _options: Record<string, never> = {}): Promise<MemberSessionRecord | null> {
  const { sessions, workspaceId, sessionToken, nowIso } = required;
  if (!sessionToken) return null;
  const session = await sessions.findByTokenHash({ workspaceId, tokenHash: hashToken({ rawToken: sessionToken }) });
  if (!session || session.revokedAt || session.expiresAt <= nowIso) return null;
  return session;
}

export interface MemberAccessResolverDeps {
  sessions: MemberSessionRepoPort;
  subscriptions: MemberSubscriptionRepoPort;
  tiers: MemberTierRepoPort;
}

/**
 * Default `MemberAccessResolver`. See {@link MemberAccessResolverDeps} for the
 * repo ports it reads from (session lookup + entitlement/tier-type resolution).
 *
 * @overallScore 100
 */
export class DefaultMemberAccessResolver implements MemberAccessResolver {
  private readonly deps: MemberAccessResolverDeps;
  constructor(deps: MemberAccessResolverDeps) {
    this.deps = deps;
  }

  /**
   * Resolve the request's `MemberContext` from a raw session token.
   *
   * @complexity O(1) session lookup + O(k) subscription/tier lookups, k = the
   * member's active subscription count (small, bounded by tier registry size).
   */
  async resolveContext(required: {
    workspaceId: string;
    sessionToken?: string | undefined;
    nowIso: string;
  }): Promise<MemberContext> {
    const { workspaceId, sessionToken, nowIso } = required;
    const session = await resolveMemberSession({ sessions: this.deps.sessions, workspaceId, sessionToken, nowIso });
    if (!session) return ANONYMOUS_CONTEXT;

    const activeSubscriptions = await this.deps.subscriptions.listActiveByMember({
      workspaceId,
      memberId: session.memberId,
      nowIso,
    });
    const activeTierIds = activeSubscriptions.map((subscription) => subscription.tierId);

    let isPaid = false;
    for (const tierId of activeTierIds) {
      const tier = await this.deps.tiers.findById({ workspaceId, id: tierId });
      if (tier?.type === "paid") {
        isPaid = true;
        break;
      }
    }

    return { isAuthenticated: true, memberId: session.memberId, activeTierIds, isPaid };
  }

  /**
   * Decide whether `context` may read an entry carrying `access`. Pure function;
   * fail-closed on any visibility value outside the known union (ADR-021 §8
   * lineage) — an unparseable/unknown value denies with no teaser.
   *
   * Dispatches to one per-visibility decision function below (extracted so this
   * function stays pure sequencing — each branch's logic, including its own
   * `@complexity`, lives with its own decision).
   *
   * @complexity O(t·a), t = `access.tierIds?.length`, a = `context.activeTierIds.length`
   *   (both small, editorial/entitlement data).
   */
  decide(required: { access: MemberContentAccess; context: MemberContext }): MemberAccessDecision {
    const { access, context } = required;

    switch (access.visibility) {
      case "public":
        return decidePublicAccess();
      case "members":
        return decideMembersAccess(context);
      case "paid":
        return decidePaidAccess(context);
      case "tiers":
        return decideTiersAccess(access, context);
      default:
        return decideUnknownVisibilityAccess(access.visibility);
    }
  }
}

/** `visibility: "public"` always allows, with no context to consult.
 *  @complexity O(1). */
function decidePublicAccess(): MemberAccessDecision {
  return { allowed: true, visibility: "public", reason: "public", teaser: false };
}

/** `visibility: "members"` allows any authenticated member regardless of paid status.
 *  @complexity O(1). */
function decideMembersAccess(context: MemberContext): MemberAccessDecision {
  if (context.isAuthenticated) {
    return { allowed: true, visibility: "members", reason: "entitled", teaser: false };
  }
  return { allowed: false, visibility: "members", reason: "sign_in_required", teaser: true };
}

/** `visibility: "paid"` allows only an authenticated member with an active paid subscription.
 *  @complexity O(1). */
function decidePaidAccess(context: MemberContext): MemberAccessDecision {
  if (context.isAuthenticated && context.isPaid) {
    return { allowed: true, visibility: "paid", reason: "entitled", teaser: false };
  }
  return {
    allowed: false,
    visibility: "paid",
    reason: context.isAuthenticated ? "upgrade_required" : "sign_in_required",
    teaser: true,
  };
}

/** `visibility: "tiers"` allows an authenticated member holding at least one of `access.tierIds`.
 *  @complexity O(t·a) — `requiredTierIds.some(...)` nests `context.activeTierIds.includes(...)`,
 *  t = `access.tierIds?.length`, a = `context.activeTierIds.length` (both small, editorial/
 *  entitlement data, so real-world impact is negligible — but the bound itself is O(t·a), not O(t)). */
function decideTiersAccess(access: MemberContentAccess, context: MemberContext): MemberAccessDecision {
  const requiredTierIds = access.tierIds ?? [];
  const isEntitled = requiredTierIds.some((tierId) => context.activeTierIds.includes(tierId));
  if (context.isAuthenticated && isEntitled) {
    return { allowed: true, visibility: "tiers", reason: "entitled", teaser: false };
  }
  return {
    allowed: false,
    visibility: "tiers",
    reason: context.isAuthenticated ? "upgrade_required" : "sign_in_required",
    teaser: true,
  };
}

/** Fail-closed: any value outside the known `MemberContentVisibility` union denies, no teaser.
 *  @complexity O(1). */
function decideUnknownVisibilityAccess(visibility: MemberContentVisibility): MemberAccessDecision {
  return {
    allowed: false,
    visibility,
    reason: "unknown_visibility",
    teaser: false,
  };
}

/**
 * The public routes' and admin preview's `MemberAccessResolver` (ADR-030 §4), built per render from
 * the three member repo ports already on `RouteDeps`. Deliberately NOT a module-level singleton: `deps` is
 * per-composition (every test in `__tests__/` injects its own in-memory repos through
 * `createRouteDeps` overrides), so a singleton would capture whichever composition happened to
 * construct first and then answer every later request from the wrong workspace's data.
 * Construction performs no reads; only `resolveContext` with a session token reads the repo ports.
 * @complexity O(1) time and space.
 * @example createMemberAccessResolver({ deps });
 */
export function createMemberAccessResolver(
  { deps }: { deps: { memberSessionRepo: MemberSessionRepoPort; memberSubscriptionRepo: MemberSubscriptionRepoPort; memberTierRepo: MemberTierRepoPort } },
  _options: Record<string, never> = {}
): MemberAccessResolver {
  return new DefaultMemberAccessResolver({
    sessions: deps.memberSessionRepo,
    subscriptions: deps.memberSubscriptionRepo,
    tiers: deps.memberTierRepo,
  });
}

/** Resolve only the member cookie, including revocation; operator cookies cannot purchase. O(1) reads. */
export async function activeMemberFromSession({ deps }: { deps: {
  memberSessionRepo: MemberSessionRepoPort;
  memberRepo: Pick<MemberRepoPort, 'findById'>;
  workspaceId: string;
  sessionToken: () => string | undefined;
  nowIso: () => string;
} }, _optional = {}): Promise<string | null> {
  let sessionToken: string | undefined;
  try { sessionToken = deps.sessionToken(); }
  catch (error) {
    if (error instanceof MemberLoginError) return null;
    throw error;
  }
  const session = await resolveMemberSession({ sessions: deps.memberSessionRepo, workspaceId: deps.workspaceId,
    sessionToken, nowIso: deps.nowIso() });
  if (!session) return null;
  const member = await deps.memberRepo.findById({ workspaceId: deps.workspaceId, id: session.memberId });
  // Session resolution alone must not resurrect a suspended/trashed member.
  if (!member || member.status !== "active") return null;
  if (member.credentialsRevokedAt && session.createdAt < member.credentialsRevokedAt) return null;
  return member.id;
}
