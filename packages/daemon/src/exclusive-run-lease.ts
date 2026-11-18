/** Outcome of asking for the lease: granted, or refused with the run that holds it. */
export type ExclusiveRunLeaseAcquisition =
  | { readonly granted: true }
  | { readonly granted: false; readonly holder: string };

/** One in-memory slot that at most one run holds at a time. Acquiring again as the holder is granted. */
export interface ExclusiveRunLease {
  acquire(required: { readonly runId: string }, optional?: Record<string, never>): ExclusiveRunLeaseAcquisition;
  /** Idempotent; releasing a run that is not the holder changes nothing. */
  release(required: { readonly runId: string }, optional?: Record<string, never>): void;
  holder(): string | undefined;
}

/** Pure and in-memory: the host creates one per scope that must serialize a scarce resource, and
 * releases it on every way a run can end. A lease never expires on its own, so a missed release
 * is the host's bug to fix, not something a timer hides. */
export function createExclusiveRunLease(_required: Record<string, never>): ExclusiveRunLease {
  let holder: string | undefined;
  return {
    acquire({ runId }) {
      if (holder !== undefined && holder !== runId) return { granted: false, holder };
      holder = runId;
      return { granted: true };
    },
    release({ runId }) {
      if (holder === runId) holder = undefined;
    },
    holder: () => holder,
  };
}
