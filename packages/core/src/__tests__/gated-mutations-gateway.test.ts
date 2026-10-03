import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ForbiddenError,
  PlanStaleError,
  UnauthenticatedError,
  confirm,
  execute,
  plan,
} from "../gated-mutations/gateway.js";
import { InMemoryTokenStore, TokenAlreadyRedeemedError, TokenExpiredError, isRedeemable, mintToken } from "../gated-mutations/token.js";
import type { AuthorizeFn, PrincipalKind } from "../gated-mutations/ports.js";

const NOW = "2026-07-15T00:00:00.000Z";
const clock = { nowMs: () => Date.parse(NOW) };
function counterIdGen() {
  let n = 0;
  return { newId: () => `id-${++n}` };
}

function alwaysAllow(): AuthorizeFn {
  return async () => ({ allowed: true, reason: "matched" });
}
function alwaysDeny(reason = "no_grant"): AuthorizeFn {
  return async () => ({ allowed: false, reason });
}

function makeHooks(overrides: Partial<Record<string, unknown>> = {}) {
  let mutationRuns = 0;
  return {
    domain: "database.migrate",
    readPermission: "database.read",
    mutatePermission: "database.migrate",
    scopeId: "workspace-1",
    async computePlan() {
      return { planHash: "sha256:" + "1".repeat(64), details: { preview: true } };
    },
    async executeMutation() {
      mutationRuns += 1;
      return { migrated: true };
    },
    async resolveActorClassIdentity({ principalId }: { principalId: string; principalKind: PrincipalKind }) {
      return principalId;
    },
    get mutationRuns() {
      return mutationRuns;
    },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    clock,
    idGen: counterIdGen(),
    ttlSeconds: 600,
    generateToken: () => "confirmation-token",
    authorize: alwaysAllow(),
    tokens: new InMemoryTokenStore({}),
    ...overrides,
  };
}

test('expiry after plan derivation wins at atomic redemption and the mutation never runs', async () => {
  let now = NOW;
  const { tokens, record } = await mintValidToken();
  const hooks = makeHooks({
    async computePlan() { now = '2026-07-15T00:10:01.000Z'; return { planHash: record.planHash, details: {} }; },
  });
  const deps = makeDeps({ tokens, clock: { nowMs: () => Date.parse(now) } });
  await assert.rejects(execute({ deps, principalId: 'u-1', principalKind: 'user', hooks, confirmationToken: record.confirmationToken }), TokenExpiredError);
  assert.equal(hooks.mutationRuns, 0);
  assert.equal((await tokens.findByToken({ token: record.confirmationToken }))?.status, 'minted');
});

test('mutation failure consumes the approved token and replay cannot repeat the mutation', async () => {
  const { tokens, record } = await mintValidToken();
  const failure = new Error('mutation failed');
  let runs = 0;
  const hooks = makeHooks({ async executeMutation() { runs += 1; throw failure; } });
  const args = { deps: makeDeps({ tokens }), principalId: 'u-1', principalKind: 'user' as const, hooks, confirmationToken: record.confirmationToken };
  await assert.rejects(execute(args), error => error === failure);
  await assert.rejects(execute(args), TokenAlreadyRedeemedError);
  assert.equal(runs, 1);
});

// ---------------------------------------------------------------------------
// plan —. See docs/decisions/DR-001-gated-mutation-check-order.md.
// ---------------------------------------------------------------------------

test("AC-10: plan() succeeds for a principal holding only {domain}.read and produces no state change", async () => {
  const hooks = makeHooks();
  const deps = makeDeps({
    authorize: (async ({ permission }) => ({ allowed: permission === hooks.readPermission, reason: "read_only" })) as AuthorizeFn,
  });

  const result = await plan({ deps, principalId: "u-1", principalKind: "user", hooks });

  assert.equal(result.domain, "database.migrate");
  assert.ok(result.planId);
  assert.ok(result.planHash);
  assert.equal(result.planHash, "sha256:" + "1".repeat(64));
  assert.equal(hooks.mutationRuns, 0, "plan() must never invoke the domain mutation");
  assert.equal(await deps.tokens.count({}), 0, "plan() must not mint a confirmation token");
});

test("AC-11: plan() returns an identical planHash for user, agent, and api_key principal kinds holding the same permission", async () => {
  const hooks = makeHooks();
  const deps = makeDeps();

  const userPlan = await plan({ deps, principalId: "u-1", principalKind: "user", hooks });
  const agentPlan = await plan({ deps, principalId: "a-1", principalKind: "agent", hooks });
  const apiKeyPlan = await plan({ deps, principalId: "k-1", principalKind: "api_key", hooks });

  assert.equal(userPlan.planHash, agentPlan.planHash);
  assert.equal(userPlan.planHash, apiKeyPlan.planHash);
  // planId/details are explicitly NOT required to be identical ( own carve-out). See docs/decisions/DR-001-gated-mutation-check-order.md.
});

test("AC-09: plan() rejects when the caller lacks {domain}.read", async () => {
  const hooks = makeHooks();
  const deps = makeDeps({ authorize: alwaysDeny() });

  await assert.rejects(
    plan({ deps, principalId: "u-1", principalKind: "user", hooks }),
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenError);
      return true;
    }
  );
});

test("architectural guard (AC-09): gateway.ts exposes no direct single-call mutation entry point beyond plan/confirm/execute", async () => {
  const gatewayModule = await import("../gated-mutations/gateway.js");
  assert.deepEqual(Object.keys(gatewayModule).sort(), [
    "ForbiddenError", "PlanStaleError", "UnauthenticatedError", "authorizeForHooks", "confirm", "execute", "plan",
  ], "new runtime exports must be reviewed for a direct mutation entry point");
});

// ---------------------------------------------------------------------------
// confirm —. See docs/decisions/DR-001-gated-mutation-check-order.md.
// ---------------------------------------------------------------------------

test("AC-12: an agent principal calling confirm() is rejected regardless of any permission it holds", async () => {
  const hooks = makeHooks();
  const deps = makeDeps({ authorize: alwaysAllow() }); // agent DOES hold permission — must still be rejected

  await assert.rejects(
    confirm({ deps, principalId: "agent-1", principalKind: "agent", hooks, planId: "p1", planHash: "sha256:" + "1".repeat(64) }),
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenError);
      return true;
    }
  );
});

test("AC-13 / INV-04: a user lacking the gated mutation's permission calling confirm() is rejected and no token is minted", async () => {
  const hooks = makeHooks();
  const tokens = new InMemoryTokenStore({});
  const deps = makeDeps({ authorize: alwaysDeny(), tokens });

  await assert.rejects(
    confirm({ deps, principalId: "u-1", principalKind: "user", hooks, planId: "p1", planHash: "sha256:" + "1".repeat(64) }),
    (err: unknown) => err instanceof ForbiddenError
  );

  assert.equal(await tokens.count({}), 0, "INV-04: no token may exist for a principal that failed authorize() at mint time");
});

test("AC-14: an authorized user's confirm() mints a token with exactly a 600-second TTL bound to (planHash, scopeId, confirmerPrincipalId)", async () => {
  const hooks = makeHooks();
  const deps = makeDeps();
  const planHash = "sha256:" + "1".repeat(64);

  const token = await confirm({ deps, principalId: "u-1", principalKind: "user", hooks, planId: "p1", planHash });

  assert.equal(token.expiresAt, "2026-07-15T00:10:00.000Z");
  assert.equal(token.planHash, planHash);
  assert.equal(token.scopeId, "workspace-1");
  assert.equal(token.confirmerPrincipalId, "u-1");
});

test("AC-14: a confirmed token cannot execute in another scope with the same principal and plan hash", async () => {
  const hooks = makeHooks();
  const deps = makeDeps();
  const token = await confirm({ deps, principalId: "u-1", principalKind: "user", hooks, planId: "p1", planHash: "sha256:" + "1".repeat(64) });
  const otherScopeHooks = makeHooks({ scopeId: "workspace-2" });

  await assert.rejects(
    execute({ deps, principalId: "u-1", principalKind: "user", hooks: otherScopeHooks, confirmationToken: token.confirmationToken }),
    (err: unknown) => err instanceof ForbiddenError && err.reasonCode === "SCOPE_MISMATCH"
  );
  assert.equal(otherScopeHooks.mutationRuns, 0);
  assert.equal((await deps.tokens.findByToken({ token: token.confirmationToken }))?.status, "minted");
});

// ---------------------------------------------------------------------------
// execute — fixed check-sequence,. See docs/decisions/DR-001-gated-mutation-check-order.md.
// ---------------------------------------------------------------------------

async function mintValidToken(overrides: Partial<Record<string, unknown>> = {}) {
  const tokens = new InMemoryTokenStore({});
  const record = mintToken({
    planId: "p1",
    planHash: "sha256:" + "1".repeat(64),
    scopeId: "workspace-1",
    confirmerPrincipalId: "u-1",
    now: NOW,
    ttlSeconds: 600,
    generateToken: () => "confirmation-token",
    ...overrides,
  });
  await tokens.save({ record: record });
  return { tokens, record };
}

test("AC-15 / U-001-B1 / U-001-ORD1: authorize() is evaluated fresh before the token expiry/redemption-state check — an unauthorized caller with an independently-expired token sees FORBIDDEN, never TOKEN_EXPIRED", async () => {
  const { tokens, record } = await mintValidToken();
  const hooks = makeHooks();
  const expiredNow = "2026-07-15T00:10:01.000Z";
  assert.equal(isRedeemable({ record, now: expiredNow }), false, "the token is independently expired");
  const deps = makeDeps({ authorize: alwaysDeny("revoked"), tokens, clock: { nowMs: () => Date.parse(expiredNow) } });

  await assert.rejects(
    execute({
      deps,
      principalId: "u-1",
      principalKind: "user",
      hooks,
      confirmationToken: record.confirmationToken,
    }),
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenError, "must be FORBIDDEN, never TOKEN_EXPIRED, when authorize() denies");
      assert.ok(!(err instanceof TokenExpiredError));
      return true;
    }
  );
  assert.equal(hooks.mutationRuns, 0);
});

test("U-001-ORD2: the token expiry/redemption-state check completes before the actor-class rule — an already-redeemed token from an actor-class-mismatched caller reports TOKEN_ALREADY_REDEEMED, not FORBIDDEN", async () => {
  const { tokens, record } = await mintValidToken({ confirmerPrincipalId: "u-1" });
  // Pre-redeem the token so the token-state check must fail first.
  await tokens.tryRedeem({ token: record.confirmationToken, now: NOW });

  const hooks = makeHooks({
    async resolveActorClassIdentity() {
      return "someone-else"; // would ALSO fail the actor-class rule if reached
    },
  });
  const deps = makeDeps({ tokens });

  await assert.rejects(
    execute({ deps, principalId: "u-2", principalKind: "user", hooks, confirmationToken: record.confirmationToken }),
    (err: unknown) => {
      assert.ok(err instanceof TokenAlreadyRedeemedError, "token-state failure must be reported before the actor-class rule runs");
      return true;
    }
  );
  assert.equal(hooks.mutationRuns, 0);
});

test("AC-18 / EC-08: a user redeeming a token minted by a different user is rejected with FORBIDDEN/ACTOR_CLASS_MISMATCH", async () => {
  const { tokens, record } = await mintValidToken({ confirmerPrincipalId: "u-1" });
  const hooks = makeHooks(); // default resolveActorClassIdentity returns the calling principalId itself
  const deps = makeDeps({ tokens });

  await assert.rejects(
    execute({ deps, principalId: "u-2", principalKind: "user", hooks, confirmationToken: record.confirmationToken }),
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenError);
      assert.equal((err as ForbiddenError).reasonCode, "ACTOR_CLASS_MISMATCH");
      return true;
    }
  );
  assert.equal(hooks.mutationRuns, 0);
});

test("AC-19 / EC-07: an agent redeeming a token whose confirmerPrincipalId is not its current delegatedBy is rejected", async () => {
  const { tokens, record } = await mintValidToken({ confirmerPrincipalId: "u-1" });
  const hooks = makeHooks({
    async resolveActorClassIdentity() {
      return "u-999"; // agent's real current delegator — does not match the token's confirmer
    },
  });
  const deps = makeDeps({ tokens });

  await assert.rejects(
    execute({ deps, principalId: "agent-1", principalKind: "agent", hooks, confirmationToken: record.confirmationToken }),
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenError);
      assert.equal((err as ForbiddenError).reasonCode, "ACTOR_CLASS_MISMATCH");
      return true;
    }
  );
  assert.equal(hooks.mutationRuns, 0);
});

test("AC-20: an agent redeeming a token whose confirmerPrincipalId equals its current delegatedBy succeeds", async () => {
  const { tokens, record } = await mintValidToken({ confirmerPrincipalId: "u-1" });
  const hooks = makeHooks({
    async resolveActorClassIdentity() {
      return "u-1"; // matches the token's confirmer
    },
  });
  const deps = makeDeps({ tokens });

  const result = await execute({ deps, principalId: "agent-1", principalKind: "agent", hooks, confirmationToken: record.confirmationToken });
  assert.deepEqual(result, { migrated: true });
  assert.equal(hooks.mutationRuns, 1);
});

test("AC-16 / AC-17 / U-001-B3: a recomputed plan hash mismatch rejects with PLAN_STALE before any mutation runs", async () => {
  const { tokens, record } = await mintValidToken({ planHash: "sha256:" + "1".repeat(64) });
  const hooks = makeHooks({
    async computePlan() {
      return { planHash: "sha256:" + "2".repeat(64), details: {} }; // drifted since plan()/confirm()
    },
  });
  const deps = makeDeps({ tokens });

  await assert.rejects(
    execute({ deps, principalId: "u-1", principalKind: "user", hooks, confirmationToken: record.confirmationToken }),
    (err: unknown) => {
      assert.ok(err instanceof PlanStaleError);
      return true;
    }
  );
  assert.equal(hooks.mutationRuns, 0, "PLAN_STALE must reject before any durable mutation is applied");
});

test("AC-38 / U-001-B2 / U-001-ORD3: actor-class mismatch AND a stale plan together report FORBIDDEN, never PLAN_STALE", async () => {
  const { tokens, record } = await mintValidToken({ confirmerPrincipalId: "u-1", planHash: "sha256:" + "1".repeat(64) });
  const hooks = makeHooks({
    async computePlan() {
      return { planHash: "sha256:" + "9".repeat(64), details: {} }; // ALSO stale
    },
  });
  const deps = makeDeps({ tokens });

  await assert.rejects(
    // u-2 never confirmed this token (actor-class mismatch) AND the plan has independently drifted
    execute({ deps, principalId: "u-2", principalKind: "user", hooks, confirmationToken: record.confirmationToken }),
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenError, "actor-class rule must win — never PLAN_STALE — when both conditions hold");
      assert.ok(!(err instanceof PlanStaleError));
      assert.equal((err as ForbiddenError).reasonCode, "ACTOR_CLASS_MISMATCH");
      return true;
    }
  );
  assert.equal(hooks.mutationRuns, 0);
});

test("REQ-11 / AC-35: execute() with a confirmationToken string never minted by this contract returns TOKEN_EXPIRED, indistinguishable from a genuinely expired token", async () => {
  const hooks = makeHooks();
  const deps = makeDeps();

  await assert.rejects(
    execute({ deps, principalId: "u-1", principalKind: "user", hooks, confirmationToken: "never-issued-garbage" }),
    (err: unknown) => {
      assert.ok(err instanceof TokenExpiredError);
      return true;
    }
  );
  assert.equal(hooks.mutationRuns, 0);
});

test("AC-22 / REQ-15: execute() re-evaluates authorize() fresh, reflecting a delegator permission change since confirm()-time, never a cached confirm-time result", async () => {
  const { tokens, record } = await mintValidToken({ confirmerPrincipalId: "u-1" });
  let authorizeCallCount = 0;
  const hooks = makeHooks({
    async resolveActorClassIdentity() {
      return "u-1";
    },
  });
  const deps = makeDeps({
    tokens,
    authorize: (async () => {
      authorizeCallCount += 1;
      // Simulate a delegator whose grant collapsed since confirm()-time: deny on this fresh call.
      return { allowed: false, reason: "delegator_revoked" };
    }) as AuthorizeFn,
  });

  await assert.rejects(
    execute({ deps, principalId: "u-1", principalKind: "user", hooks, confirmationToken: record.confirmationToken }),
    (err: unknown) => err instanceof ForbiddenError
  );
  assert.equal(authorizeCallCount, 1, "authorize() must be called fresh at execute() time, not skipped/cached from confirm()");
  assert.equal(hooks.mutationRuns, 0, "authorization rejection must precede mutation");
});

test("execute() succeeds exactly once for a valid token satisfying every check, and stamps a single mutation run (INV-03 exactly-once)", async () => {
  const { tokens, record } = await mintValidToken();
  const hooks = makeHooks();
  const deps = makeDeps({ tokens });

  const result = await execute({ deps, principalId: "u-1", principalKind: "user", hooks, confirmationToken: record.confirmationToken });

  assert.deepEqual(result, { migrated: true });
  assert.equal(hooks.mutationRuns, 1);
  assert.equal((await tokens.findByToken({ token: record.confirmationToken }))?.status, "redeemed");
  await assert.rejects(
    execute({ deps, principalId: "u-1", principalKind: "user", hooks, confirmationToken: record.confirmationToken }),
    TokenAlreadyRedeemedError
  );
  assert.equal(hooks.mutationRuns, 1, "replaying the token must not repeat the mutation");
});

test("concurrent execute() calls with one valid token permit exactly one mutation", async () => {
  const { tokens, record } = await mintValidToken();
  const hooks = makeHooks();
  const deps = makeDeps({ tokens });
  const attempts = await Promise.allSettled(Array.from({ length: 5 }, () =>
    execute({ deps, principalId: "u-1", principalKind: "user", hooks, confirmationToken: record.confirmationToken })
  ));
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  const rejected = attempts.filter((attempt) => attempt.status === "rejected");
  assert.equal(rejected.length, 4);
  for (const attempt of rejected) assert.ok(attempt.reason instanceof TokenAlreadyRedeemedError);
  assert.equal(hooks.mutationRuns, 1);
  assert.equal((await tokens.findByToken({ token: record.confirmationToken }))?.status, "redeemed");
});

test("execute() passes the re-derived verified plan hash and details to the mutation", async () => {
  const { tokens, record } = await mintValidToken();
  const verified = { planHash: record.planHash, details: { writes: ["checked-row"] } };
  let received: unknown;
  let planCalls = 0;
  const hooks = makeHooks({
    async computePlan() { planCalls += 1; return verified; },
    async executeMutation(value: unknown) { received = value; return { migrated: true }; },
  });
  await execute({ deps: makeDeps({ tokens }), principalId: "u-1", principalKind: "user", hooks, confirmationToken: record.confirmationToken });
  assert.equal(planCalls, 1);
  assert.deepEqual(received, verified);
});

// ---------------------------------------------------------------------------
// Instance scope (gap closure) — GatedMutationHooks.scopeKind: "instance".
//
// An instance-wide mutation (one whose blast radius crosses every workspace in `content.db` at
// once, e.g. a whole-database migration) has no single owning workspace, so it must never be
// authorized through the ordinary workspace-scoped `deps.authorize` — that would either deny
// every principal (no real workspace matches `hooks.scopeId`) or let a single workspace's admin
// approve a cross-tenant operation (an authorization bypass). These tests prove both directions:
// a principal `deps.authorizeInstance` grants IS approvable, and a workspace-scoped admin (for
// whom `deps.authorize` always allows) is REFUSED — the refusal is the load-bearing case.
// ---------------------------------------------------------------------------

function makeInstanceHooks(overrides: Partial<Record<string, unknown>> = {}) {
  return makeHooks({ scopeKind: "instance", scopeId: "instance", ...overrides });
}

test("instance scope: full plan()->confirm()->execute() ceremony succeeds for a principal authorizeInstance grants, and the workspace-scoped evaluator is never consulted", async () => {
  const hooks = makeInstanceHooks();
  let workspaceAuthorizeCalls = 0;
  const deps = makeDeps({
    authorize: (async () => {
      workspaceAuthorizeCalls += 1;
      return { allowed: true, reason: "matched" };
    }) as AuthorizeFn,
    authorizeInstance: async ({ principalId }: { principalId: string; permission: string }) =>
      principalId === "owner-1" ? { allowed: true, reason: "owner_wildcard" } : { allowed: false, reason: "not_instance_owner" },
  });

  const planResult = await plan({ deps, principalId: "owner-1", principalKind: "user", hooks });
  const token = await confirm({
    deps,
    principalId: "owner-1",
    principalKind: "user",
    hooks,
    planId: planResult.planId,
    planHash: planResult.planHash,
  });
  const result = await execute({ deps, principalId: "owner-1", principalKind: "user", hooks, confirmationToken: token.confirmationToken });

  assert.deepEqual(result, { migrated: true });
  assert.equal(workspaceAuthorizeCalls, 0, "an instance-scoped check must never fall through to the workspace-scoped evaluator");
});

test("instance scope: a workspace-scoped admin (deps.authorize always allows) is REFUSED at plan(), even though it holds the workspace permission", async () => {
  const hooks = makeInstanceHooks();
  const deps = makeDeps({
    authorize: alwaysAllow(), // this principal has full workspace permission — must still be denied
    authorizeInstance: async () => ({ allowed: false, reason: "not_instance_owner" }),
  });

  await assert.rejects(
    plan({ deps, principalId: "workspace-admin-1", principalKind: "user", hooks }),
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenError, "a workspace-scoped grant must never authorize an instance-scoped mutation");
      return true;
    }
  );
});

test("instance scope: a workspace-scoped admin is REFUSED at confirm() too, and no token is minted for it", async () => {
  const hooks = makeInstanceHooks();
  const tokens = new InMemoryTokenStore({});
  const deps = makeDeps({
    authorize: alwaysAllow(),
    authorizeInstance: async () => ({ allowed: false, reason: "not_instance_owner" }),
    tokens,
  });

  await assert.rejects(
    confirm({
      deps,
      principalId: "workspace-admin-1",
      principalKind: "user",
      hooks,
      planId: "p1",
      planHash: "sha256:" + "1".repeat(64),
    }),
    (err: unknown) => err instanceof ForbiddenError
  );
  assert.equal(await tokens.count({}), 0, "no token may exist for a principal authorizeInstance refused");
});

test("instance scope: execute() re-checks the instance evaluator fresh and refuses a workspace-scoped admin even for an otherwise-valid token", async () => {
  const { tokens, record } = await mintValidToken({ scopeId: "instance", confirmerPrincipalId: "workspace-admin-1" });
  const hooks = makeInstanceHooks({
    async resolveActorClassIdentity() {
      return "workspace-admin-1";
    },
  });
  const deps = makeDeps({
    tokens,
    authorize: alwaysAllow(),
    authorizeInstance: async () => ({ allowed: false, reason: "not_instance_owner" }),
  });

  await assert.rejects(
    execute({ deps, principalId: "workspace-admin-1", principalKind: "user", hooks, confirmationToken: record.confirmationToken }),
    (err: unknown) => err instanceof ForbiddenError
  );
});

test("instance scope: fails closed with INSTANCE_AUTHORIZATION_NOT_CONFIGURED when deps.authorizeInstance is not bound at all", async () => {
  const hooks = makeInstanceHooks();
  const deps = makeDeps({ authorize: alwaysAllow() }); // no authorizeInstance — must not fall back to it

  await assert.rejects(
    plan({ deps, principalId: "owner-1", principalKind: "user", hooks }),
    (err: unknown) => {
      assert.ok(err instanceof ForbiddenError);
      assert.match((err as Error).message, /INSTANCE_AUTHORIZATION_NOT_CONFIGURED/);
      return true;
    }
  );
});

test("workspace scope (default, regression guard): omitting scopeKind still routes through deps.authorize with the hooks' scopeId as workspaceId, unaffected by the instance-scope addition", async () => {
  const hooks = makeHooks(); // scopeKind omitted -> "workspace" default
  let capturedWorkspaceId: string | undefined;
  const deps = makeDeps({
    authorize: (async (params: { workspaceId: string }) => {
      capturedWorkspaceId = params.workspaceId;
      return { allowed: true, reason: "matched" };
    }) as AuthorizeFn,
  });

  await plan({ deps, principalId: "u-1", principalKind: "user", hooks });

  assert.equal(capturedWorkspaceId, "workspace-1");
});
