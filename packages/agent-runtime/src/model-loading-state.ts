/** Mutable state owned by one cache instance and one key. */
export interface ModelLoadingState {
  inFlight: Promise<void> | null;
}

/** Shares one load until it settles. Install the promise before invoking the collaborator so a synchronous completion cannot leave a stuck in-flight entry. The load callback owns error policy; an uncaught load error rejects the shared promise. Local work and space are O(1). */
export function coalesceModelLoad({ state, load }: { state: ModelLoadingState; load: () => Promise<void> }): Promise<void> {
  if (state.inFlight) return state.inFlight;
  let finish!: () => void;
  let fail!: (error: unknown) => void;
  const pending = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  state.inFlight = pending;
  void (async () => {
    try {
      await load();
      finish();
    } catch (error) {
      fail(error);
    } finally {
      state.inFlight = null;
    }
  })();
  return pending;
}
