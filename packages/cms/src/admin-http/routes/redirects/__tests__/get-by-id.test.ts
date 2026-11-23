import { describe, expect, it } from "vitest";
import { redirectGetRoute } from "../get-by-id.js";
import { fakeRule, fakeRuleDto, manageRule, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const raw = (params: Record<string, string>) => ({ body: {}, query: {}, params });

describe("redirectGetRoute", () => {
  it("keeps the path and reads :id, falling back to an empty id", () => {
    expect(redirectGetRoute.method).toBe("get");
    expect(redirectGetRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/redirects/:id");
    expect(redirectGetRoute.parse(raw({ id: "red-1" }))).toEqual({ ok: true, value: { id: "red-1" } });
    expect(redirectGetRoute.parse(raw({}))).toEqual({ ok: true, value: { id: "" } });
  });

  it("authorizes admin.redirects.manage and answers the rule in the data envelope", async () => {
    const { authorize, calls } = recordingAuthorize();
    const deps = { workspaceId: WORKSPACE_ID, redirectRepo: { findById: async ({ id, workspaceId }: { id: string; workspaceId: string }) => (id === "red-1" && workspaceId === WORKSPACE_ID ? fakeRule() : null) } };
    const result = await redirectGetRoute.handle({ input: { id: "red-1" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([manageRule("red-1")]);
    expect(result).toEqual({ ok: true, value: { data: fakeRuleDto() } });
  });

  it("refuses an unknown rule with 404 REDIRECT_NOT_FOUND", async () => {
    const { authorize } = recordingAuthorize();
    const deps = { workspaceId: WORKSPACE_ID, redirectRepo: { findById: async () => null } };
    expect(await refusalOf(() => redirectGetRoute.handle({ input: { id: "nope" }, deps, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "redirect 'nope' was not found", code: "REDIRECT_NOT_FOUND" },
    });
  });

  it("does not read the rule when authorization refuses", async () => {
    let reads = 0;
    const deps = { workspaceId: WORKSPACE_ID, redirectRepo: { findById: async () => { reads += 1; return null; } } };
    await expect(redirectGetRoute.handle({ input: { id: "red-1" }, deps, context: PRINCIPAL, authorize: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
    expect(reads).toBe(0);
  });
});
