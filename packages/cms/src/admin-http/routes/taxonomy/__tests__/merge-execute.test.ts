import { describe, expect, it } from "vitest";
import { ForbiddenError, PlanStaleError, TokenAlreadyRedeemedError, TokenExpiredError } from "@jini-ai/core/gated-mutations";
import { taxonomyMergeExecuteRoute, type TaxonomyMergeExecuteRouteDeps } from "../merge-execute.js";
import { failingAuthorize, MERGE_PRINCIPAL, mergeRaw, refusalOf } from "./merge-helpers.js";

function executeDeps(overrides: Partial<TaxonomyMergeExecuteRouteDeps> = {}): TaxonomyMergeExecuteRouteDeps & { gatewayCalls: unknown[] } {
  const gatewayCalls: unknown[] = [];
  return { gatewayCalls, gatewayExecute: async (required) => { gatewayCalls.push(required); return { mergedCount: 3 }; }, ...overrides };
}

const input = { fromTermId: "term-1", intoTermId: "term-2", confirmationToken: "token-1" };
const run = (deps: TaxonomyMergeExecuteRouteDeps) =>
  taxonomyMergeExecuteRoute.handle({ input, deps, context: MERGE_PRINCIPAL, authorize: failingAuthorize });

describe("taxonomyMergeExecuteRoute", () => {
  it("pins method, path, success status and body cap", () => {
    expect([taxonomyMergeExecuteRoute.method, taxonomyMergeExecuteRoute.path]).toEqual(["post", "/api/admin/v1/taxonomy/terms/:id/merge/execute"]);
    expect(taxonomyMergeExecuteRoute.successStatus).toBeUndefined();
    expect(taxonomyMergeExecuteRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses :id plus intoTermId and confirmationToken from the body", () => {
    expect(taxonomyMergeExecuteRoute.parse(mergeRaw({ body: { intoTermId: "term-2", confirmationToken: "token-1" } }))).toEqual({ ok: true, value: input });
  });

  it("refuses a missing or non-string field with 400 VALIDATION_ERROR", async () => {
    for (const body of [undefined, null, {}, { intoTermId: "term-2" }, { confirmationToken: "t" }, { intoTermId: "t", confirmationToken: 5 }]) {
      expect(await refusalOf(() => taxonomyMergeExecuteRoute.parse(mergeRaw({ body })))).toEqual({
        status: 400, body: { error: "'intoTermId' and 'confirmationToken' (strings) are required", code: "VALIDATION_ERROR" },
      });
    }
  });

  it("executes as the principal, never calling the host authorize port", async () => {
    const deps = executeDeps();
    expect(await run(deps)).toEqual({ ok: true, value: { mergedCount: 3 } });
    expect(deps.gatewayCalls).toEqual([{ principalId: "operator", principalKind: "user", ...input }]);
  });

  it("maps each classified gateway error to its exact status and code", async () => {
    const cases: Array<[Error, number, string]> = [
      [new ForbiddenError({ message: "not allowed", reasonCode: "ACTOR_CLASS_MISMATCH" }), 403, "ACTOR_CLASS_MISMATCH"],
      [new PlanStaleError({ message: "stale" }), 409, "PLAN_STALE"],
      [new TokenExpiredError({ message: "expired" }), 409, "TOKEN_EXPIRED"],
      [new TokenAlreadyRedeemedError({ message: "redeemed" }), 409, "TOKEN_ALREADY_REDEEMED"],
    ];
    for (const [error, status, code] of cases) {
      expect(await refusalOf(() => run(executeDeps({ gatewayExecute: async () => { throw error; } })))).toEqual({ status, body: { error: error.message, code } });
    }
  });

  it("rethrows an unmapped error unchanged for the host's 500", async () => {
    await expect(run(executeDeps({ gatewayExecute: async () => { throw new Error("db offline"); } }))).rejects.toThrow("db offline");
  });

  it("fails closed without an authenticated principal", async () => {
    await expect(taxonomyMergeExecuteRoute.handle({ input, deps: executeDeps(), context: undefined, authorize: failingAuthorize })).rejects.toThrow(/no authenticated principal/);
  });
});
