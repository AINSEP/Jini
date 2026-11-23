import { describe, expect, it } from "vitest";
import { redirectImportRoute } from "../import.js";
import { makeWriteDeps, MANAGE, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const raw = (body: unknown) => ({ body, query: {}, params: { workspaceId: WORKSPACE_ID } });
const rule = (fromPattern: string) => ({ matchType: "exact", fromPattern, toTarget: "/t", statusCode: 301 });

describe("redirectImportRoute", () => {
  it("keeps the path and answers 207", () => {
    expect(redirectImportRoute.method).toBe("post");
    expect(redirectImportRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/redirects/import");
    expect(redirectImportRoute.successStatus).toBe(207);
  });

  it("parses 1-500 rules", () => {
    expect(redirectImportRoute.parse(raw({ rules: [rule("/a")] }))).toEqual({ ok: true, value: { rules: [rule("/a")] } });
    expect(redirectImportRoute.parse(raw({ rules: Array.from({ length: 500 }, (_, i) => rule(`/r${i}`)) })).ok).toBe(true);
  });

  it("refuses a missing, non-array, empty or oversized batch with 400 VALIDATION_ERROR", async () => {
    const body = { error: "rules must be an array of 1-500 items", code: "VALIDATION_ERROR" };
    for (const input of [undefined, {}, { rules: "x" }, { rules: [] }, { rules: Array.from({ length: 501 }, (_, i) => rule(`/r${i}`)) }]) {
      expect(await refusalOf(() => redirectImportRoute.parse(raw(input)))).toEqual({ status: 400, body });
    }
  });

  it("authorizes, imports as the principal, and reports a per-item failure without aborting the batch", async () => {
    const { authorize, calls } = recordingAuthorize();
    const redirectsWriteDeps = makeWriteDeps();
    const result = await redirectImportRoute.handle({ input: { rules: [rule("/dup"), rule("/dup")] }, deps: { workspaceId: WORKSPACE_ID, redirectsWriteDeps }, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([MANAGE]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.created.map((r) => [r.fromPattern, r.createdByPrincipal, r.workspaceId])).toEqual([["/dup", PRINCIPAL.id, WORKSPACE_ID]]);
    expect(result.value.failed).toEqual([{ index: 1, code: "REDIRECT_CONFLICT", message: expect.stringMatching(/already exists/) }]);
  });

  it("does not import when authorization refuses", async () => {
    const redirectsWriteDeps = makeWriteDeps();
    await expect(redirectImportRoute.handle({ input: { rules: [rule("/a")] }, deps: { workspaceId: WORKSPACE_ID, redirectsWriteDeps }, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
    expect(await redirectsWriteDeps.repo.list({ workspaceId: WORKSPACE_ID })).toEqual([]);
  });
});
