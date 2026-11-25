/**
 * @file The two routine errors callers branch on. A leaf module (imports nothing) so both the legacy
 * scheduler and the durable slot strategy can throw and recognize them without importing each other.
 */

/**
 * Distinguishes "a sibling daemon already won this scheduled slot, or the durable write itself
 * failed" from every other run-handler failure, so the scheduler can retry the same slot instead
 * of silently advancing to the next cadence (which would skip a fire the caller never actually
 * got).
 */
export class ScheduledRunPersistenceError extends Error {
  readonly routineId: string;
  readonly slotAt: number;
  readonly originalError: unknown;
  constructor({ routineId, slotAt, originalError }: { readonly routineId: string; readonly slotAt: number; readonly originalError: unknown }
  ) {
    super(`Routine ${routineId} scheduled slot ${slotAt} could not be persisted`);
    this.routineId = routineId;
    this.slotAt = slotAt;
    this.originalError = originalError;
    this.name = 'ScheduledRunPersistenceError';
  }
}

/**
 * A manual run (or a durable manual insert) lost to an already-active run of the same routine. The
 * HTTP layer maps it to 409 `ROUTINE_RUN_ACTIVE`; active means "until terminal settlement".
 */
export class RoutineActiveError extends Error {
  constructor() { super('Routine already has an active run'); this.name = 'RoutineActiveError'; }
}
