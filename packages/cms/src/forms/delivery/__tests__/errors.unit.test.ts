/**
 * @file Unit tests for the ledger-safe error: every field an adapter hands over is re-validated, so
 * only an allowlisted code, a bounded retry hint and a known outcome survive into the outbox.
 */
import { describe, expect, test } from "vitest";
import { FORM_DELIVERY_MAX_RETRY_AFTER_MS, FormDeliveryError, type FormDeliveryErrorCode } from "../index.js";
import { safeFormDeliveryErrorCode } from "../errors.js";

const CODES: FormDeliveryErrorCode[] = [
  "authorization-required", "rate-limited", "configuration-invalid", "mapping-invalid", "resource-not-granted",
  "destination-limit", "outcome-unknown", "adapter-unavailable", "delivery-failed",
];

describe("safeFormDeliveryErrorCode", () => {
  test.each(CODES)("keeps the allowlisted code %s", code => {
    expect(safeFormDeliveryErrorCode({ code })).toBe(code);
  });

  test.each([["an unknown string", "timed out after 60000ms"], ["a number", 401], ["null", null], ["undefined", undefined], ["an object", { code: "rate-limited" }]])(
    "maps %s to delivery-failed", (_label, code) => {
      expect(safeFormDeliveryErrorCode({ code })).toBe("delivery-failed");
    });

  test("does not accept a code that only differs in case", () => {
    expect(safeFormDeliveryErrorCode({ code: "Rate-Limited" })).toBe("delivery-failed");
  });
});

describe("FormDeliveryError", () => {
  test("is an Error whose name is FormDeliveryError and whose message is the bare code", () => {
    const error = new FormDeliveryError({ code: "mapping-invalid", retryable: false });
    expect(error).toBeInstanceOf(Error);
    expect([error.name, error.message, error.code]).toEqual(["FormDeliveryError", "mapping-invalid", "mapping-invalid"]);
  });

  test("a recognised code with retryable false is terminal", () => {
    expect(new FormDeliveryError({ code: "authorization-required", retryable: false }).retryable).toBe(false);
  });

  test("a recognised code with retryable true stays retryable", () => {
    expect(new FormDeliveryError({ code: "rate-limited", retryable: true }).retryable).toBe(true);
  });

  test("a non-boolean retryable from untyped plugin code counts as retryable", () => {
    // Malformed on purpose: `.mjs` adapters are not type-checked.
    const input = { code: "rate-limited", retryable: "no" } as unknown as ConstructorParameters<typeof FormDeliveryError>[0];
    expect(new FormDeliveryError(input).retryable).toBe(true);
  });

  test("an unknown code is forced retryable even when the adapter said not to retry", () => {
    const error = new FormDeliveryError({ code: "gone-forever", retryable: false });
    expect([error.code, error.retryable]).toEqual(["delivery-failed", true]);
  });

  test("keeps a finite nonnegative retryAfterMs, including zero", () => {
    expect(new FormDeliveryError({ code: "rate-limited", retryable: true, retryAfterMs: 0 }).retryAfterMs).toBe(0);
    expect(new FormDeliveryError({ code: "rate-limited", retryable: true, retryAfterMs: 2_500 }).retryAfterMs).toBe(2_500);
  });

  test("clamps retryAfterMs to one hour", () => {
    expect(FORM_DELIVERY_MAX_RETRY_AFTER_MS).toBe(3_600_000);
    const error = new FormDeliveryError({ code: "rate-limited", retryable: true, retryAfterMs: 7 * 24 * 3_600_000 });
    expect(error.retryAfterMs).toBe(FORM_DELIVERY_MAX_RETRY_AFTER_MS);
  });

  test.each([["negative", -1], ["NaN", Number.NaN], ["infinite", Number.POSITIVE_INFINITY]])("drops a %s retryAfterMs", (_label, retryAfterMs) => {
    const error = new FormDeliveryError({ code: "rate-limited", retryable: true, retryAfterMs });
    expect(error.retryAfterMs).toBeUndefined();
  });

  test("drops a non-number retryAfterMs from untyped plugin code", () => {
    // Malformed on purpose: a header string passed straight through by a plugin.
    const input = { code: "rate-limited", retryable: true, retryAfterMs: "120" } as unknown as ConstructorParameters<typeof FormDeliveryError>[0];
    expect(new FormDeliveryError(input).retryAfterMs).toBeUndefined();
  });

  test.each(["not-applied", "unknown"] as const)("keeps the outcome %s", outcome => {
    expect(new FormDeliveryError({ code: "outcome-unknown", retryable: true, outcome }).outcome).toBe(outcome);
  });

  test("drops an outcome outside the two known values", () => {
    // Malformed on purpose: free text from a plugin must not reach the ledger.
    const input = { code: "outcome-unknown", retryable: true, outcome: "applied twice" } as unknown as ConstructorParameters<typeof FormDeliveryError>[0];
    expect(new FormDeliveryError(input).outcome).toBeUndefined();
  });
});
