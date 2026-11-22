import assert from "node:assert/strict";
import { test } from "vitest";

import { WatermarkTransactionRequiredError, stampWatermark } from "../watermark.js";

/**
 * @file SPEC-016 C-004 / U-002-B1 / REQ-01 / AC-01 / AC-02 — watermark stamping's transaction guard.
 *
 * Assumed seam design (TDD-authored, consistent with implementation-outline.md's Contract Map):
 *
 * ```ts
 * export interface OpenTransactionHandle {
 *   readonly isOpen: true;
 *   // opaque — the concrete SQLite/Postgres transaction object; unit tests use a fake.
 * }
 *
 * export class WatermarkTransactionRequiredError extends Error {}
 *
 * export function stampWatermark(
 *   required: { tx: OpenTransactionHandle | null },
 *   optional?: {}
 * ): { newValue: number };
 * ```
 *
 * This unit-level suite tests only the transaction-boundary guard (U-002-B1's "throws rather than
 * silently succeeding if called outside an open transaction" half) using a fake transaction
 * handle. The same-transaction atomicity guarantee itself (U-002-B2, INV-01, EC-01) requires a
 * real database and is certified by `__tests__/integration/watermark-transaction.integration.test.ts`.
 */

test("AC-02 / U-002-B1: stampWatermark rejects when called outside an open transaction", () => {
  assert.throws(
    () => stampWatermark({ tx: null }),
    (err: unknown) => {
      assert.ok(err instanceof WatermarkTransactionRequiredError);
      return true;
    }
  );
});

test("behavior.spec.md §4: watermark per-transaction increment limit is exactly 1 per stampWatermark call", () => {
  let counter = 0;
  const fakeTx = {
    isOpen: true as const,
    increment: () => {
      counter += 1;
      return counter;
    },
  };
  const result = stampWatermark({ tx: fakeTx });
  assert.equal(result.newValue, 1);
  assert.equal(counter, 1, "a single stampWatermark call must increment exactly once, never twice");
});

test('stampWatermark rejects a closed non-null transaction before incrementing', () => {
  let increments = 0;
  const tx = { isOpen: false, increment: () => ++increments };
  assert.throws(() => stampWatermark({ tx: tx as unknown as Parameters<typeof stampWatermark>[0]['tx'] }), WatermarkTransactionRequiredError);
  assert.equal(increments, 0);
});
