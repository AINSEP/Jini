/** The simulated-latency resolver every in-memory feature port double uses: 0 (default) resolves on the next microtask, otherwise after `latencyMs`. */
export type FakeLatencyDelay = <T>({ value }: { value: T }, _optional?: Record<string, never>) => Promise<T>;

/** Creates a resolver that settles values without a timer or after the configured delay. */
export function fakeLatencyDelay(_required: Record<string, never> = {}, { latencyMs = 0 }: { latencyMs?: number | undefined } = {}): FakeLatencyDelay {
  return <T>({ value }: { value: T }, _optional: Record<string, never> = {}): Promise<T> =>
    latencyMs > 0 ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs)) : Promise.resolve(value);
}
