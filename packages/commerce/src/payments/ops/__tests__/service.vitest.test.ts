import { describe, expect, test } from "vitest";

import { noopAlertPort } from "../../contract/alerts.js";
import { resolveOpsDeps } from "../deps.js";
import { LIPAY, SCRIPTED, USD, paidLipay, world } from "./harness.js";

/** @file The service's read paths and wiring: getPayment (scope-fenced), listProviders, dependency defaults. */

describe("createPaymentsService reads", () => {
  test("getPayment returns the view in its own scope only", async () => {
    const w = await world();
    const paid = await paidLipay(w);
    expect(await w.service.getPayment({ scope: LIPAY, paymentId: paid.id })).toEqual(paid);
    expect(await w.service.getPayment({ scope: { ...LIPAY, siteId: "other" }, paymentId: paid.id })).toBeNull();
    expect(await w.service.getPayment({ scope: { ...LIPAY, mode: "live" }, paymentId: paid.id })).toBeNull();
    expect(await w.service.getPayment({ scope: LIPAY, paymentId: "nope" })).toBeNull();
    expect(await w.service.getPayment({ scope: { ...LIPAY, providerAccountId: "" }, paymentId: paid.id })).toBeNull();
  });

  test("listProviders summarizes every registered provider", async () => {
    const w = await world({ scripted: { refunds: "full" } });
    expect(w.service.listProviders()).toEqual([
      { id: "lipay", displayName: "LiPay (fake)", refunds: "partial", capture: "auto" },
      { id: "scripted", displayName: "Scripted", refunds: "full", capture: "manual" },
    ]);
    expect(SCRIPTED.providerId).toBe("scripted");
  });

  test("the consumer view projects exact captured, refunded, held and disputed cents without provider credentials", async () => {
    const w = await world();
    w.scripted.queue("createIntent", { kind: "ok", value: {
      evidence: {
        providerRef: "private-provider-ref", status: "succeeded", captured: USD(899),
        refunds: [
          { providerRefundRef: "provider-refund-done", amount: USD(123), status: "succeeded" },
          { providerRefundRef: "provider-refund-pending", amount: USD(234), status: "pending" },
        ],
        disputes: [{ providerDisputeRef: "private-dispute-ref", amount: USD(345), status: "open" }],
      },
      next: { kind: "none" },
    } });
    const created = await w.service.createIntent({ scope: SCRIPTED, amount: USD(1_001), idempotencyKey: "view", reference: "order-view" });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("fixture payment failed");
    expect(await w.service.getPayment({ scope: SCRIPTED, paymentId: created.payment.id })).toEqual({
      id: created.payment.id, scope: SCRIPTED, status: "partially_refunded", amount: USD(1_001), captured: USD(899),
      refunded: USD(123), refundHeld: USD(234), disputed: USD(345), reference: "order-view", next: { kind: "none" },
    });
  });
});

describe("resolveOpsDeps", () => {
  test("defaults: no risk gate, alerts dropped; the writer shares the clock, ids and alert sink", () => {
    const required = { ledger: {} as never, providers: {} as never, contexts: {} as never, grants: {} as never, now: () => 1, newId: () => "x" };
    const deps = resolveOpsDeps(required);
    expect(deps.risk).toBeNull();
    expect(deps.alerts).toBe(noopAlertPort);
    expect(deps.writer).toEqual({ now: required.now, newId: required.newId, alerts: noopAlertPort });
  });
});
