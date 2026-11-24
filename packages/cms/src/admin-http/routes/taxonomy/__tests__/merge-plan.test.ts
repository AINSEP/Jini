import { describe, expect, it } from "vitest";
import { ForbiddenError, PlanStaleError, TokenAlreadyRedeemedError, TokenExpiredError } from "@jini-ai/core/gated-mutations";
import { SameTermMergeError } from "../../../../taxonomy/index.js";
import { taxonomyMergePlanRoute, type TaxonomyMergePlanRouteDeps } from "../merge-plan.js";
import { failingAuthorize, MERGE_PRINCIPAL, mergeRaw, refusalOf } from "./merge-helpers.js";

function planDeps(overrides: Partial<TaxonomyMergePlanRouteDeps> = {}): TaxonomyMergePlanRouteDeps & { overlapCalls: unknown[]; gatewayCalls: unknown[] } {
  const overlapCalls: unknown[] = [];
  const gatewayCalls: unknown[] = [];
  return {
    overlapCalls,
    gatewayCalls,
    entryTermRepo: { countOverlap: async (params) => { overlapCalls.push(params); return 2; } },
    gatewayPlan: async (required) => { gatewayCalls.push(required); return { planId: "plan-1", planHash: "hash-1", details: { gateway: true } }; },
    ...overrides,
  };
}

const run = (deps: TaxonomyMergePlanRouteDeps, input = { fromTermId: "term-1", intoTermId: "term-2" }) =>
  taxonomyMergePlanRoute.handle({ input, deps, context: MERGE_PRINCIPAL, authorize: failingAuthorize });

describe("taxonomyMergePlanRoute", () => {
  it("pins method, path, success status and body cap", () => {
    expect([taxonomyMergePlanRoute.method, taxonomyMergePlanRoute.path]).toEqual(["post", "/api/admin/v1/taxonomy/terms/:id/merge/plan"]);
    expect(taxonomyMergePlanRoute.successStatus).toBeUndefined();
    expect(taxonomyMergePlanRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses :id as the source term and the body's intoTermId", () => {
    expect(taxonomyMergePlanRoute.parse(mergeRaw({ body: { intoTermId: "term-2" } }))).toEqual({ ok: true, value: { fromTermId: "term-1", intoTermId: "term-2" } });
  });

  it("refuses a missing, non-string or absent body with 400 VALIDATION_ERROR", async () => {
    for (const body of [undefined, null, {}, { intoTermId: 7 }]) {
      expect(await refusalOf(() => taxonomyMergePlanRoute.parse(mergeRaw({ body })))).toEqual({
        status: 400, body: { error: "'intoTermId' (string) is required", code: "VALIDATION_ERROR" },
      });
    }
  });

  it("counts the overlap, hands the gateway its principal and answers the gateway's plan", async () => {
    const deps = planDeps();
    expect(await run(deps)).toEqual({ ok: true, value: { planId: "plan-1", planHash: "hash-1", details: { gateway: true } } });
    expect(deps.overlapCalls).toEqual([{ fromTermId: "term-1", intoTermId: "term-2" }]);
    expect(deps.gatewayCalls).toEqual([{ principalId: "operator", principalKind: "user", fromTermId: "term-1", intoTermId: "term-2" }]);
  });

  it("falls back to the locally computed details when the gateway returns none", async () => {
    const deps = planDeps({ gatewayPlan: async () => ({ planId: "p", planHash: "h", details: undefined }) });
    expect(await run(deps)).toEqual({ ok: true, value: { planId: "p", planHash: "h", details: {
      fromTermId: "term-1", intoTermId: "term-2", overlapLossDisclosed: true, overlappingContentCount: 2,
    } } });
  });

  it("refuses a self-merge 400 SAME_TERM_MERGE before counting or calling the gateway", async () => {
    const deps = planDeps();
    expect(await refusalOf(() => run(deps, { fromTermId: "term-1", intoTermId: "term-1" }))).toEqual({
      status: 400, body: { error: "cannot merge term 'term-1' into itself", code: "SAME_TERM_MERGE" },
    });
    expect([deps.overlapCalls, deps.gatewayCalls]).toEqual([[], []]);
  });

  it("maps each classified gateway error to its exact status and code, in ladder order", async () => {
    const cases: Array<[Error, number, string]> = [
      [new ForbiddenError({ message: "not allowed", reasonCode: "NOT_AUTHORIZED" }), 403, "NOT_AUTHORIZED"],
      [new PlanStaleError({ message: "stale" }), 409, "PLAN_STALE"],
      [new TokenExpiredError({ message: "expired" } as never), 409, "TOKEN_EXPIRED"],
      [new TokenAlreadyRedeemedError({ message: "redeemed" } as never), 409, "TOKEN_ALREADY_REDEEMED"],
      [new SameTermMergeError({ message: "same" }), 400, "SAME_TERM_MERGE"],
    ];
    for (const [error, status, code] of cases) {
      expect(await refusalOf(() => run(planDeps({ gatewayPlan: async () => { throw error; } })))).toEqual({ status, body: { error: error.message, code } });
    }
  });

  it("rethrows an unmapped error unchanged for the host's 500", async () => {
    await expect(run(planDeps({ gatewayPlan: async () => { throw new Error("db offline"); } }))).rejects.toThrow("db offline");
    await expect(run(planDeps({ gatewayPlan: async () => { throw "storage offline"; } }))).rejects.toBe("storage offline");
  });

  it("fails closed without an authenticated principal", async () => {
    await expect(taxonomyMergePlanRoute.handle({ input: { fromTermId: "a", intoTermId: "b" }, deps: planDeps(), context: undefined, authorize: failingAuthorize }))
      .rejects.toThrow(/no authenticated principal/);
  });
});
