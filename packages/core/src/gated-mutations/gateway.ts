/**
 * Transport-neutral plan -> confirm -> execute approval ceremony.
 * Ordering: authorize, token state, fresh actor identity, scope/hash, atomic redeem, mutation.
 * Mutation receives the verified plan and must not independently rederive its write set.
 * O(1) local work plus injected port costs; no lock or transactional rollback is implied.
 */
import { nowIso, type Clock, type IdGenerator } from "../primitives/index.js";
import type { AuthorizeFn, InstanceAuthorizeFn, PrincipalKind } from "./ports.js";
import {
  type ConfirmationTokenRecord,
  type TokenStorePort,
  TokenAlreadyRedeemedError,
  TokenExpiredError,
  isRedeemable,
  mintToken,
} from "./token.js";

export interface GatedMutationHooks<TDetails, TResult> {
  domain: string;
  readPermission: string;
  mutatePermission: string;
  /** Workspace scope is the authorization target; for instance scope this is only an opaque
   * audit label. A workspace grant must never stand in for authority over every workspace. */
  scopeId: string;
  /** Omission preserves workspace authorization; instance scope uses its own injected evaluator. */
  scopeKind?: "workspace" | "instance";
  computePlan(required: Record<string, never>): Promise<{ planHash: string; details: TDetails }>;
  /**
   * Apply the verified plan, never recompute it: token redemption and any intervening mutation
   * work separate verification from application, and this gateway takes no operation lock.
   * Re-deriving there can apply a different write set from the one the operator approved.
   * A mutation without plan-dependent work can ignore this argument.
   */
  executeMutation(verified: { planHash: string; details: TDetails }): Promise<TResult>;
  /** Resolve fresh at execution: the user itself, an agent's current delegator, or an API key's
   * owning user. Confirm-time identity can become stale before redemption. */
  resolveActorClassIdentity(params: { principalId: string; principalKind: PrincipalKind }): Promise<string | null>;
}

export interface GatewayDeps {
  /** Required token policy: caller supplies the complete opaque token and TTL. */
  generateToken: (required: Record<string, never>) => string;
  ttlSeconds: number;
  clock: Clock;
  idGen: IdGenerator;
  authorize: AuthorizeFn;
  /** Missing instance authorization must deny, never fall back to a workspace-scoped grant. */
  authorizeInstance?: InstanceAuthorizeFn;
  tokens: TokenStorePort;
}

export interface GatewayPlan {
  domain: string;
  planId: string;
  planHash: string;
  details: unknown;
}

export class ForbiddenError extends Error {
  readonly reasonCode: string;

  constructor(required: { message: string; reasonCode: string }, optional: ErrorOptions = {}) {
    super(required.message, optional);
    this.reasonCode = required.reasonCode;
  }
}

export class PlanStaleError extends Error {
  constructor(required: { message: string }, optional: ErrorOptions = {}) {
    super(required.message, optional);
  }
}

// Reserved for a host that cannot establish caller identity before entering the ceremony;
// the gateway itself does not currently raise this error.
export class UnauthenticatedError extends Error {
  constructor(required: { message: string }, optional: ErrorOptions = {}) {
    super(required.message, optional);
  }
}

/**
 * Share this scope decision with route authorization before operation-lock acquisition. A route
 * that hardcodes workspace authorization can briefly acquire a lock with insufficient instance
 * authority before the deeper gate refuses it. Missing instance wiring therefore denies outright.
 */
export async function authorizeForHooks(
  required: { deps: GatewayDeps; hooks: GatedMutationHooks<unknown, unknown>; principalId: string; permission: string }
): Promise<{ allowed: boolean; reason: string }> {
  const { deps, hooks, principalId, permission } = required;
  if (hooks.scopeKind !== "instance") {
    return deps.authorize({ principalId, permission, workspaceId: hooks.scopeId });
  }
  if (!deps.authorizeInstance) {
    return { allowed: false, reason: "INSTANCE_AUTHORIZATION_NOT_CONFIGURED" };
  }
  return deps.authorizeInstance({ principalId, permission });
}

// Planning is read-only: check read permission and derive details, never invoke executeMutation.
export async function plan(
  required: { deps: GatewayDeps; principalId: string; principalKind: PrincipalKind; hooks: GatedMutationHooks<unknown, unknown> },
  _optional: Record<string, never> = {}
): Promise<GatewayPlan> {
  const { deps, principalId, hooks } = required;

  const authResult = await authorizeForHooks({ deps, hooks, principalId, permission: hooks.readPermission });
  if (!authResult.allowed) {
    throw new ForbiddenError({ message: `principal '${principalId}' is not authorized for '${hooks.readPermission}' (${authResult.reason})`, reasonCode: "NOT_AUTHORIZED" });
  }

  const { planHash, details } = await hooks.computePlan({});
  return { domain: hooks.domain, planId: deps.idGen.newId(), planHash, details };
}

// Confirmation is a human/API-key act: an agent may redeem its delegator's approval later,
// but may never mint its own confirmation, regardless of its mutation permissions.
export async function confirm(
  required: {
    deps: GatewayDeps;
    principalId: string;
    principalKind: PrincipalKind;
    hooks: GatedMutationHooks<unknown, unknown>;
    planId: string;
    planHash: string;
  },
  _optional: Record<string, never> = {}
): Promise<ConfirmationTokenRecord> {
  const { deps, principalId, principalKind, hooks, planId, planHash } = required;

  if (principalKind === "agent") {
    throw new ForbiddenError({ message: `agent principals may not confirm a gated mutation`, reasonCode: "AGENT_CANNOT_CONFIRM" });
  }

  const authResult = await authorizeForHooks({ deps, hooks, principalId, permission: hooks.mutatePermission });
  if (!authResult.allowed) {
    throw new ForbiddenError({ message: `principal '${principalId}' is not authorized for '${hooks.mutatePermission}' (${authResult.reason})`, reasonCode: "NOT_AUTHORIZED" });
  }

  const token = mintToken({
    planId,
    planHash,
    scopeId: hooks.scopeId,
    confirmerPrincipalId: principalId,
    now: nowIso({ clock: deps.clock }),
    generateToken: deps.generateToken,
    ttlSeconds: deps.ttlSeconds,
  });
  await deps.tokens.save({ record: token });
  return token;
}

/**
 * Rejection precedence is binding when failures co-occur: fresh authorization, token state,
 * fresh actor identity, then plan validity. Expired/redeemed tokens win over identity mismatch;
 * identity mismatch wins over a simultaneously stale plan. Typed errors keep these outcomes
 * distinct for callers. Only atomic redemption permits the domain mutation.
 */
export async function execute<TResult>(
  required: {
    deps: GatewayDeps;
    principalId: string;
    principalKind: PrincipalKind;
    hooks: GatedMutationHooks<unknown, TResult>;
    confirmationToken: string;
  },
  _optional: Record<string, never> = {}
): Promise<TResult> {
  // Reevaluate authorization here; confirm-time permission is not authority to execute later.
  const { deps, principalId, principalKind, hooks, confirmationToken } = required;
  const authResult = await authorizeForHooks({ deps, hooks, principalId, permission: hooks.mutatePermission });
  if (!authResult.allowed) {
    throw new ForbiddenError({ message: `principal '${principalId}' is not authorized for '${hooks.mutatePermission}' (${authResult.reason})`, reasonCode: "NOT_AUTHORIZED" });
  }
  const record = await deps.tokens.findByToken({ token: confirmationToken });
  if (!record) {
    throw new TokenExpiredError({ message: `confirmation token was not found` });
  }
  if (!isRedeemable({ record, now: nowIso({ clock: deps.clock }) })) {
    if (record.status === "redeemed") {
      throw new TokenAlreadyRedeemedError({ message: `confirmation token has already been redeemed` });
    }
    throw new TokenExpiredError({ message: `confirmation token has expired` });
  }
  const resolvedIdentity = await hooks.resolveActorClassIdentity({ principalId, principalKind });
  if (resolvedIdentity !== record.confirmerPrincipalId) {
    throw new ForbiddenError({ message: `principal '${principalId}' (kind '${principalKind}') is not the confirmer of this token`, reasonCode: "ACTOR_CLASS_MISMATCH" });
  }

  if (record.scopeId !== hooks.scopeId) {
    throw new ForbiddenError({ message: `confirmation token belongs to a different scope`, reasonCode: "SCOPE_MISMATCH" });
  }
  // Retain these verified details through redemption so application cannot choose a new plan.
  const { planHash, details } = await hooks.computePlan({});
  if (planHash !== record.planHash) {
    throw new PlanStaleError({
      message: `the plan backing this confirmation has changed since it was confirmed; re-plan and re-confirm`
    });
  }
  // Concurrent executions can pass every earlier check; atomic redemption makes the loser fail
  // before its domain mutation, preventing a second application of the same approval.
  const { redeemed, record: latestRecord } = await deps.tokens.tryRedeem({ token: confirmationToken, now: nowIso({ clock: deps.clock }) });
  if (!redeemed) {
    if (!latestRecord || latestRecord.status !== "redeemed") throw new TokenExpiredError({ message: `confirmation token has expired` });
    throw new TokenAlreadyRedeemedError({ message: `confirmation token has already been redeemed` });
  }

  return hooks.executeMutation({ planHash, details });
}
