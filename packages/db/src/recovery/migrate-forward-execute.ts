import type { Clock as ClockPort } from "@jini-ai/core/primitives";

/**
 * @file SPEC-017 C-105 / CIC U-003 (binding reference to SPEC-019 CIC U-001) / REQ-08 / AC-09 /
 * AC-41 / AC-42 — the `executeMigrateForward` orchestration wrapper (ADR-041 §3).
 *
 * Purpose:
 * Wires the cross-domain shared operation lock (`core/operation-lock.ts`, designated/tested by
 * SPEC-019) and the `costClass: 'unavailable'` refusal (REQ-08) around the actual gated mutation.
 * This module does not implement or test the lock primitive itself, nor the state machine or
 * `core/gated-mutations.execute()` sequence — `gatewayExecute` is the caller's own composition of
 * those (typically closing over the state machine's `advance()` and the gateway's `execute()`).
 *
 * How it relates to the project:
 * `costClass === 'unavailable'` is checked BEFORE the lock is ever consulted (AC-09) — refusing
 * before any side effect runs, so no lock is ever left held for a migration that was always going
 * to be refused. The lock is acquired strictly before `gatewayExecute()` runs (U-003-ORD1) and
 * released in a `finally`, so a mutation failure never leaks a held site-wide lock.
 *
 * Architectural role:
 * `features/database` domain logic, composing `core/operation-lock.ts`'s port shape. No clock is
 * supplied by this module's own caller contract, so a plain wall-clock default is used for the
 * lock's own timestamping, using the shared millisecond clock port so the lock can format its
 * timestamp through the kernel's ISO helper.
 */

const defaultClock: ClockPort = { nowMs: () => Date.now() };

export interface OperationLockAcquireResult {
  ok: true;
  value: { siteId: string; operationKind: string; acquiredAt: string };
}

export interface OperationLockAcquireFailure {
  ok: false;
  error: { code: string; message?: string };
}

export interface OperationLockPort {
  acquireOperationLock(params: {
    deps: { clock: ClockPort };
    input: { siteId: string; operationKind: "migration" | "restore" };
  }): Promise<OperationLockAcquireResult | OperationLockAcquireFailure>;
  releaseOperationLock(params: { deps: { clock: ClockPort }; input: { siteId: string; handle: unknown } }): Promise<void>;
}

/** Thrown when the shared cross-domain operation lock rejects the acquire (site already has a migration/restore in flight). */
export class MigrationAlreadyInFlightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationAlreadyInFlightError";
  }
}

/** Thrown when `costClass === 'unavailable'` — the in-product migrate is refused with no bypass. */
export class RestorePointUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestorePointUnavailableError";
  }
}

/**
 * Orchestrates a forward-migrate execution: refuses `costClass: 'unavailable'` outright, acquires
 * the shared cross-domain lock (U-003-ORD1), runs the caller's gated mutation, and always releases
 * the lock afterward.
 *
 * @complexity O(1) plus the lock acquire/release and the injected `gatewayExecute()` call.
 */
export async function executeMigrateForward(
  required: {
    siteId: string;
    confirmationToken: string;
    costClass: "cheap" | "expensive" | "unavailable";
    operationLock: OperationLockPort;
    gatewayExecute: () => Promise<{ migrated: true }>;
  },
  { clock = defaultClock }: { clock?: ClockPort } = {}
): Promise<{ migrated: true }> {
  const { siteId, costClass, operationLock, gatewayExecute } = required;

  if (costClass === "unavailable") {
    throw new RestorePointUnavailableError(
      `site '${siteId}' has costClass 'unavailable' — the in-product forward migrate is refused with no attestation override`
    );
  }

  const acquireResult = await operationLock.acquireOperationLock({
    deps: { clock },
    input: { siteId, operationKind: "migration" },
  });
  if (!acquireResult.ok) {
    throw new MigrationAlreadyInFlightError(
      `site '${siteId}': ${acquireResult.error.message ?? acquireResult.error.code} — a migration or restore is already in flight`
    );
  }

  try {
    return await gatewayExecute();
  } finally {
    await operationLock.releaseOperationLock({
      deps: { clock },
      input: { siteId, handle: acquireResult.value },
    });
  }
}
