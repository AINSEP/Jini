import { describe, expect, it } from "vitest";
import { commerceBuyerStatus, toCommerceBuyerOrder } from "../../buyer-order.js";
import type { CommerceOrderView } from "../../plugin-server.js";

const amount = { minorUnits: 2400, currency: "JPY" };
function internalView(): CommerceOrderView {
  return { order: { id: "order", workspaceId: "private-workspace", memberId: "private-member", provider: "stripe",
    providerPaymentRef: "private-provider-reference", status: "pending", totalAmount: amount, placedAt: "2026-11-05T00:00:00Z",
    createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z", version: 1 },
    payment: { id: "private-payment", scope: { workspaceId: "private-workspace", mode: "test", providerId: "stripe", providerAccountId: "private-account" },
      status: "requires_action", amount, captured: { minorUnits: 0, currency: "JPY" }, refunded: { minorUnits: 0, currency: "JPY" },
      refundHeld: { minorUnits: 0, currency: "JPY" }, disputed: { minorUnits: 0, currency: "JPY" }, reference: "private-reference",
      next: { kind: "redirect", url: "https://provider.example/private-session" } }, intent: null };
}

describe("buyer order projection", () => {
  it("copies an explicit buyer allowlist without internal scope, references or checkout capabilities", () => {
    const internal = internalView();
    const view = toCommerceBuyerOrder({ view: internal });
    expect(view).toEqual({ order: { id: "order", status: "pending", totalAmount: amount, placedAt: "2026-11-05T00:00:00Z", version: 1 },
      payment: { status: "requires_action", amount, captured: { minorUnits: 0, currency: "JPY" }, refunded: { minorUnits: 0, currency: "JPY" } } });
    expect(JSON.stringify(view)).not.toContain("private");
    expect(view.order.totalAmount).not.toBe(internal.order.totalAmount);
    expect(view.payment?.amount).not.toBe(internal.payment?.amount);
  });
  it("keeps pending orders pending even if the payment has succeeded ahead of order projection", () => {
    const internal = internalView();
    internal.payment = { ...internal.payment!, status: "succeeded" };
    expect(commerceBuyerStatus({ view: toCommerceBuyerOrder({ view: internal }) }).title).toBe("Payment status pending");
  });
  it.each(["paid", "failed", "canceled"] as const)("reports ledger order status %s", status => {
    const internal = internalView(); internal.order.status = status;
    expect(commerceBuyerStatus({ view: toCommerceBuyerOrder({ view: internal }) }).title).toBe({
      paid: "Payment confirmed", failed: "Payment unsuccessful", canceled: "Order canceled",
    }[status]);
  });
  it("supports an order with no reserved payment", () => {
    const internal = internalView(); internal.payment = null;
    expect(toCommerceBuyerOrder({ view: internal }).payment).toBeNull();
  });
});
