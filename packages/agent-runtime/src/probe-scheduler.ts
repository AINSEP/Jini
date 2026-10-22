type Priority = 'version' | 'metadata';

/** All metadata process adapters share one process-wide slot. Version checks precede queued
 * metadata, so expensive discovery cannot delay cheap availability checks. Actual chat runs
 * never use this queue. A slot is held until the child adapter settles, including cancellation.
 * @complexity O(q) queued selection, bounded by the runtime registry's probe count. */
export function createProbeScheduler(_input: Record<string, never>, _options: Record<string, never> = {}) {
  const queue: { priority: Priority; start: () => void }[] = [];
  let running = false;
  function drain(): void {
    if (running || !queue.length) return;
    const version = queue.findIndex(entry => entry.priority === 'version');
    const entry = queue.splice(version < 0 ? 0 : version, 1)[0]!;
    running = true; entry.start();
  }
  return function schedule<T>(
    { work }: { work: () => Promise<T> },
    { priority = 'metadata', signal }: { priority?: Priority; signal?: AbortSignal | undefined } = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push({ priority, start: () => {
        Promise.resolve().then(() => {
          if (signal?.aborted) throw new Error('Probe cancelled');
          return work();
        }).then(resolve, reject).finally(() => { running = false; drain(); });
      } });
      drain();
    });
  };
}
export const scheduleProbeProcess = createProbeScheduler({});
