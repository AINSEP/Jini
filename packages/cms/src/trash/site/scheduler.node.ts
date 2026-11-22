import type { TrashSchedulerPort } from "../index.js";

/** Native timers stay in the serving host: unref prevents an idle sweeper keeping a process alive. */
export function createTrashScheduler(_required: Record<string, never>, _optional: Record<string, never> = {}): TrashSchedulerPort {
  const timers = new Map<unknown, ReturnType<typeof setTimeout>>();
  return {
    schedule({ delayMs, run }) {
      const timer = setTimeout(() => { timers.delete(timer); run(); }, delayMs);
      timer.unref();
      timers.set(timer, timer);
      return timer;
    },
    cancel({ handle }) {
      const timer = timers.get(handle);
      if (timer) { clearTimeout(timer); timers.delete(handle); }
    },
  };
}
