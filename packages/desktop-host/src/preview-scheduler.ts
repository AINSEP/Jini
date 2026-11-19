import { orFallback } from "@jini-ai/core/errors/idioms";

/** Coalesce readiness events for a public visit, resolve the server when the debounce fires,
 * and allow the next visit to refresh. Cancellation invalidates in-flight captures too.
 * Capture and timers are ports; this module does no I/O itself. */
export interface PreviewSchedulerPorts<Timer, Target> {
  readonly current: (required: { key: string }, optional: {}) => Target | undefined;
  readonly capture: (required: Target, optional: { isCurrent?: () => boolean }) => Promise<boolean>;
  readonly schedule: (required: { work: () => void; delayMs: number }, optional: {}) => Timer;
  readonly cancel: (required: { timer: Timer }, optional: {}) => void;
}

export function createPreviewScheduler<Timer, Target>(
  { ports }: { ports: PreviewSchedulerPorts<Timer, Target> }, { debounceMs = 1500 }: { debounceMs?: number } = {},
): { schedule(required: { key: string }, optional?: {}): void; cancel(required: { key: string }, optional?: {}): void } {
  const attempts = new Map<string, { timer?: Timer }>();

  async function fire({ key, attempt }: { key: string; attempt: { timer?: Timer } }, _optional = {}): Promise<void> {
    if (attempts.get(key) !== attempt) return;
    attempt.timer = undefined;
    const target = ports.current({ key }, {});
    if (!target) { attempts.delete(key); return; }
    // A preview is decoration. A failed port must neither fail Start nor reserve a retry.
    await orFallback({ work: () => ports.capture(target, { isCurrent: () => attempts.get(key) === attempt }), fallback: false, step: "capture preview" });
    // A stop/restart can replace this attempt while capture awaits; its completion owns no
    // state in the replacement lifecycle, whether it succeeded or failed.
    if (attempts.get(key) === attempt) attempts.delete(key);
  }

  return {
    schedule({ key }: { key: string }, _optional = {}): void {
      if (attempts.has(key)) return;
      const attempt: { timer?: Timer } = {};
      // Coalesce one visit's readiness events; the next public visit may refresh even after success.
      attempts.set(key, attempt);
      attempt.timer = ports.schedule({ work: () => { void fire({ key, attempt }); }, delayMs: debounceMs }, {});
    },
    cancel({ key }: { key: string }, _optional = {}): void {
      const attempt = attempts.get(key);
      if (attempt?.timer !== undefined) ports.cancel({ timer: attempt.timer }, {});
      attempts.delete(key);
    },
  };
}
