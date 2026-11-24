import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { describe, expect, it, vi } from "vitest";

import {
  recoveryRestoreConfirmRoute, recoveryRestoreExecuteRoute, recoveryRestorePlanRoute,
  type RecoveryCeremonyResult, type RecoveryRestoreConfirmRouteDeps, type RecoveryRestoreExecuteRouteDeps, type RecoveryRestorePlanRouteDeps,
} from "../restore.js";

const MISSING = "host: no principal on the request";
const okResult = <T>(value: T): RecoveryCeremonyResult<T> => ({ ok: true, value });
const errResult = (code: string, message?: string): RecoveryCeremonyResult<never> => ({ ok: false, error: message === undefined ? { code } : { code, message } });

/** The refusal a call threw, as the host's error port would write it. */
async function refusalOf(run: () => unknown): Promise<unknown> {
  try { await run(); } catch (err) { if (err instanceof RouteRefusalError) return err.response; throw err; }
  throw new Error("expected a refusal");
}

function planDeps(result: RecoveryCeremonyResult<unknown> = okResult({ planId: "plan-1" })) {
  const planRestore = vi.fn<RecoveryRestorePlanRouteDeps["planRestore"]>(async () => result);
  const deps: RecoveryRestorePlanRouteDeps = { planRestore, missingPrincipalMessage: MISSING };
  return { deps, planRestore };
}
function confirmDeps(result: RecoveryCeremonyResult<unknown> = okResult({ confirmationToken: "tok" })) {
  const confirmRestore = vi.fn<RecoveryRestoreConfirmRouteDeps["confirmRestore"]>(async () => result);
  const deps: RecoveryRestoreConfirmRouteDeps = { confirmRestore, missingPrincipalMessage: MISSING };
  return { deps, confirmRestore };
}
function executeDeps(allowed = true, result: RecoveryCeremonyResult<unknown> = okResult({ restored: true })) {
  const authorizeRestoreExecution = vi.fn<RecoveryRestoreExecuteRouteDeps["authorizeRestoreExecution"]>(async () => ({ allowed, reason: allowed ? "owner" : "no grant" }));
  const executeRestore = vi.fn<RecoveryRestoreExecuteRouteDeps["executeRestore"]>(async () => result);
  const deps: RecoveryRestoreExecuteRouteDeps = { authorizeRestoreExecution, executeRestore, missingPrincipalMessage: MISSING };
  return { deps, authorizeRestoreExecution, executeRestore };
}

const raw = (body: unknown) => ({ body, query: {}, params: {} });
const ctx = { id: "owner-1" };

describe("recovery restore route specs", () => {
  it("keep method, path, success status and body cap byte-identical; parse is total (auth/principal before 400)", () => {
    for (const [route, step] of [[recoveryRestorePlanRoute, "plan"], [recoveryRestoreConfirmRoute, "confirm"], [recoveryRestoreExecuteRoute, "execute"]] as const) {
      expect(route.method).toBe("post");
      expect(route.path).toBe(`/api/admin/v1/recovery/restore/${step}`);
      expect(route.successStatus).toBeUndefined();
      expect(route.maxBodyBytes).toBeUndefined();
      expect(route.parse(raw(undefined))).toEqual({ ok: true, value: undefined });
    }
  });

  describe("plan", () => {
    it("plans for the session principal and answers the plan as-is", async () => {
      const { deps, planRestore } = planDeps();
      const result = await recoveryRestorePlanRoute.handle({ input: { restorePointId: "rp-1" }, deps, context: ctx }, {});
      expect(result).toEqual({ ok: true, value: { planId: "plan-1" } });
      expect(planRestore.mock.calls).toEqual([[{ principalId: "owner-1", restorePointId: "rp-1" }]]);
    });

    it.each([undefined, {}, { restorePointId: 7 }])("refuses body %j with the flat 400 VALIDATION_ERROR and plans nothing", async (body) => {
      const { deps, planRestore } = planDeps();
      expect(await refusalOf(() => recoveryRestorePlanRoute.handle({ input: body, deps, context: ctx }, {})))
        .toEqual({ status: 400, body: { error: "'restorePointId' (string) is required", code: "VALIDATION_ERROR" } });
      expect(planRestore).not.toHaveBeenCalled();
    });

    it("fails closed with the host's missing-session diagnosis before reading the body", async () => {
      const { deps, planRestore } = planDeps();
      await expect(Promise.resolve(recoveryRestorePlanRoute.handle({ input: undefined, deps }, {}))).rejects.toThrow(MISSING);
      expect(planRestore).not.toHaveBeenCalled();
    });
  });

  describe("confirm", () => {
    it("passes disclosureAcknowledged only when it is literally true", async () => {
      const { deps, confirmRestore } = confirmDeps();
      await recoveryRestoreConfirmRoute.handle({ input: { planId: "p", planHash: "h", disclosureAcknowledged: "yes" }, deps, context: ctx }, {});
      await recoveryRestoreConfirmRoute.handle({ input: { planId: "p", planHash: "h", disclosureAcknowledged: true }, deps, context: ctx }, {});
      expect(confirmRestore.mock.calls).toEqual([
        [{ principalId: "owner-1", planId: "p", planHash: "h", disclosureAcknowledged: false }],
        [{ principalId: "owner-1", planId: "p", planHash: "h", disclosureAcknowledged: true }],
      ]);
    });

    it.each([undefined, { planId: "p" }, { planHash: "h" }, { planId: 1, planHash: "h" }])("refuses body %j with 400", async (body) => {
      const { deps } = confirmDeps();
      expect(await refusalOf(() => recoveryRestoreConfirmRoute.handle({ input: body, deps, context: ctx }, {})))
        .toEqual({ status: 400, body: { error: "'planId' and 'planHash' (strings) are required", code: "VALIDATION_ERROR" } });
    });

    it("fails closed with the host's missing-session diagnosis", async () => {
      const { deps } = confirmDeps();
      await expect(Promise.resolve(recoveryRestoreConfirmRoute.handle({ input: { planId: "p", planHash: "h" }, deps }, {}))).rejects.toThrow(MISSING);
    });
  });

  describe("execute", () => {
    it("pre-authorizes backup.restore, then executes with the token and restore point", async () => {
      const { deps, authorizeRestoreExecution, executeRestore } = executeDeps();
      const result = await recoveryRestoreExecuteRoute.handle({ input: { confirmationToken: "tok", restorePointId: "rp-1" }, deps, context: ctx }, {});
      expect(result).toEqual({ ok: true, value: { restored: true } });
      expect(authorizeRestoreExecution.mock.calls).toEqual([[{ principalId: "owner-1", permission: "backup.restore" }]]);
      expect(executeRestore.mock.calls).toEqual([[{ principalId: "owner-1", confirmationToken: "tok", restorePointId: "rp-1" }]]);
    });

    it("AUD-001: refuses an unauthorized principal 403 before the body is read or anything executes", async () => {
      const { deps, executeRestore } = executeDeps(false);
      expect(await refusalOf(() => recoveryRestoreExecuteRoute.handle({ input: undefined, deps, context: ctx }, {}))).toEqual({
        status: 403,
        body: { error: "principal 'owner-1' is not authorized for 'backup.restore' (no grant)", code: "NOT_AUTHORIZED", details: { permission: "backup.restore", reason: "no grant" } },
      });
      expect(executeRestore).not.toHaveBeenCalled();
    });

    it.each([undefined, { confirmationToken: "tok" }, { restorePointId: "rp" }])("refuses body %j with 400 after authorizing", async (body) => {
      const { deps, executeRestore } = executeDeps();
      expect(await refusalOf(() => recoveryRestoreExecuteRoute.handle({ input: body, deps, context: ctx }, {})))
        .toEqual({ status: 400, body: { error: "'confirmationToken' and 'restorePointId' (strings) are required", code: "VALIDATION_ERROR" } });
      expect(executeRestore).not.toHaveBeenCalled();
    });

    it("fails closed with the host's missing-session diagnosis", async () => {
      const { deps, authorizeRestoreExecution } = executeDeps();
      await expect(Promise.resolve(recoveryRestoreExecuteRoute.handle({ input: {}, deps }, {}))).rejects.toThrow(MISSING);
      expect(authorizeRestoreExecution).not.toHaveBeenCalled();
    });
  });

  describe("ceremony error mapping (shared by all three steps)", () => {
    it.each([
      ["NOT_AUTHORIZED", 403], ["AGENT_CANNOT_CONFIRM", 403], ["ACTOR_CLASS_MISMATCH", 403], ["VALIDATION_ERROR", 400],
      ["RESTORE_POINT_NOT_FOUND", 404], ["COST_CLASS_UNAVAILABLE", 409], ["PLAN_STALE", 409], ["TOKEN_EXPIRED", 409],
      ["TOKEN_ALREADY_REDEEMED", 409], ["RESTORE_OPERATION_IN_FLIGHT", 409],
    ])("%s → %i with the payload's message and code", async (code, status) => {
      const { deps } = planDeps(errResult(code, `msg ${code}`));
      expect(await refusalOf(() => recoveryRestorePlanRoute.handle({ input: { restorePointId: "rp" }, deps, context: ctx }, {})))
        .toEqual({ status, body: { error: `msg ${code}`, code } });
    });

    it("falls back to the code as the error text when the payload carries no message", async () => {
      const { deps } = confirmDeps(errResult("PLAN_STALE"));
      expect(await refusalOf(() => recoveryRestoreConfirmRoute.handle({ input: { planId: "p", planHash: "h" }, deps, context: ctx }, {})))
        .toEqual({ status: 409, body: { error: "PLAN_STALE", code: "PLAN_STALE" } });
    });

    it("rethrows an unmapped code as an unexpected failure carrying its message (the host's redacted 500)", async () => {
      const { deps } = executeDeps(true, errResult("INTERNAL_ERROR", "ledger unreadable"));
      await expect(Promise.resolve(recoveryRestoreExecuteRoute.handle({ input: { confirmationToken: "t", restorePointId: "r" }, deps, context: ctx }, {})))
        .rejects.toThrow("ledger unreadable");
      const bare = planDeps(errResult("SOMETHING_NEW"));
      await expect(Promise.resolve(recoveryRestorePlanRoute.handle({ input: { restorePointId: "r" }, deps: bare.deps, context: ctx }, {})))
        .rejects.toThrow("SOMETHING_NEW");
    });
  });
});
