/**
 * @file Pins how a binding's status is read off its outbox row (contract §6). `claimPending`
 * increments `attempts` before an attempt runs, so a `processing` row with attempts 1 is the FIRST
 * attempt in flight, not a retry.
 */
import { describe, expect, test } from "vitest";
import { formDeliveryStatusFromOutbox } from "../index.js";

const due = "2026-10-20T00:05:00.000Z";
const read = (status: "pending" | "processing", attempts: number) =>
  formDeliveryStatusFromOutbox({ row: { status, attempts, nextAttemptAt: due, lastError: null } });

describe("in-flight and waiting rows", () => {
  test("the first attempt in flight (processing, attempts 1) reads pending", () => {
    expect(read("processing", 1)).toEqual({ status: "pending", attempts: 1, nextRetryAt: null, errorCode: null });
  });

  test("a later attempt in flight (processing, attempts 2) reads retrying with no retry time", () => {
    expect(read("processing", 2)).toEqual({ status: "retrying", attempts: 2, nextRetryAt: null, errorCode: null });
  });

  test("a never-claimed row (pending, attempts 0) reads pending", () => {
    expect(read("pending", 0)).toEqual({ status: "pending", attempts: 0, nextRetryAt: null, errorCode: null });
  });

  test("a row waiting after a failed attempt (pending, attempts 1) reads retrying with its due time", () => {
    expect(read("pending", 1)).toEqual({ status: "retrying", attempts: 1, nextRetryAt: due, errorCode: null });
  });
});

describe("settled rows", () => {
  test("a delivered row reads completed and hides any earlier error", () => {
    expect(formDeliveryStatusFromOutbox({ row: { status: "delivered", attempts: 3, nextAttemptAt: due, lastError: "rate-limited" } }))
      .toEqual({ status: "completed", attempts: 3, nextRetryAt: null, errorCode: null });
  });

  test("a failed row reads failed with its safe code and no retry time", () => {
    expect(formDeliveryStatusFromOutbox({ row: { status: "failed", attempts: 1, nextAttemptAt: due, lastError: "authorization-required" } }))
      .toEqual({ status: "failed", attempts: 1, nextRetryAt: null, errorCode: "authorization-required" });
  });

  test("a failed row sealed by the worker's own message reads delivery-failed", () => {
    const row = { status: "failed" as const, attempts: 9, nextAttemptAt: due,
      lastError: "claimed 9 times; the last claim expired with no recorded outcome (its claimer likely died mid-delivery)" };
    expect(formDeliveryStatusFromOutbox({ row }).errorCode).toBe("delivery-failed");
  });
});

describe("error code on unsettled rows", () => {
  test("a waiting retry reports the safe code of its last failure", () => {
    expect(formDeliveryStatusFromOutbox({ row: { status: "pending", attempts: 2, nextAttemptAt: due, lastError: "rate-limited" } }).errorCode)
      .toBe("rate-limited");
  });

  test("a later attempt in flight still reports the previous failure's code", () => {
    expect(formDeliveryStatusFromOutbox({ row: { status: "processing", attempts: 3, nextAttemptAt: due, lastError: "outcome-unknown" } }))
      .toEqual({ status: "retrying", attempts: 3, nextRetryAt: null, errorCode: "outcome-unknown" });
  });

  test("an absent or empty lastError reads as no code", () => {
    expect(formDeliveryStatusFromOutbox({ row: { status: "pending", attempts: 1, nextAttemptAt: due } }).errorCode).toBeNull();
    expect(formDeliveryStatusFromOutbox({ row: { status: "pending", attempts: 1, nextAttemptAt: due, lastError: "" } }).errorCode).toBeNull();
  });
});
