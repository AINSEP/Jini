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
