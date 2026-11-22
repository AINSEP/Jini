/**
 * @file SPEC-016 C-004 / U-002-B1 — the dialect-neutral half of the site-wide gated-mutation write
 * watermark: the transaction-boundary guard every concrete stamping adapter is built on.
 *
 * Purpose:
 * `stampWatermark` only inspects `OpenTransactionHandle.isOpen` and invokes `increment()` — it
 * never touches a schema, a table, or a SQL dialect, which is what lets it live in `core` without
 * creating a dependency on `db`. The real stamp, read and boot-time mirror reconciliation run on the
 * content kernel, every dialect (`platform/db/watermark-kernel.ts`: `kernelStampWatermark`,
 * `readKernelWatermark`, `reconcileMirror`; SPEC-016 C-004/U-004/REQ-01/REQ-04/REQ-05/INV-01). Since
 * R1h no production path adapts a transaction to this guard; it is kept with its unit test as the
 * contract's reference shape.
 *
 * Architectural role:
 * Core primitive shared by every gated-mutation domain (database, recovery, ...); no domain-specific
 * or dialect-specific knowledge here.
 */

/**
 * Opaque transaction-boundary guard. Real callers pass the concrete SQLite/Postgres transaction
 * object; `stampWatermark` only inspects `isOpen` and invokes `increment()`.
 */
export interface OpenTransactionHandle {
  readonly isOpen: true;
  /** Performs the actual +1 write against the open transaction and returns the new value. */
  increment(): number;
}

/** Thrown when `stampWatermark` is called without an open transaction (U-002-B1). */
export class WatermarkTransactionRequiredError extends Error {}

/**
 * Advances the watermark by exactly 1 using the caller-supplied transaction handle. Throws
 * `WatermarkTransactionRequiredError` rather than silently succeeding outside an open transaction
 * (AC-02/U-002-B1) — a watermark stamp with no transaction backing it can never be atomic with the
 * sibling mutation it is meant to certify.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function stampWatermark(
  required: { tx: OpenTransactionHandle | null },
  _optional: Record<string, never> = {}
): { newValue: number } {
  const { tx } = required;
  if (!tx || !tx.isOpen) {
    throw new WatermarkTransactionRequiredError(
      "stampWatermark must be called with an open transaction handle"
    );
  }
  return { newValue: tx.increment() };
}
