/**
 * Stripe object → evidence: the status tables, next actions, captured amounts and the
 * all-or-nothing readers (a half-read object never becomes evidence).
 */
import { describe, expect, it } from "vitest";
import { amountToStripe, currencyToStripe, moneyFromStripe } from "../amounts.js";
import { idOf } from "../json.js";
import { disputeEvidence, intentEvidence, readAll, refundEvidence } from "../objects.js";
import { dispute } from "./fixtures/dispute.js";
import {
  intentCanceled,
  intentDeclined,
  intentProcessing,
  intentRequiresActionRedirect,
  intentRequiresActionSdk,
  intentRequiresCapture,
  intentRequiresConfirmation,
  intentRequiresPaymentMethod,
  intentSucceeded,
} from "./fixtures/payment-intent.js";
import { refund } from "./fixtures/refund.js";

const SECRET = intentRequiresPaymentMethod.client_secret;
const clientAction = { kind: "client_action", payload: { client_secret: SECRET } };

describe("intentEvidence status map", () => {
  it.each([
    ["requires_payment_method (fresh)", intentRequiresPaymentMethod, "pending", clientAction],
    ["requires_payment_method + last_payment_error", intentDeclined, "failed", { kind: "none" }],
    ["requires_confirmation", intentRequiresConfirmation, "pending", clientAction],
    ["processing", intentProcessing, "pending", { kind: "none" }],
    ["requires_action + redirect_to_url", intentRequiresActionRedirect, "requires_action", { kind: "redirect", url: expect.stringMatching(/^https:\/\/hooks\.stripe\.com\//) }],
    ["requires_action + use_stripe_sdk", intentRequiresActionSdk, "requires_action", clientAction],
    ["requires_capture", intentRequiresCapture, "authorized", { kind: "none" }],
    ["succeeded", intentSucceeded, "succeeded", { kind: "none" }],
    ["canceled", intentCanceled, "canceled", { kind: "none" }],
  ])("%s → %s", (_label, intent, status, next) => {
    expect(intentEvidence({ intent })).toMatchObject({ status, next });
  });

  it("captured: 0 while authorized, amount_received once succeeded, absent otherwise", () => {
    expect(intentEvidence({ intent: intentRequiresCapture })?.captured).toEqual({ minorUnits: 0, currency: "USD" });
    expect(intentEvidence({ intent: intentSucceeded })?.captured).toEqual({ minorUnits: 2000, currency: "USD" });
    expect(intentEvidence({ intent: intentProcessing })).not.toHaveProperty("captured");
  });

  it("requires_action with a redirect_to_url lacking a url falls back to the client secret; no secret → none", () => {
    const noUrl = { ...intentRequiresActionRedirect, next_action: { type: "redirect_to_url", redirect_to_url: {} } };
    expect(intentEvidence({ intent: noUrl })?.next).toEqual(clientAction);
    expect(intentEvidence({ intent: { ...intentRequiresActionSdk, client_secret: null } })?.next).toEqual({ kind: "none" });
  });

  it("no correlation id when metadata lacks it or is not an object", () => {
    expect(intentEvidence({ intent: { ...intentSucceeded, metadata: {} } })).not.toHaveProperty("correlationId");
    expect(intentEvidence({ intent: { ...intentSucceeded, metadata: null } })).not.toHaveProperty("correlationId");
  });

  it.each([
    ["no id", { ...intentSucceeded, id: undefined }],
    ["an unknown status", { ...intentSucceeded, status: "requires_reauthorization" }],
    ["an inherited status name", { ...intentSucceeded, status: "toString" }],
    ["a non-string status", { ...intentSucceeded, status: 3 }],
    ["a float amount", { ...intentSucceeded, amount: 20.5 }],
    ["a negative amount", { ...intentSucceeded, amount: -1 }],
    ["a bad currency", { ...intentSucceeded, currency: "us" }],
    ["a non-string currency", { ...intentSucceeded, currency: 840 }],
    ["succeeded without amount_received", { ...intentSucceeded, amount_received: null }],
  ])("is undefined for %s", (_label, intent) => {
    expect(intentEvidence({ intent })).toBeUndefined();
  });
});

describe("refundEvidence", () => {
  it.each([
    ["pending", "pending"], ["requires_action", "pending"], ["succeeded", "succeeded"], ["failed", "failed"], ["canceled", "failed"],
  ])("%s → %s", (stripeStatus, status) => {
    expect(refundEvidence({ refund: refund({ status: stripeStatus }) })).toEqual({
      providerRefundRef: "re_1Nispe2eZvKYlo2Cd31jOCgZ", correlationId: "ref_1", amount: { minorUnits: 500, currency: "USD" }, status,
    });
  });

  it.each([["no id", { id: null }], ["an unknown status", { status: "reversed" }], ["no amount", { amount: undefined }]])("is undefined for %s", (_l, overrides) => {
    expect(refundEvidence({ refund: refund(overrides) })).toBeUndefined();
  });
});

describe("disputeEvidence", () => {
  it.each([
    ["warning_needs_response", "open"], ["warning_under_review", "open"], ["needs_response", "open"], ["under_review", "open"],
    ["warning_closed", "won"], ["won", "won"], ["lost", "lost"],
  ])("%s → %s", (stripeStatus, status) => {
    expect(disputeEvidence({ dispute: dispute({ status: stripeStatus }) })).toMatchObject({ status });
  });

  it("dueBy is epoch ms, and absent without evidence_details.due_by", () => {
    expect(disputeEvidence({ dispute: dispute({}) })?.dueBy).toBe(1693612799_000);
    expect(disputeEvidence({ dispute: dispute({ evidence_details: { due_by: null } }) })).not.toHaveProperty("dueBy");
    expect(disputeEvidence({ dispute: dispute({ evidence_details: null }) })).not.toHaveProperty("dueBy");
  });

  it.each([["no id", { id: 1 }], ["an unknown status", { status: "prevented" }], ["a bad currency", { currency: null }]])("is undefined for %s", (_l, overrides) => {
    expect(disputeEvidence({ dispute: dispute(overrides) })).toBeUndefined();
  });
});

describe("amounts", () => {
  it("passes ordinary and three-decimal currencies through, and scales ISK/UGX by 100", () => {
    expect(amountToStripe({ money: { minorUnits: 1999, currency: "USD" } })).toBe(1999);
    expect(amountToStripe({ money: { minorUnits: 1000, currency: "JPY" } })).toBe(1000);
    expect(amountToStripe({ money: { minorUnits: 1230, currency: "KWD" } })).toBe(1230);
    expect(amountToStripe({ money: { minorUnits: 7, currency: "UGX" } })).toBe(700);
    expect(currencyToStripe({ money: { minorUnits: 1, currency: "EUR" } })).toBe("eur");
  });

  it("reads Stripe amounts back to Money, refusing a legacy two-decimal amount that does not end 00", () => {
    expect(moneyFromStripe({ amount: 700, currency: "ugx" })).toEqual({ minorUnits: 7, currency: "UGX" });
    expect(moneyFromStripe({ amount: 750, currency: "isk" })).toBeUndefined();
    expect(moneyFromStripe({ amount: 0, currency: "EUR" })).toEqual({ minorUnits: 0, currency: "EUR" });
    expect(moneyFromStripe({ amount: "100", currency: "usd" })).toBeUndefined();
  });
});

describe("readers", () => {
  it("idOf reads an id string or an expanded object", () => {
    expect(idOf("ch_1")).toBe("ch_1");
    expect(idOf({ id: "ch_2" })).toBe("ch_2");
    expect(idOf(null)).toBeUndefined();
    expect(idOf({})).toBeUndefined();
  });

  it("readAll is all-or-nothing", () => {
    const read = (item: Readonly<Record<string, unknown>>) => (typeof item.n === "number" ? item.n : undefined);
    expect(readAll({ items: [{ n: 1 }, { n: 2 }], read })).toEqual([1, 2]);
    expect(readAll({ items: [{ n: 1 }, {}], read })).toBeUndefined();
    expect(readAll({ items: [{ n: 1 }, 5], read })).toBeUndefined();
  });
});
