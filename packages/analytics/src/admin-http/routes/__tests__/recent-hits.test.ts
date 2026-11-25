import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import type { NormalizedHit } from "@jini-ai/core/contracts/site/analytics";
import { describe, expect, it } from "vitest";
import { analyticsRecentHitsRoute } from "../recent-hits.js";

const WORKSPACE_ID = "ws-1";
const PRINCIPAL = { id: "principal-1" };
const signal = new AbortController().signal;
const raw = (query: Record<string, unknown> = {}) => ({ body: undefined, query, params: { workspaceId: WORKSPACE_ID } });

function hit(overrides: Partial<NormalizedHit> = {}): NormalizedHit {
  return {
    occurredAt: "2026-07-10T12:00:00.000Z", kind: "pageview", path: "/p", referrerHost: "ref.example", deviceClass: "desktop",
    browserFamily: "Firefox", eventName: null, host: "h.example", visitorHash: "secret-visitor-hash", ...overrides,
  } as unknown as NormalizedHit;
}

function recordingSink(hits: NormalizedHit[] = []) {
  const calls: unknown[] = [];
  return { calls, analyticsSink: { list: async (required: Record<string, never>, optional?: { limit?: number }) => { calls.push({ required, optional }); return hits; } } };
}

function recordingAuthorize() {
  const calls: unknown[] = [];
  return { calls, authorize: async (required: { permission: string; entityType: string }, optional?: unknown) => { calls.push({ required, optional }); } };
}

describe("analyticsRecentHitsRoute", () => {
  it("pins the method, path, and the absence of a body cap or success status", () => {
    expect(analyticsRecentHitsRoute.method).toBe("get");
    expect(analyticsRecentHitsRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/analytics/recent-hits");
    expect(analyticsRecentHitsRoute.successStatus).toBeUndefined();
    expect(analyticsRecentHitsRoute.maxBodyBytes).toBeUndefined();
  });

  it.each([
    [undefined, undefined], ["", undefined], ["  ", undefined], ["abc", undefined], ["Infinity", undefined],
    [["1", "2"], undefined], [7, undefined], ["25", 25], ["0", 0], ["-3", -3], ["2.5", 2.5], [" 4 ", 4],
  ])("parses ?limit=%j to %j (finite numbers only; the sink owns clamping)", (limit, expected) => {
    expect(analyticsRecentHitsRoute.parse(raw({ limit }))).toEqual({ ok: true, value: { limit: expected } });
  });

  it("asks for analytics.read on the analytics-hit entity, id-free, before reading the sink", async () => {
    const { authorize, calls } = recordingAuthorize();
    const { analyticsSink, calls: sinkCalls } = recordingSink();
    await analyticsRecentHitsRoute.handle({ input: { limit: undefined }, deps: { workspaceId: WORKSPACE_ID, analyticsSink }, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([{ required: { permission: "analytics.read", entityType: "analytics-hit" }, optional: undefined }]);
    expect(sinkCalls).toHaveLength(1);
  });

  it("answers only the bounded raw-ingest fields of each hit, in sink order, and forwards the limit", async () => {
    const { analyticsSink, calls } = recordingSink([hit({ path: "/a" }), hit({ path: "/b", kind: "event", eventName: "signup" })]);
    const result = await analyticsRecentHitsRoute.handle({ input: { limit: 5 }, deps: { workspaceId: WORKSPACE_ID, analyticsSink }, context: PRINCIPAL, authorize: recordingAuthorize().authorize }, { signal });
    expect(calls).toEqual([{ required: {}, optional: { limit: 5 } }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value).toEqual({ hits: [
      { occurredAt: "2026-07-10T12:00:00.000Z", kind: "pageview", path: "/a", referrerHost: "ref.example", deviceClass: "desktop", browserFamily: "Firefox", eventName: null },
      { occurredAt: "2026-07-10T12:00:00.000Z", kind: "event", path: "/b", referrerHost: "ref.example", deviceClass: "desktop", browserFamily: "Firefox", eventName: "signup" },
    ] });
    expect(JSON.stringify(result.value)).not.toContain("secret-visitor-hash");
  });

  it("lets a refusing authorizer through before any sink read", async () => {
    const { analyticsSink, calls } = recordingSink();
    const authorize = async () => { throw new RouteRefusalError({ status: 403, body: { error: "denied", code: "FORBIDDEN" } }); };
    await expect(analyticsRecentHitsRoute.handle({ input: { limit: undefined }, deps: { workspaceId: WORKSPACE_ID, analyticsSink }, context: PRINCIPAL, authorize })).rejects.toBeInstanceOf(RouteRefusalError);
    expect(calls).toEqual([]);
  });

  it("fails closed without an authorizer, and rethrows a sink failure unchanged for the host failure writer", async () => {
    const { analyticsSink } = recordingSink();
    await expect(analyticsRecentHitsRoute.handle({ input: { limit: undefined }, deps: { workspaceId: WORKSPACE_ID, analyticsSink }, context: PRINCIPAL })).rejects.toThrow("no authorizer");
    const failing = { list: async () => { throw new Error("private sink failure"); } };
    await expect(analyticsRecentHitsRoute.handle({ input: { limit: undefined }, deps: { workspaceId: WORKSPACE_ID, analyticsSink: failing }, context: PRINCIPAL, authorize: recordingAuthorize().authorize })).rejects.toThrow("private sink failure");
  });
});
