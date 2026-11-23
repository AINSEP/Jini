import { describe, expect, it } from "vitest";
import { toAdminDeliveryResponse, toAdminDeliverySummary, toAdminSubscriptionResponse } from "../integrations.js";
import { fakeDelivery, fakeSubscription } from "../../routes/integrations/__tests__/helpers.js";

describe("integrations admin DTOs", () => {
  it("projects a subscription field by field, copies topics and never emits attribution", () => {
    const subscription = fakeSubscription({ topics: ["a", "b"] });
    const response = toAdminSubscriptionResponse({ subscription, lastDelivery: null });
    expect(response).toEqual({
      id: "sub-1", label: "Orders", targetUrl: "https://hooks.example.com/orders", topics: ["a", "b"], status: "active", secretVersion: 2,
      previousSecretVersion: 1, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z", disabledAt: null, version: 3, lastDelivery: null,
    });
    expect(response.topics).not.toBe(subscription.topics);
  });

  it("embeds the seven-field delivery summary, not the full delivery", () => {
    const delivery = fakeDelivery({ status: "failed", attempts: 3, lastResponseStatus: 500, lastError: "HTTP 500", deliveredAt: null });
    const expected = { id: "d-1", status: "failed", attempts: 3, lastResponseStatus: 500, lastError: "HTTP 500", createdAt: "2026-10-03T00:00:00.000Z", deliveredAt: null };
    expect(toAdminDeliverySummary(delivery)).toEqual(expected);
    expect(toAdminSubscriptionResponse({ subscription: fakeSubscription(), lastDelivery: delivery }).lastDelivery).toEqual(expected);
  });

  it("projects the full delivery log row (thirteen fields) and drops the workspace id", () => {
    expect(toAdminDeliveryResponse(fakeDelivery({ status: "dead", deadAt: "2026-10-09T00:00:00.000Z" }))).toEqual({
      id: "d-1", subscriptionId: "sub-1", eventId: "ev-1", topic: "post.published", status: "dead", attempts: 1,
      nextAttemptAt: "2026-10-03T00:00:00.000Z", lastResponseStatus: 204, lastError: null, signedWithVersion: 2,
      createdAt: "2026-10-03T00:00:00.000Z", deliveredAt: "2026-10-03T00:00:01.000Z", deadAt: "2026-10-09T00:00:00.000Z",
    });
  });
});
