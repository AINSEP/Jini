import type { AiTraceModelTurn, AiTraceSink } from "@jini-ai/agent-runtime/ai-trace";
import type { ProductAiGeneration, ProductAnalyticsPort, ProductEventProperties } from "./index.js";

/** Pure model-turn projection; unknown counters are omitted, timing is converted from ms to seconds.
 * @complexity O(1), a fixed metadata bag and no retained text. */
function generationOf({ event, provider, userId }: { event: AiTraceModelTurn; provider: string | null; userId: string }, { includeContent = false }: { includeContent?: boolean } = {}): ProductAiGeneration {
  const metadata = {
    model: event.model, provider, traceId: event.traceId,
    spanId: event.turnId, latencySeconds: Math.max(0, event.endedAt - event.startedAt) / 1_000,
    isError: event.error !== null, toolCallCount: event.toolCallCount,
    ...event.usage, costUsd: event.costUsd, costSource: event.costSource,
    ttftSeconds: event.ttftMs === null ? null : event.ttftMs / 1_000,
  };
  const properties = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value != null)) as ProductEventProperties;
  const content = includeContent ? {
    ...(event.input?.text === undefined ? {} : { input: event.input.text }),
    ...(event.output?.text === undefined ? {} : { output: event.output.text }),
  } : {};
  return { userId, properties, ...content };
}

/**
 * Projects the existing normalized AI trace into the optional analytics hook. No transcript or
 * contextRef is retained here; only provider labels for live runs. Unknown counters stay absent.
 * @param required Guarded analytics port and a host-selected pseudonymous subject (operator or site).
 * @param optional Maximum simultaneous run labels; excess runs are dropped until capacity frees.
 * @returns A sink, or undefined without AI capability. Shutdown releases labels.
 * @complexity O(1) per event; O(maxActiveRuns) bounded state, no event queue.
 */
export function createAiGenerationSink(
  { analytics, userId }: { analytics: ProductAnalyticsPort; userId: string },
  { maxActiveRuns = 1_000 }: { maxActiveRuns?: number } = {},
): AiTraceSink | undefined {
  if (!analytics.captureAiGeneration) return undefined;
  const providers = new Map<string, string | null>();
  let closed = false;
  return {
    capture: analytics.includeAiContent === true ? "full" : "metadata",
    record(event) {
      if (closed) return;
      if (event.kind === "run_finished") { providers.delete(event.traceId); return; }
      if (event.kind === "run_started") {
        if (providers.size < maxActiveRuns) providers.set(event.traceId, event.provider);
        return;
      }
      if (event.kind !== "model_turn" || !providers.has(event.traceId)) return;
      analytics.captureAiGeneration?.(generationOf({ event, provider: providers.get(event.traceId) ?? null, userId }, { includeContent: analytics.includeAiContent === true }));
    },
    shutdown: async () => { closed = true; providers.clear(); },
  };
}
