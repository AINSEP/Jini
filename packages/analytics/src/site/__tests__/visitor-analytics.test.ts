import { expect, it, vi } from "vitest";
import type { VisitorAnalyticsDeps } from "../contracts.js";
import { captureVisitorEvent } from "../visitor-analytics.js";

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
