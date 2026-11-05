import type { UserFacingError } from '@jini-ai/core';

/** One retained incident per host instance; no history, timers, requests or persistence. */
export interface FailureChannel {
  publish(input: { failure: UserFacingError; generation?: number }): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): UserFacingError | null;
  getGeneration(): number;
  reset(): void;
}

/**
 * Create a host-owned external store for the final unexpected failure after transport retries.
 * Reset invalidates pending work across identity/site changes, including when no incident is shown.
 * Optional publication effects are injected; the store itself performs only synchronous notification.
 * @complexity O(s) time per publish/reset for s subscribers; O(s + one bounded failure) retained space.
 */
export function createFailureChannel(
  _requiredArgs: Record<string, never>,
  { onPublish }: { onPublish?: (input: { failure: UserFacingError }) => void } = {},
): FailureChannel {
  let snapshot: UserFacingError | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    publish({ failure, generation: sourceGeneration = generation }) {
      if (sourceGeneration !== generation) return;
      snapshot = failure;
      notify();
      onPublish?.({ failure });
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getGeneration: () => generation,
    reset() { generation += 1; snapshot = null; notify(); },
  };
}
