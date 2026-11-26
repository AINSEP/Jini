import { expect, it, vi } from "vitest";
import { createOrderRoute, payOrderRoute, readOrderRoute, commerceReturnRoute, commerceCancelRoute } from "../purchase.js";
import type { CommerceOrderView } from "../../catalog/plugin-server.js";

const admission = {
  workspaceId: "w", markNoStore: vi.fn(), resolveCommerce: () => true,
  checkLimit: async () => ({ allowed: true as const }), setRetryAfter: vi.fn(), buyer: async () => "m",
};
const write = { ...admission, sameOrigin: () => true, checkoutOrigin: async () => "https://shop", requestOrigin: () => "https://foreign", activate: vi.fn(async () => ({ ready: true, reason: null })) };
const view = { order: { id: "o", status: "pending", totalAmount: { minorUnits: 10, currency: "USD" }, placedAt: "now", version: 1 }, payment: { status: "pending", amount: { minorUnits: 10, currency: "USD" }, captured: { minorUnits: 0, currency: "USD" }, refunded: { minorUnits: 0, currency: "USD" }, next: { kind: "redirect", url: "https://provider/capability" }, providerScope: "secret" }, intent: { ok: true } } as unknown as CommerceOrderView;

it("validates before admission, denies foreign origin before activation, and only reads on return/cancel", async () => {
  const createOrder = vi.fn(async () => ({}));
  admission.markNoStore.mockClear(); write.activate.mockClear();
  expect(await createOrderRoute.handle({ input: { workspaceId: "w", body: { priceId: "p", quantity: 0 } }, deps: { ...write, createOrder } })).toMatchObject({ ok: true, value: { status: 400 } });
  expect(admission.markNoStore).not.toHaveBeenCalled();
  expect(await createOrderRoute.handle({ input: { workspaceId: "w", body: { priceId: "p" } }, deps: { ...write, createOrder } })).toMatchObject({ value: { status: 403 } });
  expect(write.activate).not.toHaveBeenCalled(); expect(createOrder).not.toHaveBeenCalled();
  const readOrder = vi.fn(async () => view);
  const renderBuyerPage = vi.fn(async () => "page");
  for (const route of [commerceReturnRoute, commerceCancelRoute]) expect(await route.handle({ query: { orderId: "o", paid: "true" }, deps: { ...admission, readOrder, renderBuyerPage } })).toMatchObject({ status: 200, html: "page" });
  expect(readOrder).toHaveBeenCalledTimes(2);
  expect(renderBuyerPage).toHaveBeenCalledWith(expect.objectContaining({ title: "Payment status pending" }));
  expect(write.activate).not.toHaveBeenCalled();
});

it("pay retries pass the same owned order id and only pay can return the resumable capability", async () => {
  const pay = vi.fn(async (_input: { memberId: string; orderId: string }) => view);
  const deps = { ...write, requestOrigin: () => "https://shop", pay };
  for (let n = 0; n < 2; n++) {
    const result = await payOrderRoute.handle({ input: { workspaceId: "w", orderId: "o", body: {} }, deps });
    expect(result).toMatchObject({ value: { payment: { next: { url: "https://provider/capability" } }, intent: { ok: true } } });
    expect(JSON.stringify(result)).not.toContain("providerScope");
  }
  expect(pay.mock.calls).toEqual([[{ memberId: "m", orderId: "o" }], [{ memberId: "m", orderId: "o" }]]);
  const read = await readOrderRoute.handle({ input: { workspaceId: "w", orderId: "o" }, deps: { ...admission, readOrder: async () => view } });
  expect(JSON.stringify(read)).not.toContain("next");
  expect(JSON.stringify(read)).not.toContain("intent");
});
