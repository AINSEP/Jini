import { expect, it, vi } from "vitest";
import type { VisitorAnalyticsDeps } from "../contracts.js";
import { captureVisitorEvent, visitorAnalyticsProvenance } from "../visitor-analytics.js";

it("does not capture when permission is revoked after proof minting", async () => {
  const capture = vi.fn(async () => {});
  const tracker = { capture } as unknown as NonNullable<VisitorAnalyticsDeps["tracker"]>;
  const proof = { receiptId: "receipt", policyVersion: "v1" };
  const order: string[] = [];
  const newId = vi.fn(() => { order.push("id"); return "anon"; });
  const deps: VisitorAnalyticsDeps = { tracker, idGen: { newId }, visitorAnalyticsProof: async () => { order.push("proof"); return proof; }, visitorAnalyticsDeliveryAllowed: async () => { order.push("permission"); return false; } };
  await captureVisitorEvent({ deps, request: {}, name: "submitted" });
  expect(order).toEqual(["proof", "id", "permission"]);
  expect(capture).not.toHaveBeenCalled();
  const { visitorAnalyticsDeliveryAllowed, ...withoutPermission } = deps;
  await captureVisitorEvent({ deps: withoutPermission, request: {}, name: "submitted" });
  expect(capture).not.toHaveBeenCalled();
  newId.mockClear();
  await captureVisitorEvent({ deps: { ...deps, visitorAnalyticsProof: async () => undefined }, request: {}, name: "submitted" });
  expect(newId).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled();
  const permitted = { ...deps, visitorAnalyticsDeliveryAllowed: async () => true };
  await captureVisitorEvent({ deps: permitted, request: {}, name: "submitted" }, { subjectId: "member:1" });
  expect(capture.mock.calls).toEqual([[{ name: "submitted", userId: "member:1" }, {}]]);
  capture.mockRejectedValueOnce(new Error("telemetry failure"));
  await expect(captureVisitorEvent({ deps: permitted, request: {}, name: "submitted" })).resolves.toBeUndefined();
});

function recordingTracker() {
  type Tracker = NonNullable<VisitorAnalyticsDeps["tracker"]>;
  const capture = vi.fn<Tracker["capture"]>();
  const tracker: Tracker = {
    capture,
    error: () => { throw new Error("unexpected tracker error call"); },
    trace: async () => { throw new Error("unexpected tracker trace call"); },
    metric: () => { throw new Error("unexpected tracker metric call"); },
  };
  return { tracker, capture };
}

it("uses the visitor tracker and forwards the request proof, anonymous subject, and properties", async () => {
  const fallback = recordingTracker();
  const visitor = recordingTracker();
  const request = { route: "/feedback" };
  const proof = { receiptId: "visitor-receipt", policyVersion: "2026-11" };
  const visitorAnalyticsProof = vi.fn(async (_required: { request: typeof request }) => proof);
  const visitorAnalyticsDeliveryAllowed = vi.fn(async (_required: { proof: typeof proof }) => true);
  const deps = { tracker: fallback.tracker, visitorTracker: visitor.tracker, idGen: { newId: () => "anon-85" }, visitorAnalyticsProof, visitorAnalyticsDeliveryAllowed };

  await captureVisitorEvent({ deps, request, name: "feedback_submitted", properties: { variant: "short", fields: 2 } });

  expect(visitorAnalyticsProof.mock.calls).toEqual([[{ request }]]);
  expect(visitorAnalyticsDeliveryAllowed.mock.calls).toEqual([[{ proof }]]);
  expect(visitor.capture.mock.calls).toEqual([[{ name: "feedback_submitted", userId: "visitor:anon-85" }, { properties: { variant: "short", fields: 2 } }]]);
  expect(fallback.capture.mock.calls).toEqual([]);
});

it("skips proof lookup when either the tracker or ID generator is missing", async () => {
  const { tracker, capture } = recordingTracker();
  const visitorAnalyticsProof = vi.fn(async () => ({ receiptId: "receipt", policyVersion: "v1" }));
  const newId = vi.fn(() => "never-minted");
  const request = { route: "/feedback" };

  await expect(visitorAnalyticsProvenance({ deps: { idGen: { newId }, visitorAnalyticsProof }, request })).resolves.toBeUndefined();
  await expect(visitorAnalyticsProvenance({ deps: { tracker, visitorAnalyticsProof }, request })).resolves.toBeUndefined();
  expect(visitorAnalyticsProof.mock.calls).toEqual([]);
  expect(newId.mock.calls).toEqual([]);
  expect(capture.mock.calls).toEqual([]);
});

it("drops failed proof reads and fails closed when the proof port is absent", async () => {
  const { tracker, capture } = recordingTracker();
  const idGen = { newId: vi.fn(() => "never-minted") };
  const request = { route: "/feedback" };
  const visitorAnalyticsProof = vi.fn(async (_required: { request: typeof request }) => { throw new Error("consent unavailable"); });
  const visitorAnalyticsDeliveryAllowed = vi.fn(async () => true);
  const deps = { tracker, idGen, visitorAnalyticsDeliveryAllowed };

  await expect(captureVisitorEvent({ deps: { ...deps, visitorAnalyticsProof }, request, name: "feedback_submitted" })).resolves.toBeUndefined();
  await expect(captureVisitorEvent({ deps, request, name: "feedback_submitted" })).resolves.toBeUndefined();
  expect(visitorAnalyticsProof.mock.calls).toEqual([[{ request }]]);
  expect(idGen.newId.mock.calls).toEqual([]);
  expect(visitorAnalyticsDeliveryAllowed.mock.calls).toEqual([]);
  expect(capture.mock.calls).toEqual([]);
});
