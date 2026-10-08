/** Host timers must invoke callbacks asynchronously; cancellation must be idempotent. */
export interface SchedulerPort {
  schedule(args: { readonly delayMs: number; readonly callback: () => void }): () => void;
}

/** Native host timers; an abandoned exchange must not keep a Node process alive by itself.
 * Cancellation is idempotent, and scheduling never invokes the callback synchronously. */
export function createTimeoutScheduler(
  _required: Record<string, never>,
  { keepAlive = false }: { readonly keepAlive?: boolean } = {},
): SchedulerPort {
  return {
    schedule({ delayMs, callback }) {
      const timer = setTimeout(callback, delayMs);
      // Exchanges may be abandoned; active start gates must keep their timeout alive until settlement.
    if (!keepAlive) timer.unref?.();
      return () => clearTimeout(timer);
    },
  };
}
