import { describe, expect, it } from "vitest";
import { ForbiddenError, PlanStaleError } from "@jini-ai/core/gated-mutations";
import { taxonomyMergeConfirmRoute, type TaxonomyMergeConfirmRouteDeps } from "../merge-confirm.js";
import { failingAuthorize, MERGE_PRINCIPAL, mergeRaw, refusalOf } from "./merge-helpers.js";

function confirmDeps(overrides: Partial<TaxonomyMergeConfirmRouteDeps> = {}): TaxonomyMergeConfirmRouteDeps & { gatewayCalls: unknown[] } {
  const gatewayCalls: unknown[] = [];
  return { gatewayCalls, gatewayConfirm: async (required) => { gatewayCalls.push(required); return { token: "token-1" }; }, ...overrides };
}

const run = (deps: TaxonomyMergeConfirmRouteDeps) =>
  taxonomyMergeConfirmRoute.handle({ input: { planId: "plan-1", planHash: "hash-1" }, deps, context: MERGE_PRINCIPAL, authorize: failingAuthorize });

describe("taxonomyMergeConfirmRoute", () => {
  it("pins method, path, success status and body cap", () => {
    expect([taxonomyMergeConfirmRoute.method, taxonomyMergeConfirmRoute.path]).toEqual(["post", "/api/admin/v1/taxonomy/terms/:id/merge/confirm"]);
    expect(taxonomyMergeConfirmRoute.successStatus).toBeUndefined();
    expect(taxonomyMergeConfirmRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses planId and planHash from the body", () => {
    expect(taxonomyMergeConfirmRoute.parse(mergeRaw({ body: { planId: "plan-1", planHash: "hash-1" } }))).toEqual({ ok: true, value: { planId: "plan-1", planHash: "hash-1" } });
  });

  it("refuses a missing or non-string field with 400 VALIDATION_ERROR", async () => {
    for (const body of [undefined, null, {}, { planId: "plan-1" }, { planHash: "h" }, { planId: 1, planHash: "h" }]) {
      expect(await refusalOf(() => taxonomyMergeConfirmRoute.parse(mergeRaw({ body })))).toEqual({
        status: 400, body: { error: "'planId' and 'planHash' (strings) are required", code: "VALIDATION_ERROR" },
      });
    }
  });

  it("confirms as the principal and answers { confirmationToken }", async () => {
    const deps = confirmDeps();
    expect(await run(deps)).toEqual({ ok: true, value: { confirmationToken: "token-1" } });
    expect(deps.gatewayCalls).toEqual([{ principalId: "operator", principalKind: "user", planId: "plan-1", planHash: "hash-1" }]);
  });

  it("maps classified gateway errors and rethrows an unmapped one", async () => {
    expect(await refusalOf(() => run(confirmDeps({ gatewayConfirm: async () => { throw new ForbiddenError({ message: "agents cannot confirm", reasonCode: "AGENT_CANNOT_CONFIRM" }); } }))))
      .toEqual({ status: 403, body: { error: "agents cannot confirm", code: "AGENT_CANNOT_CONFIRM" } });
    expect(await refusalOf(() => run(confirmDeps({ gatewayConfirm: async () => { throw new PlanStaleError({ message: "stale" }); } }))))
      .toEqual({ status: 409, body: { error: "stale", code: "PLAN_STALE" } });
    await expect(run(confirmDeps({ gatewayConfirm: async () => { throw new Error("db offline"); } }))).rejects.toThrow("db offline");
  });

  it("fails closed without an authenticated principal", async () => {
    await expect(taxonomyMergeConfirmRoute.handle({ input: { planId: "p", planHash: "h" }, deps: confirmDeps(), context: undefined, authorize: failingAuthorize }))
      .rejects.toThrow(/no authenticated principal/);
  });
});
