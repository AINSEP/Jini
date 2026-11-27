import { ToolInputError } from "@jini-ai/core";
import { expect, it, vi } from "vitest";

import type { NormalizedHit } from "../../types.js";
import type { AnalyticsSinkPort } from "../ports.js";
import { contributeAnalyticsTools, type AnalyticsToolDeps } from "../tool-registrations.js";

const toolId = "analytics_list_recent_hits";
const workspaceId = "newsroom";
const principalId = "reader-42";
const authorizeRequest = { principalId, workspaceId, permission: "analytics.read", entityType: "analytics-hit" };
const occurredAt = "2026-11-01T10:00:07.000Z";

function hit(path: string, overrides: Partial<NormalizedHit> = {}): NormalizedHit {
  return {
    workspaceId, occurredAt, kind: "event", path, referrerHost: "news.example", deviceClass: "mobile", browserFamily: "safari",
    eventName: "signup", eventProps: { plan: "pro" }, country: "DE", region: "BE", osFamily: "ios",
    visitorHash: "opaque-visitor-123", sessionId: "opaque-session-456",
    utm: { source: "email", medium: "newsletter", campaign: null, term: null, content: null },
    ...overrides,
  };
}

function setup(hits: readonly NormalizedHit[] = [], allowed = true) {
  let hasPermission = false;
  const authorize = vi.fn(async (request: Parameters<AnalyticsToolDeps["authorize"]>[0]) => {
    hasPermission = allowed && request.principalId === principalId && request.workspaceId === workspaceId
      && request.permission === "analytics.read" && request.entityType === "analytics-hit" && request.entityId === undefined;
    return { allowed: hasPermission, reason: hasPermission ? "granted" : "missing_grant" };
  });
  const list = vi.fn(async (required: Parameters<AnalyticsSinkPort["list"]>[0], options?: { limit?: number }) => {
    const limit = options?.limit;
    if (!hasPermission || Object.keys(required).length !== 0 || limit === undefined || limit < 1 || limit > 500) {
      throw new Error("invalid or unauthorized analytics list request");
    }
    hasPermission = false;
    return hits.slice(0, limit);
  });
  const analyticsSink: AnalyticsSinkPort = {
    capabilities: () => ({ durable: false, batch: false }), list,
    accept: async () => { throw new Error("read tool attempted to write a hit"); },
    acceptBatch: async () => { throw new Error("read tool attempted to write hits"); },
  };
  const contributor = contributeAnalyticsTools();
  const registrations = contributor.build({ analyticsSink, workspaceId, authorize }, {});
  const registered = registrations.find(({ descriptor }) => descriptor.id === toolId);
  if (!registered) throw new Error(`Missing registration for ${toolId}`);
  return {
    contributor, registrations, authorize, list,
    run: (input: unknown) => registered.handler({ input, principal: { id: principalId }, executionId: "execution-7", run: { id: "run-3" }, signal: new AbortController().signal }),
  };
}

it("contributes only the read-only recent-hit tool with its declared options", () => {
  const { contributor, registrations } = setup();
  expect(contributor.domain).toBe("analytics");
  expect([...contributor.risk]).toEqual([[toolId, "none"]]);
  expect(registrations.map(({ descriptor }) => ({ id: descriptor.id, readOnly: descriptor.readOnly, sideEffects: descriptor.sideEffects, inputSchema: descriptor.inputSchema }))).toEqual([{
    id: toolId, readOnly: true, sideEffects: "none",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      limit: { type: "integer", minimum: 1, maximum: 500, clamp: true, default: 100 },
      path: { type: "string", description: "Exact path filter, applied after reading the recent window." },
      summarize: { type: "boolean", default: false },
    } },
  }]);
});

it("authorizes the caller, defaults to 100 hits and exposes only the safe hit fields", async () => {
  const { run, authorize, list } = setup([hit("/signup")]);
  await expect(run({})).resolves.toEqual({ hits: [{
    occurredAt, kind: "event", path: "/signup", referrerHost: "news.example", deviceClass: "mobile", browserFamily: "safari", eventName: "signup",
  }] });
  expect(authorize.mock.calls).toEqual([[authorizeRequest]]);
  expect(list.mock.calls).toEqual([[{}, { limit: 100 }]]);
});

it.each([[0, 1], [999, 500]] as const)("bounds a requested limit of %i to %i at the sink", async (limit, bounded) => {
  const { run, list } = setup();
  await expect(run({ limit, summarize: false })).resolves.toEqual({ hits: [] });
  expect(list.mock.calls).toEqual([[{}, { limit: bounded }]]);
});

it("rejects an unauthorized caller with a model-facing denial before reading", async () => {
  const { run, authorize, list } = setup([hit("/private")], false);
  await expect(run({})).rejects.toMatchObject({
    name: "ToolInputError", message: "ANALYTICS_FORBIDDEN: principal 'reader-42' is not authorized for 'analytics.read' (missing_grant)",
  });
  expect(authorize.mock.calls).toEqual([[authorizeRequest]]);
  expect(list.mock.calls).toEqual([]);
});

it("rejects a non-object input before permission or storage calls", async () => {
  const { run, authorize, list } = setup();
  await expect(run(null)).rejects.toBeInstanceOf(ToolInputError);
  expect(authorize.mock.calls).toEqual([]);
  expect(list.mock.calls).toEqual([]);
});

it.each([
  ["a string limit", { limit: "12" }, "limit must be a finite integer"],
  ["an infinite limit", { limit: Number.POSITIVE_INFINITY }, "limit must be a finite integer"],
  ["a fractional limit", { limit: 2.75 }, "limit must be a finite integer"],
  ["a numeric path", { path: 42 }, "path must be a string"],
  ["a string summarize flag", { summarize: "yes" }, "summarize must be a boolean"],
] as const)("rejects %s before permission or storage calls", async (_kind, input, reason) => {
  const { run, authorize, list } = setup();
  await expect(run(input)).rejects.toMatchObject({ name: "ToolInputError", message: `${toolId}: ${reason}.` });
  expect(authorize.mock.calls).toEqual([]);
  expect(list.mock.calls).toEqual([]);
});

it("filters exactly after limiting and summarizes only the returned hit window", async () => {
  const { run, list } = setup([
    hit("/signup-confirmation"), hit("/signup", { referrerHost: null, deviceClass: "desktop" }),
    hit("/signup"), hit("/signup", { referrerHost: null, deviceClass: "desktop" }),
  ]);
  await expect(run({ limit: 3, path: "/signup", summarize: true })).resolves.toEqual({
    hits: [
      { occurredAt, kind: "event", path: "/signup", referrerHost: null, deviceClass: "desktop", browserFamily: "safari", eventName: "signup" },
      { occurredAt, kind: "event", path: "/signup", referrerHost: "news.example", deviceClass: "mobile", browserFamily: "safari", eventName: "signup" },
    ],
    summary: { hits: 2, byPath: [{ path: "/signup", hits: 2 }],
      byReferrerHost: [{ referrerHost: null, hits: 1 }, { referrerHost: "news.example", hits: 1 }], byDeviceClass: { desktop: 1, mobile: 1 } },
  });
  expect(list.mock.calls).toEqual([[{}, { limit: 3 }]]);
});

it("returns the ten most frequent paths and referrers, breaking ties by name", async () => {
  const keys = ["k", "j", "i", "h", "g", "f", "e", "d", "c", "b", "a"];
  const onceEach = keys.map((key) => hit(`/${key}`, { referrerHost: `${key}.example` }));
  const { run } = setup([...onceEach, hit("/z", { referrerHost: null }), hit("/z", { referrerHost: null })]);
  const firstNine = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  await expect(run({ summarize: true })).resolves.toMatchObject({ summary: {
    hits: 13,
    byPath: [{ path: "/z", hits: 2 }, ...firstNine.map((key) => ({ path: `/${key}`, hits: 1 }))],
    byReferrerHost: [{ referrerHost: null, hits: 2 }, ...firstNine.map((key) => ({ referrerHost: `${key}.example`, hits: 1 }))],
    byDeviceClass: { mobile: 13 },
  } });
});

it("preserves an unexpected storage failure instead of returning a fabricated empty window", async () => {
  const { run, list } = setup();
  const offline = new Error("buffer unavailable");
  list.mockRejectedValueOnce(offline);
  await expect(run({ limit: 12 })).rejects.toBe(offline);
  expect(list.mock.calls).toEqual([[{}, { limit: 12 }]]);
});
