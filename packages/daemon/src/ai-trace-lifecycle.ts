/**
 * @module ai-trace-lifecycle
 *
 * Wraps a {@link RunLifecycle} so every run it drives is also recorded as an AI trace. This is
 * the single tap for every provider path: child stream parsers (Claude Code, Copilot, Qoder,
 * Codex/OpenCode/Cursor/Kimi JSON streams), ACP sessions and pi-rpc all publish their normalized
 * events through `lifecycle.emit({ event: 'agent' })`. Observing the committed stream also sees
 * watchdog-driven terminal transitions, which call the base lifecycle's closed-over `finish()`.
 * Hosts that pass no sink never call this, so tracing off costs nothing.
 *
 * What it cannot see: the user prompt (the kernel only holds an opaque `contextRef`) — hosts that
 * want prompt capture call `noteRunInput` with the text they sent. Resumed runs keep their
 * original trace closed; a resume is not re-traced in this prototype.
 */
import { createAiTraceRecorder, type AiTraceRecorder, type AiTraceRecorderOptions, type AiTraceSink } from '@jini-ai/agent-runtime';
import type { RunProtocolEvent, RunEndPayload } from '@jini-ai/protocol';
import type { RunLifecycle } from './run-lifecycle.js';

export interface AiTracingOptions extends Pick<AiTraceRecorderOptions, 'capture' | 'exactSecrets' | 'maxCapturedChars' | 'priceUsage' | 'onSinkError' | 'now'> {
  /** Maps an agent id (`claude`, `codex`, `gemini`, …) to the provider label a backend groups by. Default: the agent id. */
  readonly providerOf?: (args: { agentId: string }) => string | null;
  /** Host session/chat id for a run's opaque `contextRef`. Default: the contextRef itself. */
  readonly sessionOf?: (args: { contextRef: string }) => string | null;
}

export interface TracedRunLifecycle extends RunLifecycle {
  /** Records the prompt text for a run's trace (subject to the capture mode). No-op for unknown runs. */
  noteRunInput(args: { runId: string; input: string }): void;
}

/**
 * Records the lifecycle's committed stream, including internal terminal transitions.
 * @param required - Existing lifecycle owner and vendor-neutral sink.
 * @param options - Capture policy, mappings, clock, pricing, and guarded error reporting.
 * @returns The lifecycle with traced starts and prompt capture; run results and errors are preserved.
 * @complexity O(1) per live event; initial replay uses the lifecycle's O(e) stream for e committed events.
 */
export function withAiTracing({ lifecycle, sink }: { lifecycle: RunLifecycle; sink: AiTraceSink }, options: AiTracingOptions = {}): TracedRunLifecycle {
  const recorders = new Map<string, { recorder: AiTraceRecorder; unsubscribe?: () => void }>();
  const { providerOf = ({ agentId }) => agentId, sessionOf = ({ contextRef }) => contextRef, ...recorderOptions } = options;

  /** Only tracing effects are contained; the underlying lifecycle's errors still propagate. */
  function safely({ action }: { action: () => void }): void {
    try { action(); } catch (error) {
      try { options.onSinkError?.(error); } catch { /* Reporting must not change committed run behavior. */ }
    }
  }

  function close({ runId, end }: { runId: string; end: RunEndPayload }): void {
    const entry = recorders.get(runId);
    if (!entry) return;
    try {
      const outcome = end.status === 'canceled' ? 'cancelled' : end.status ?? 'failed';
      safely({ action: () => entry.recorder.finish({ outcome }) });
    } finally {
      recorders.delete(runId);
      safely({ action: () => entry.unsubscribe?.() });
    }
  }

  function observe({ event }: { event: RunProtocolEvent }): void {
    if (event.kind === 'end') return close({ runId: event.runId, end: event.payload });
    const recorder = recorders.get(event.runId)?.recorder;
    if (event.kind === 'agent') recorder?.observe(event.payload as unknown as Record<string, unknown>);
    if (event.kind === 'error') recorder?.observe({ type: 'error', message: event.payload.message, code: event.payload.error?.code });
  }

  async function open({ runId, contextRef, agentId }: { runId: string; contextRef: string; agentId: string }): Promise<void> {
    const recorder = createAiTraceRecorder({ sink, runId, agentId }, { ...recorderOptions, provider: providerOf({ agentId }), sessionId: sessionOf({ contextRef }) });
    const entry: { recorder: AiTraceRecorder; unsubscribe?: () => void } = { recorder };
    recorders.set(runId, entry);
    recorder.start({});
    const subscription = await lifecycle.stream({ runId, onEvent: (event) => safely({ action: () => observe({ event }) }) });
    if (subscription.kind !== 'ok') throw new Error(`AI trace subscription refused: ${subscription.kind}`);
    // A terminal event can arrive during replay, before stream returns its unsubscribe handle.
    if (!recorders.has(runId)) subscription.unsubscribe();
    else entry.unsubscribe = subscription.unsubscribe;
  }

  return {
    ...lifecycle,
    async start(required, optional = {}) {
      const result = await lifecycle.start(required, optional);
      if (result.started) {
        // Not awaited: a slow or hung event-log replay must not delay the committed start. The
        // recorder is registered synchronously; replay delivers anything emitted before subscribing.
        void open({ runId: result.run.id, contextRef: required.contextRef, agentId: optional.agentId ?? 'unknown' }).catch((error: unknown) => {
          recorders.delete(result.run.id);
          safely({ action: () => { throw error; } });
        });
      }
      return result;
    },
    // start() has already opened the trace by the time a host knows the run id, so the prompt
    // rides the first model turn (where backends show a generation's input) rather than run_started.
    noteRunInput({ runId, input }) {
      safely({ action: () => recorders.get(runId)?.recorder.noteInput({ input }) });
    },
  };
}
