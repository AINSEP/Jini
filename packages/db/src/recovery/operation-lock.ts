import { nowIso as readNowIso, type Clock as ClockPort } from "@jini-ai/core/primitives";

/**
 * @file CIC U-001 (SPEC-019 `critical-internal-constraints.md`) — site-wide gated-operation
 * mutual exclusion (C-309; REQ-13, INV-03; GOV-ADR-002).
 *
 * Purpose:
 * The single, shared primitive both `features/database` (SPEC-017, migrate-forward) and
 * `features/recovery` (SPEC-019, restore) MUST consult before starting a gated operation. Two
 * domains racing to mutate the same site's `content.db` must never both be "in flight" — the
 * primitive tracks in-flight state per `siteId` only, never per-domain, so it cannot be defeated
 * by two domain-local checks that happen to look similar (U-001-B1).
 *
 * How it relates to the project:
 * `executeMigrateForward` and `executeRestore` both call `acquireOperationLock` as the provably
 * first side-effecting step of their own orchestration (U-001-ORD1), and `releaseOperationLock`
 * once the operation concludes (success or failure).
 *
 * Architectural role:
 * Core primitive. In-process only (host-shared instance registry) — a site's operations are already
 * serialized to a single process by `content.db`'s own single-writer model; this primitive adds
 * the cross-domain intent-level guard on top of that.
 *
 * ADR-041/043/044/045 re-audit (2026-07-16, TM-adr041-043-044-045-audit-001, Finding 3):
 * the internal verifier's original claim — "never wired into any composition root" — is false,
 * disproven by direct evidence: `server/routes/admin/database/migrate-forward.ts` and
 * `server/routes/admin/recovery/restore.ts` both import `acquireOperationLock`/
 * `releaseOperationLock` from this file directly and pass them into `executeMigrateForward`/
 * `executeRestore` (their `execute` endpoints only). The mutual-exclusion guarantee (U-001) is
 * real and live for both gated ceremonies today. The actual, narrower gap the re-audit surfaced:
 * this module had no read-only query, so `routes/admin/recovery/status.ts`'s capability bar
 * could not reflect live lock state and stubbed `operationInFlight: false` unconditionally.
 * `isOperationInFlight` below closes that display gap without changing the mutual-exclusion
 * mechanism itself.
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

/** One host-owned registry shared by migration, restore and display-only status readers. */
export interface SharedOperationLockPort {
  acquireOperationLock(required: { deps: { clock: ClockPort }; input: { siteId: string; operationKind: string } }, optional?: Record<string, never>): Promise<AcquireOperationLockResult>;
  releaseOperationLock(required: { deps: { clock: ClockPort }; input: { siteId: string; handle: OperationLockHandle } }, optional?: Record<string, never>): Promise<void>;
  isOperationInFlight(required: { siteId: string }, optional?: Record<string, never>): boolean;
}

/** Create one shared lock for all gated-operation domains in a host; separate hosts get isolated state. */
export function createOperationLock(_required: Record<string, never>, _optional: Record<string, never> = {}): SharedOperationLockPort {
  /** Instance-owned in-flight registry — one entry per `siteId` (CIC U-001-B1). */
  const activeLocksBySiteId = new Map<string, OperationLockHandle>();

  /**
   * Atomic check-and-set (U-001-B2): the presence check and the registry write happen in the same
   * synchronous span with no intervening `await`, so concurrent callers on Node's single-threaded
   * event loop (see the cross-domain property tests) cannot race a read-then-write gap — exactly
   * one caller ever observes an empty slot for a given `siteId`.
   *
   * @complexity O(1).
   */
  async function acquireOperationLock(
    required: { deps: { clock: ClockPort }; input: { siteId: string; operationKind: string } },
    _optional: Record<string, never> = {}
  ): Promise<AcquireOperationLockResult> {
    const { deps, input } = required;

    if (activeLocksBySiteId.has(input.siteId)) {
      return {
        ok: false,
        error: {
          code: "OPERATION_IN_FLIGHT",
          message: `an operation is already in flight for site '${input.siteId}'`,
        },
      };
    }

    const handle: OperationLockHandle = {
      siteId: input.siteId,
      operationKind: input.operationKind,
      acquiredAt: readNowIso({ clock: deps.clock }),
    };
    activeLocksBySiteId.set(input.siteId, handle);
    return { ok: true, value: handle };
  }

  /**
   * Frees `input.siteId`'s lock. Idempotent — releasing a site with no held lock is a no-op, never
   * an error. A stale holder cannot release a later acquisition for the same site.
   *
   * @complexity O(1).
   */
  async function releaseOperationLock(
    required: { deps: { clock: ClockPort }; input: { siteId: string; handle: OperationLockHandle } },
    _optional: Record<string, never> = {}
  ): Promise<void> {
    const { siteId, handle } = required.input;
    if (activeLocksBySiteId.get(siteId) === handle) activeLocksBySiteId.delete(siteId);
  }

  /**
   * Read-only peek at whether `siteId` currently holds a lock — never acquires, never mutates the
   * registry. For display/status surfaces only (e.g. Recovery's capability bar); gated ceremonies
   * must keep using `acquireOperationLock`'s atomic check-and-set, never this function, to decide
   * whether they may proceed (a peek-then-acquire pair would reintroduce the TOCTOU gap U-001-B2
   * exists to prevent).
   *
   * @complexity O(1).
   */
  function isOperationInFlight({ siteId }: { siteId: string }, _optional: Record<string, never> = {}): boolean {
    return activeLocksBySiteId.has(siteId);
  }
  return { acquireOperationLock, releaseOperationLock, isOperationInFlight };
}
