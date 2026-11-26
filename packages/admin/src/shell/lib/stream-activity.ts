/** Reference-counted chat activity for this document, including concurrent panes. */
import type { ChatTransport, RunHandlers, ChatMessage, DurableRunBinding, DurableSubscriptionPorts } from "../../react/kit.js";

export interface StreamActivity {
  active(required: Record<string, never>, optional?: Record<string, never>): boolean;
  retain(required: Record<string, never>, optional?: Record<string, never>): () => void;
  subscribe(required: { listener: () => void }, optional?: Record<string, never>): () => void;
}

/** Each retain has an idempotent release; the last release notifies idle stream owners.
 * @complexity O(listeners) per transition, O(active runs + listeners) space.
 */
export function createStreamActivity(_required = {}, _optional = {}): StreamActivity {
  let count = 0;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  return {
    active: () => count > 0,
    retain: () => {
      count++;
      notify();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        count -= 1;
        notify();
      };
    },
    subscribe: ({ listener }) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** Composition-root document instance; transports and page-control share this exact owner. */
export const adminStreamActivity = createStreamActivity({});

/** Private host lifecycle carried through Jini's unchanged RunHandlers contract. */
export const subscriptionEnded = Symbol("subscription-ended");
export type TrackedRunHandlers = RunHandlers & { [subscriptionEnded]?: () => void };

/** Jini owns recovery, continuation, polling and terminal disposal. A missing durable row ends
 * this browser subscription without onDone, so release the host's page-stream retain as well.
 */
export function followDurableRun({ deps, ...required }: {
  runId: string;
  handlers: TrackedRunHandlers & { onCheckpoint?: (message: ChatMessage) => void };
  signal?: AbortSignal;
  binding?: DurableRunBinding;
  ports: DurableSubscriptionPorts;
  deps: { follow: (required: Omit<Parameters<typeof followDurableRun>[0], "deps">, optional: {}) => () => void };
}, optional = {}): () => void {
  const endActivity = () => (required.handlers as TrackedRunHandlers)[subscriptionEnded]?.();
  const stop = deps.follow({ ...required, ports: {
    ...required.ports,
    read: async (input, options) => {
      const message = await required.ports.read(input, options);
      if (message === "gone") endActivity();
      return message;
    },
  } }, optional);
  return () => { stop(); endActivity(); };
}

/** Keep page-control available from dispatch through terminal completion, across all transports.
 * Transient onError notifications do not end a durable run; onDone, detach, or dispatch rejection do.
 * @returns The same transport API with tracked start/reattach lifetimes.
 * @complexity O(1) per run plus activity listeners; no additional network requests.
 */
export function trackTransportActivity(
  { transport, activity }: { transport: ChatTransport; activity: StreamActivity }, _optional = {},
): ChatTransport {
  async function track<Result>(
    { handlers, signal, work }: { handlers: RunHandlers; signal: AbortSignal | undefined; work: (tracked: RunHandlers) => Promise<Result> },
    _options = {},
  ): Promise<Result> {
    const release = activity.retain({});
    const finish = () => { signal?.removeEventListener("abort", finish); release(); };
    if (signal?.aborted) finish();
    else signal?.addEventListener("abort", finish, { once: true });
    try {
      const tracked: TrackedRunHandlers = { ...handlers, [subscriptionEnded]: finish,
        onDone: (events) => { finish(); handlers.onDone(events); } };
      return await work(tracked);
    } catch (error) { finish(); throw error; }
  }
  return {
    ...transport,
    startRun: (input, handlers) => track({ handlers, signal: input.signal, work: (tracked) => transport.startRun(input, tracked) }),
    reattachRun: (runId, handlers, options) => track({ handlers, signal: options?.signal, work: (tracked) => transport.reattachRun(runId, tracked, options) }),
  };
}
