/**
 * @module ai-trace-lifecycle
 *
 * Wraps a {@link RunLifecycle} so every run it drives is also recorded as an AI trace. This is
 * the single tap for every provider path: child stream parsers (Claude Code, Copilot, Qoder,
 * Codex/OpenCode/Cursor/Kimi JSON streams), ACP sessions and pi-rpc all publish their normalized
 * events through `lifecycle.emit({ event: 'agent' })`, and every run ends in `finish()`. Hosts that
 * pass no sink never call this, so tracing off costs nothing.
 *
 * What it cannot see: the user prompt (the kernel only holds an opaque `contextRef`) — hosts that
 * want prompt capture call `noteRunInput` with the text they sent. Resumed runs keep their
 * original trace closed; a resume is not re-traced in this prototype.
 */
import { createAiTraceRecorder, type AiTraceRecorder, type AiTraceRecorderOptions, type AiTraceSink } from '@jini-ai/agent-runtime';
import type { RunLifecycle } from './run-lifecycle.js';

export interface AiTracingOptions extends Pick<AiTraceRecorderOptions, 'capture' | 'exactSecrets' | 'maxCapturedChars' | 'priceUsage' | 'onSinkError' | 'now'> {
  /** Maps an agent id (`claude`, `codex`, `gemini`, …) to the provider label a backend groups by. Default: the agent id. */
  readonly providerOf?: (agentId: string) => string | null;
  /** Host session/chat id for a run's opaque `contextRef`. Default: the contextRef itself. */
  readonly sessionOf?: (contextRef: string) => string | null;
}

export interface TracedRunLifecycle extends RunLifecycle {
  /** Records the prompt text for a run's trace (subject to the capture mode). No-op for unknown runs. */
  noteRunInput(args: { runId: string; input: string }): void;
}

export function withAiTracing({ lifecycle, sink }: { lifecycle: RunLifecycle; sink: AiTraceSink }, options: AiTracingOptions = {}): TracedRunLifecycle {
  const recorders = new Map<string, AiTraceRecorder>();
  const { providerOf = (agentId: string) => agentId, sessionOf = (contextRef: string) => contextRef, ...recorderOptions } = options;

  function open(runId: string, contextRef: string, agentId: string): void {
    const recorder = createAiTraceRecorder({ sink, runId, agentId }, { ...recorderOptions, provider: providerOf(agentId), sessionId: sessionOf(contextRef) });
    recorders.set(runId, recorder);
    recorder.start({});
  }

  return {
    ...lifecycle,
    async start(required, optional = {}) {
      const result = await lifecycle.start(required, optional);
      if (result.started) open(result.run.id, required.contextRef, optional.agentId ?? 'unknown');
      return result;
    },
    async emit(args) {
      const event = await lifecycle.emit(args);
      const recorder = recorders.get(args.runId);
      if (args.input.event === 'agent') recorder?.observe(args.input.data as unknown as Record<string, unknown>);
      if (args.input.event === 'error') recorder?.observe({ type: 'error', message: args.input.data.message });
      return event;
    },
    async finish(required, optional) {
      const status = await lifecycle.finish(required, optional);
      recorders.get(required.runId)?.finish({ outcome: required.status });
      recorders.delete(required.runId);
      return status;
    },
    // start() has already opened the trace by the time a host knows the run id, so the prompt
    // rides the first model turn (where backends show a generation's input) rather than run_started.
    noteRunInput({ runId, input }) {
      recorders.get(runId)?.noteInput({ input });
    },
  };
}
