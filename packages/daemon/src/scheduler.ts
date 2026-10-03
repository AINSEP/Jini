/** Host timers must invoke callbacks asynchronously; cancellation must be idempotent. */
export interface SchedulerPort {
  schedule(args: { readonly delayMs: number; readonly callback: () => void }): () => void;
}
