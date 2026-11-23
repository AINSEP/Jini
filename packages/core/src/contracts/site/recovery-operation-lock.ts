/**
 * @file Site-wide gated-operation mutual-exclusion lock handle and result shapes. Types only.
 *
 * Additive copy of `OperationLockHandle`, `OperationLockError` and `AcquireOperationLockResult` from
 * `@jini-ai/db/recovery/operation-lock`. The lock factory (`createOperationLock`) and its shared
 * port stay in db, which keeps its identical declarations and exports until the paired cutover.
 *
 * The lock tracks in-flight state per `siteId` only, never per-domain, so two domains racing to
 * mutate the same site (for example migrate-forward and restore) cannot both be "in flight".
 */

export interface OperationLockHandle {
  siteId: string;
  operationKind: string;
  /** ISO-8601 UTC. */
  acquiredAt: string;
}

export interface OperationLockError {
  code: "OPERATION_IN_FLIGHT";
  message: string;
}

export type AcquireOperationLockResult =
  | { ok: true; value: OperationLockHandle }
  | { ok: false; error: OperationLockError };
