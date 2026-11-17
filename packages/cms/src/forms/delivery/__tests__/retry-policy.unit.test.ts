/**
 * @file Unit tests for the delivery retry policy the outbox resolver hands to the worker (contract §4).
 */
import { describe, expect, test } from "vitest";
import { FormDeliveryError, formDeliveryRetryPolicy, formDeliveryStatusFromOutbox, type FormDeliveryRetryPolicy } from "../index.js";

const hostBackoff = ({ attempts }: { attempts: number; random: () => number }) => attempts * 10_000;
const policy = formDeliveryRetryPolicy({ backoffMs: hostBackoff, maxAttempts: 8 });
const random = () => 0.5;

describe("cap", () => {
  test("uses the host's maxAttempts", () => {
    expect(policy.maxAttempts).toBe(8);
  });
});

describe("retryable", () => {
  test("an explicit non-retryable delivery error is terminal at once", () => {
    expect(policy.retryable({ error: new FormDeliveryError({ code: "authorization-required", retryable: false }) })).toBe(false);
  });

  test("a retryable delivery error retries", () => {
    expect(policy.retryable({ error: new FormDeliveryError({ code: "rate-limited", retryable: true }) })).toBe(true);
  });

  test("any other error, such as a worker timeout, retries", () => {
    expect(policy.retryable({ error: new Error("delivery timed out after 60000ms") })).toBe(true);
  });
});

describe("backoffMs", () => {
  test("passes attempts and randomness to the host curve", () => {
    const seen: Array<{ attempts: number; random: () => number }> = [];
    const recording = formDeliveryRetryPolicy({ backoffMs: input => { seen.push(input); return 1; }, maxAttempts: 8 });
    recording.backoffMs({ attempts: 3, random, error: new Error("x") });
    expect(seen).toEqual([{ attempts: 3, random }]);
  });

  test("uses the host backoff when the error carries no retry hint", () => {
    expect(policy.backoffMs({ attempts: 2, random, error: new FormDeliveryError({ code: "delivery-failed", retryable: true }) })).toBe(20_000);
  });

  test("uses the host backoff for a non-delivery error", () => {
    expect(policy.backoffMs({ attempts: 2, random, error: new Error("timeout") })).toBe(20_000);
  });

  test("a longer adapter retryAfterMs lengthens the wait", () => {
    const error = new FormDeliveryError({ code: "rate-limited", retryable: true, retryAfterMs: 90_000 });
    expect(policy.backoffMs({ attempts: 2, random, error })).toBe(90_000);
  });

  test("a shorter adapter retryAfterMs never shortens the host backoff", () => {
    const error = new FormDeliveryError({ code: "rate-limited", retryable: true, retryAfterMs: 0 });
    expect(policy.backoffMs({ attempts: 2, random, error })).toBe(20_000);
  });

  test("an adapter cannot push the wait past the one-hour clamp", () => {
    const error = new FormDeliveryError({ code: "rate-limited", retryable: true, retryAfterMs: 86_400_000 });
    expect(policy.backoffMs({ attempts: 1, random, error })).toBe(3_600_000);
  });
});

/** The outbox worker's storing rule as a fake boundary (this package does not import infra):
 * a code is stored only when the policy lists it; anything else stores the class label. */
function storedLastError({ policy, error }: { policy: FormDeliveryRetryPolicy; error: unknown }): string {
  const code = policy.failureCodes.codeOf({ error });
  return code !== undefined && policy.failureCodes.codes.includes(code) ? code : "Error";
}

describe("failureCodes", () => {
  test("lists exactly the nine ledger codes", () => {
    expect([...policy.failureCodes.codes].sort()).toEqual([
      "adapter-unavailable", "authorization-required", "configuration-invalid", "delivery-failed", "destination-limit",
      "mapping-invalid", "outcome-unknown", "rate-limited", "resource-not-granted",
    ]);
  });

  test("a delivery error gives its own code", () => {
    expect(policy.failureCodes.codeOf({ error: new FormDeliveryError({ code: "rate-limited", retryable: true }) })).toBe("rate-limited");
  });

  test("a delivery error built with an unknown code gives delivery-failed", () => {
    expect(policy.failureCodes.codeOf({ error: new FormDeliveryError({ code: "Bearer sk-live-123", retryable: true }) })).toBe("delivery-failed");
  });

  test("any other error gives no code, even when it carries a listed code property", () => {
    expect(policy.failureCodes.codeOf({ error: Object.assign(new Error("offline"), { code: "rate-limited" }) })).toBeUndefined();
    expect(policy.failureCodes.codeOf({ error: "rate-limited" })).toBeUndefined();
  });

  test("every listed code reaches the status view through the stored row", () => {
    for (const code of policy.failureCodes.codes) {
      const lastError = storedLastError({ policy, error: new FormDeliveryError({ code, retryable: true }) });
      const row = { status: "pending" as const, attempts: 1, nextAttemptAt: "2026-02-21T12:00:15.000Z", lastError };
      expect(formDeliveryStatusFromOutbox({ row }).errorCode).toBe(code);
    }
  });

  test("a failure with no listed code is stored as its class and read back as delivery-failed", () => {
    const lastError = storedLastError({ policy, error: new Error("delivery timed out after 60000ms") });
    expect(lastError).toBe("Error");
    const row = { status: "failed" as const, attempts: 8, nextAttemptAt: "2026-02-21T12:00:15.000Z", lastError };
    expect(formDeliveryStatusFromOutbox({ row }).errorCode).toBe("delivery-failed");
  });
});
