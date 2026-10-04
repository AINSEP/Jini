export interface ToastMessage { readonly id: string; readonly message: string; readonly tone?: 'info' | 'success' | 'warning' | 'danger'; readonly durationMs?: number }
export interface ToastScheduler {
  schedule(required: { delayMs: number; run: (required: Record<string, never>, optional?: Record<string, never>) => void }, optional?: Record<string, never>): unknown;
  cancel(required: { ticket: unknown }, optional?: Record<string, never>): void;
}
export interface ToastService {
  push(required: Omit<ToastMessage, 'id'>, optional?: { id?: string }): string;
  dismiss(required: { id: string }, optional?: Record<string, never>): void;
  snapshot(required: Record<string, never>, optional?: Record<string, never>): readonly ToastMessage[];
  subscribe(required: { listener: (required: Record<string, never>, optional?: Record<string, never>) => void }, optional?: Record<string, never>): () => void;
  dispose(required: Record<string, never>, optional?: Record<string, never>): void;
}
const defaultScheduler: ToastScheduler = {
  schedule: ({ delayMs, run }) => setTimeout(() => run({}), delayMs),
  cancel: ({ ticket }) => clearTimeout(ticket as ReturnType<typeof setTimeout>),
};
/** Instance-local queues avoid mixing messages between hosts and SSR requests. */
export function createToastService(_required: Record<string, never>, optional: { scheduler?: ToastScheduler; durationMs?: number } = {}): ToastService {
  const scheduler = optional.scheduler ?? defaultScheduler;
  let messages: readonly ToastMessage[] = Object.freeze([]), sequence = 0, disposed = false;
  const listeners = new Set<(required: Record<string, never>) => void>(), timers = new Map<string, unknown>();
  function emit() { for (const listener of listeners) listener({}); }
  function dismiss({ id }: { id: string }, _optional: Record<string, never> = {}) {
    if (timers.has(id)) { scheduler.cancel({ ticket: timers.get(id) }); timers.delete(id); }
    if (!messages.some(message => message.id === id)) return;
    messages = Object.freeze(messages.filter(message => message.id !== id)); emit();
  }
  return Object.freeze({
    push(input: Omit<ToastMessage, 'id'>, opts: { id?: string } = {}) {
      if (disposed) throw new Error('Toast service is disposed');
      const id = opts.id ?? `toast-${++sequence}`;
      dismiss({ id }); messages = Object.freeze([...messages, Object.freeze({ ...input, id })]); emit();
      const delayMs = input.durationMs ?? optional.durationMs ?? 5000;
      if (delayMs > 0) timers.set(id, scheduler.schedule({ delayMs, run: () => dismiss({ id }) }));
      return id;
    },
    dismiss,
    snapshot(_required: Record<string, never>, _optional: Record<string, never> = {}) { return messages; },
    subscribe({ listener }: { listener: (required: Record<string, never>, optional?: Record<string, never>) => void }, _optional: Record<string, never> = {}) {
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    dispose(_required: Record<string, never>, _optional: Record<string, never> = {}) {
      disposed = true;
      for (const ticket of timers.values()) scheduler.cancel({ ticket });
      timers.clear(); messages = Object.freeze([]); emit(); listeners.clear();
    },
  });
}
