/**
 * @file The shared gated-operation lock's data shapes: the handle a holder keeps and the result of an
 * acquire attempt. The lock itself (one host-shared, in-process registry keyed by `siteId`) lives in
 * `@jini-ai/db/recovery/operation-lock`; these types sit in core so any package can name a lock
 * handle or acquire result without depending on the db package.
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
