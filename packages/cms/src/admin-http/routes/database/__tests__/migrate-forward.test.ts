import { ForbiddenError, PlanStaleError, TokenAlreadyRedeemedError, TokenExpiredError } from "@jini-ai/core/gated-mutations";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { describe, expect, it, vi } from "vitest";

import {
  databaseMigrateForwardConfirmRoute, databaseMigrateForwardExecuteRoute, databaseMigrateForwardPlanRoute,
  type DatabaseMigrateForwardConfirmRouteDeps, type DatabaseMigrateForwardExecuteRouteDeps, type DatabaseMigrateForwardPlanRouteDeps,
  type MigrateForwardErrorClasses,
} from "../migrate-forward.js";

class RestorePointUnavailable extends Error {}
class MigrationInFlight extends Error {}
const errors: MigrateForwardErrorClasses = { restorePointUnavailable: RestorePointUnavailable, migrationInFlight: MigrationInFlight };
const MISSING = "host: no principal on the request";
const ctx = { id: "owner-1" };
const raw = (body: unknown) => ({ body, query: {}, params: {} });

async function refusalOf(run: () => unknown): Promise<unknown> {
  try { await run(); } catch (err) { if (err instanceof RouteRefusalError) return err.response; throw err; }
  throw new Error("expected a refusal");
}

function planDeps(planMigrateForward: DatabaseMigrateForwardPlanRouteDeps["planMigrateForward"] = async () => ({ planId: "p" })) {
  const spy = vi.fn(planMigrateForward);
  const deps: DatabaseMigrateForwardPlanRouteDeps = { planMigrateForward: spy, migrateForwardErrors: errors, missingPrincipalMessage: MISSING };
  return { deps, spy };
}
function confirmDeps() {
  const confirmMigrateForward = vi.fn<DatabaseMigrateForwardConfirmRouteDeps["confirmMigrateForward"]>(async () => ({ confirmationToken: "tok" }));
  const deps: DatabaseMigrateForwardConfirmRouteDeps = { confirmMigrateForward, migrateForwardErrors: errors, missingPrincipalMessage: MISSING };
  return { deps, confirmMigrateForward };
}
function executeDeps(pre: DatabaseMigrateForwardExecuteRouteDeps["authorizeMigrateForward"] = async () => ({ allowed: true, reason: "owner" })) {
  const authorizeMigrateForward = vi.fn(pre);
  const executeMigrateForward = vi.fn<DatabaseMigrateForwardExecuteRouteDeps["executeMigrateForward"]>(async () => ({ migrated: true }));
  const deps: DatabaseMigrateForwardExecuteRouteDeps = { authorizeMigrateForward, executeMigrateForward, migrateForwardErrors: errors, missingPrincipalMessage: MISSING };
  return { deps, authorizeMigrateForward, executeMigrateForward };
}

describe("database migrate-forward route specs", () => {
  it("keep method, path, success status and body cap byte-identical; parse is total", () => {
    for (const [route, step] of [[databaseMigrateForwardPlanRoute, "plan"], [databaseMigrateForwardConfirmRoute, "confirm"], [databaseMigrateForwardExecuteRoute, "execute"]] as const) {
      expect(route.method).toBe("post");
      expect(route.path).toBe(`/api/admin/v1/database/migrate-forward/${step}`);
      expect(route.successStatus).toBeUndefined();
      expect(route.maxBodyBytes).toBeUndefined();
      expect(route.parse(raw({ a: 1 }))).toEqual({ ok: true, value: { a: 1 } });
    }
  });

  it("plan answers the gateway plan for the session principal", async () => {
    const { deps, spy } = planDeps();
    expect(await databaseMigrateForwardPlanRoute.handle({ input: undefined, deps, context: ctx }, {})).toEqual({ ok: true, value: { planId: "p" } });
    expect(spy.mock.calls).toEqual([[{ principalId: "owner-1" }]]);
  });

  it("confirm answers only the confirmation token", async () => {
    const { deps, confirmMigrateForward } = confirmDeps();
    confirmMigrateForward.mockResolvedValueOnce({ confirmationToken: "tok", extra: "hidden" } as never);
    expect(await databaseMigrateForwardConfirmRoute.handle({ input: { planId: "p", planHash: "h" }, deps, context: ctx }, {})).toEqual({ ok: true, value: { confirmationToken: "tok" } });
    expect(confirmMigrateForward.mock.calls).toEqual([[{ principalId: "owner-1", planId: "p", planHash: "h" }]]);
  });

  it.each([undefined, { planId: "p" }, { planId: "p", planHash: 2 }])("confirm refuses body %j with the flat 400", async (body) => {
    const { deps, confirmMigrateForward } = confirmDeps();
    expect(await refusalOf(() => databaseMigrateForwardConfirmRoute.handle({ input: body, deps, context: ctx }, {})))
      .toEqual({ status: 400, body: { error: "'planId' and 'planHash' (strings) are required", code: "VALIDATION_ERROR" } });
    expect(confirmMigrateForward).not.toHaveBeenCalled();
  });

  it("execute pre-authorizes database.migrate, then executes with the token", async () => {
    const { deps, authorizeMigrateForward, executeMigrateForward } = executeDeps();
    expect(await databaseMigrateForwardExecuteRoute.handle({ input: { confirmationToken: "tok" }, deps, context: ctx }, {})).toEqual({ ok: true, value: { migrated: true } });
    expect(authorizeMigrateForward.mock.calls).toEqual([[{ principalId: "owner-1", permission: "database.migrate" }]]);
    expect(executeMigrateForward.mock.calls).toEqual([[{ principalId: "owner-1", confirmationToken: "tok" }]]);
  });

  it("AUD-001: execute refuses an unauthorized principal 403 FORBIDDEN before the body or any execution", async () => {
    const { deps, executeMigrateForward } = executeDeps(async () => ({ allowed: false, reason: "no grant" }));
    expect(await refusalOf(() => databaseMigrateForwardExecuteRoute.handle({ input: undefined, deps, context: ctx }, {}))).toEqual({
      status: 403,
      body: { error: "principal 'owner-1' is not authorized for 'database.migrate' (no grant)", code: "FORBIDDEN", details: { permission: "database.migrate", reason: "no grant" } },
    });
    expect(executeMigrateForward).not.toHaveBeenCalled();
  });

  it("execute refuses a missing token with the flat 400 after authorizing", async () => {
    const { deps, executeMigrateForward } = executeDeps();
    expect(await refusalOf(() => databaseMigrateForwardExecuteRoute.handle({ input: {}, deps, context: ctx }, {})))
      .toEqual({ status: 400, body: { error: "'confirmationToken' (string) is required", code: "VALIDATION_ERROR" } });
    expect(executeMigrateForward).not.toHaveBeenCalled();
  });

  it.each([
    ["ForbiddenError", new ForbiddenError({ message: "nope", reasonCode: "AGENT_CANNOT_CONFIRM" }), 403, "AGENT_CANNOT_CONFIRM"],
    ["PlanStaleError", new PlanStaleError({ message: "stale plan" }), 409, "PLAN_STALE"],
    ["TokenExpiredError", new TokenExpiredError({ message: "expired" }), 409, "TOKEN_EXPIRED"],
    ["TokenAlreadyRedeemedError", new TokenAlreadyRedeemedError({ message: "redeemed" }), 409, "TOKEN_ALREADY_REDEEMED"],
    ["restore point unavailable", new RestorePointUnavailable("no backup"), 409, "RESTORE_POINT_UNAVAILABLE"],
    ["migration in flight", new MigrationInFlight("busy"), 409, "OPERATION_IN_FLIGHT"],
  ])("maps %s (from any step, including the pre-check) to its status and code", async (_name, err, status, code) => {
    const { deps } = executeDeps(async () => { throw err; });
    expect(await refusalOf(() => databaseMigrateForwardExecuteRoute.handle({ input: { confirmationToken: "t" }, deps, context: ctx }, {})))
      .toEqual({ status, body: { error: err.message, code } });
    const plan = planDeps(async () => { throw err; });
    expect(await refusalOf(() => databaseMigrateForwardPlanRoute.handle({ input: undefined, deps: plan.deps, context: ctx }, {})))
      .toEqual({ status, body: { error: err.message, code } });
  });

  it("rethrows an unmapped error unchanged (the host's redacted 500)", async () => {
    const boom = new Error("migration context password=X");
    const { deps } = planDeps(async () => { throw boom; });
    await expect(Promise.resolve(databaseMigrateForwardPlanRoute.handle({ input: undefined, deps, context: ctx }, {}))).rejects.toBe(boom);
  });

  it("fails closed with the host's missing-session diagnosis on every step", async () => {
    const plan = planDeps();
    await expect(Promise.resolve(databaseMigrateForwardPlanRoute.handle({ input: undefined, deps: plan.deps }, {}))).rejects.toThrow(MISSING);
    await expect(Promise.resolve(databaseMigrateForwardConfirmRoute.handle({ input: {}, deps: confirmDeps().deps }, {}))).rejects.toThrow(MISSING);
    const exec = executeDeps();
    await expect(Promise.resolve(databaseMigrateForwardExecuteRoute.handle({ input: {}, deps: exec.deps }, {}))).rejects.toThrow(MISSING);
    expect(exec.authorizeMigrateForward).not.toHaveBeenCalled();
    expect(plan.spy).not.toHaveBeenCalled();
  });
});
