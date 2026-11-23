import { describe, expect, it } from "vitest";
import { redirectHitsRoute } from "../hits.js";
import { fakeRule, MANAGE, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

const raw = (params: Record<string, string>) => ({ body: {}, query: {}, params });
const repo = { findById: async ({ id }: { id: string; workspaceId: string }) => (id === "red-1" ? fakeRule() : null) };

describe("redirectHitsRoute", () => {
  it("keeps the path and reads :id, falling back to an empty id", () => {
    expect(redirectHitsRoute.method).toBe("get");
    expect(redirectHitsRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/redirects/:id/hits");
    expect(redirectHitsRoute.parse(raw({ id: "red-1" }))).toEqual({ ok: true, value: { id: "red-1" } });
    expect(redirectHitsRoute.parse(raw({}))).toEqual({ ok: true, value: { id: "" } });
  });

  it("authorizes and answers recorded stats", async () => {
    const { authorize, calls } = recordingAuthorize();
    const asked: unknown[] = [];
    const redirectHitSink = { getStats: async (input: { workspaceId: string; redirectId: string }) => { asked.push(input); return { redirectId: "red-1", workspaceId: WORKSPACE_ID, hitCount: 42, lastHitAt: "2026-01-02T00:00:00Z" }; } };
    const result = await redirectHitsRoute.handle({ input: { id: "red-1" }, deps: { workspaceId: WORKSPACE_ID, redirectRepo: repo, redirectHitSink }, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([MANAGE]);
    expect(asked).toEqual([{ workspaceId: WORKSPACE_ID, redirectId: "red-1" }]);
    expect(result).toEqual({ ok: true, value: { data: { redirectId: "red-1", workspaceId: WORKSPACE_ID, hitCount: 42, lastHitAt: "2026-01-02T00:00:00Z" } } });
  });

  it("answers zero hits (not 404) for a known rule with no stats yet", async () => {
    const { authorize } = recordingAuthorize();
    const redirectHitSink = { getStats: async () => null };
    const result = await redirectHitsRoute.handle({ input: { id: "red-1" }, deps: { workspaceId: WORKSPACE_ID, redirectRepo: repo, redirectHitSink }, context: PRINCIPAL, authorize });
    expect(result).toEqual({ ok: true, value: { data: { redirectId: "red-1", workspaceId: WORKSPACE_ID, hitCount: 0, lastHitAt: null } } });
  });

  it("refuses an unknown rule with 404 REDIRECT_NOT_FOUND", async () => {
    const { authorize } = recordingAuthorize();
    const redirectHitSink = { getStats: async () => null };
    expect(await refusalOf(() => redirectHitsRoute.handle({ input: { id: "" }, deps: { workspaceId: WORKSPACE_ID, redirectRepo: repo, redirectHitSink }, context: PRINCIPAL, authorize }))).toEqual({
      status: 404, body: { error: "redirect '' was not found", code: "REDIRECT_NOT_FOUND" },
    });
  });
});
