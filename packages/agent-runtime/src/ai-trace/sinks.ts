/**
 * @module ai-trace/sinks
 * The two backend-free sinks: `noop` (tracing off costs one no-op call per event) and
 * `recording` (in-memory; tests, local debugging, and the swap-proof reference).
 */
import type { AiTraceEvent, AiTraceSink } from './types.js';

export const noopAiTraceSink: AiTraceSink = { record: () => {} };

export interface RecordingAiTraceSink extends AiTraceSink {
  readonly events: readonly AiTraceEvent[];
}

export function createRecordingAiTraceSink(_required: Record<string, never> = {}): RecordingAiTraceSink {
  const events: AiTraceEvent[] = [];
  return { events, record: (event) => void events.push(event) };
}

/**
 * Fans one trace out to several backends (e.g. Langfuse + a local recorder) without either knowing.
 * @param required - Independent backend ports; each is attempted even when an earlier one fails.
 * @param options - Optional failure reporter, itself guarded so logging cannot break a run.
 * @returns A port that contains record, flush, and shutdown failures per sink.
 * @complexity O(s) delivery and cleanup for s sinks; cleanup runs concurrently.
 */
export function createFanOutAiTraceSink({ sinks }: { sinks: readonly AiTraceSink[] }, { onSinkError }: { onSinkError?: (error: unknown) => void } = {}): AiTraceSink {
  return {
    record: (event) => {
      for (const sink of sinks) {
        try { sink.record(event); } catch (error) { reportError({ error, onError: onSinkError }); }
      }
    },
    flush: async () => {
      await Promise.all(sinks.map(async (sink) => {
        try { await sink.flush?.(); } catch (error) { reportError({ error, onError: onSinkError }); }
      }));
    },
    shutdown: async () => {
      await Promise.all(sinks.map(async (sink) => {
        try { await sink.shutdown?.(); } catch (error) { reportError({ error, onError: onSinkError }); }
      }));
    },
  };
}

export const DEFAULT_LAZY_SINK_QUEUE = 1_000;

/** Reporting is best effort too: a host logger must never turn a tracing failure into a run failure. */
export function reportError({ error, onError }: { error: unknown; onError: ((error: unknown) => void) | undefined }, _options: Record<string, never> = {}): void {
  try { onError?.(error); } catch { /* Tracing error reporting has no effect on application work. */ }
}

/**
 * A sink usable synchronously while its backend loads asynchronously (hosts build their run
 * lifecycle at module load; a vendor SDK is a dynamic import). Events queue until `load` settles,
 * bounded so a backend that never loads cannot grow memory; overflow drops the oldest event and
 * is counted in `dropped`. A rejected load degrades to noop and is reported once.
 * @param required - Backend factory; synchronous throws and rejected initialization are contained.
 * @param options - Queue bound, load-error reporter, and delivery/cleanup error reporter.
 * @returns A guarded sink whose `ready` fulfills after initialization and isolated queued replay.
 * @complexity O(q) replay and overflow eviction for a queue bounded to q events; O(1) live delivery.
 */
export function createLazyAiTraceSink({ load }: { load: () => Promise<AiTraceSink> }, { maxQueued = DEFAULT_LAZY_SINK_QUEUE, onLoadError, onSinkError }: { maxQueued?: number; onLoadError?: (error: unknown) => void; onSinkError?: (error: unknown) => void } = {}): AiTraceSink & { readonly ready: Promise<void>; readonly dropped: () => number } {
  let target: AiTraceSink | null = null;
  let queue: AiTraceEvent[] = [];
  let dropped = 0;
  function deliver(event: AiTraceEvent): void {
    try { target?.record(event); } catch (error) { reportError({ error, onError: onSinkError }); }
  }
  // Invoke load synchronously for existing hosts, but contain a synchronous throw as well as rejection.
  const loading = new Promise<AiTraceSink>((resolve) => resolve(load()));
  const ready = loading.then(
    (sink) => {
      target = sink;
      for (const event of queue) deliver(event);
    },
    (error: unknown) => {
      target = noopAiTraceSink;
      reportError({ error, onError: onLoadError });
    },
  ).finally(() => {
    queue = [];
  });
  return {
    ready,
    dropped: () => dropped,
    record(event) {
      if (target) return deliver(event);
      if (queue.length >= maxQueued) {
        queue.shift();
        dropped += 1;
      }
      queue.push(event);
    },
    flush: async () => {
      await ready;
      try { await target?.flush?.(); } catch (error) { reportError({ error, onError: onSinkError }); }
    },
    shutdown: async () => {
      await ready;
      try { await target?.shutdown?.(); } catch (error) { reportError({ error, onError: onSinkError }); }
    },
  };
}
