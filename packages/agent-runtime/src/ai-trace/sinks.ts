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

/** Fans one trace out to several backends (e.g. Langfuse + a local recorder) without either knowing. */
export function createFanOutAiTraceSink({ sinks }: { sinks: readonly AiTraceSink[] }): AiTraceSink {
  return {
    record: (event) => sinks.forEach((sink) => sink.record(event)),
    flush: async () => {
      await Promise.all(sinks.map((sink) => sink.flush?.()));
    },
    shutdown: async () => {
      await Promise.all(sinks.map((sink) => sink.shutdown?.()));
    },
  };
}

export const DEFAULT_LAZY_SINK_QUEUE = 1_000;

/**
 * A sink usable synchronously while its backend loads asynchronously (hosts build their run
 * lifecycle at module load; a vendor SDK is a dynamic import). Events queue until `load` settles,
 * bounded so a backend that never loads cannot grow memory; overflow drops the oldest event and
 * is counted in `dropped`. A rejected load degrades to noop and is reported once.
 */
export function createLazyAiTraceSink({ load }: { load: () => Promise<AiTraceSink> }, { maxQueued = DEFAULT_LAZY_SINK_QUEUE, onLoadError }: { maxQueued?: number; onLoadError?: (error: unknown) => void } = {}): AiTraceSink & { readonly ready: Promise<void>; readonly dropped: () => number } {
  let target: AiTraceSink | null = null;
  let queue: AiTraceEvent[] = [];
  let dropped = 0;
  const ready = load().then(
    (sink) => {
      target = sink;
      queue.forEach((event) => sink.record(event));
    },
    (error: unknown) => {
      target = noopAiTraceSink;
      onLoadError?.(error);
    },
  ).finally(() => {
    queue = [];
  });
  return {
    ready,
    dropped: () => dropped,
    record(event) {
      if (target) return target.record(event);
      if (queue.length >= maxQueued) {
        queue.shift();
        dropped += 1;
      }
      queue.push(event);
    },
    flush: async () => {
      await ready;
      await target?.flush?.();
    },
    shutdown: async () => {
      await ready;
      await target?.shutdown?.();
    },
  };
}
