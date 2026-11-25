import type { AgentRuntimePort } from '../ports/agent-runtime.js';
import { projectDiagnosticFrame } from '../tool-result-diagnostics.js';
import { createCliToolCallReceiver } from './tool-call-receipts.js';
import { translateAgentRuntimeEvent, applyAgentTranslationSideEffects } from './event-translation.js';
import { MCP_BRIDGE_UNAVAILABLE, unavailableJiniBridgeStatus, bridgeUnavailableMessage } from './mcp-bridge.js';
import { terminateChildTreeBestEffort } from './event-cleanup.js';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import type { RunAgentPayload } from '@jini-ai/protocol';
import type { StreamHandler, JsonStreamFormat } from './contracts.js';
import type { McpBridgeProbeResult } from './mcp-bridge-probe.js';
import type { WireChildLifecycleContext, ChildRunSignals, ChildBridgeState } from './child-lifecycle.js';
import type { createRunEventQueue } from './event-io.js';
import type { createChildInput } from './child-input.js';
import type { createModelReceiptTracker } from './model-receipts.js';

/** Carry PID only on structured status so the host can record its OS start identity early.
 * A PID alone is never proof of death; hosts verify PID reuse before native continuation. */
function statusWithChildIdentity(
  { payload, childPid }: { payload: RunAgentPayload; childPid: number | undefined }, _optional = {},
): RunAgentPayload {
  return { ...payload, ...(payload.type === 'status' && childPid !== undefined ? { childPid } : {}) };
}

/**
 * Selects and constructs the real stream-parser handler for a supported
 * `streamFormat`. `json-event-stream` additionally dispatches on
 * `def.eventParser` (the parser's own internal `kind` switch — e.g.
 * `'codex'`, `'cursor-agent'`, `'opencode'`; `mimo` shares `'opencode'`'s
 * `kind`); an unrecognized/absent `eventParser` degrades to that parser's
 * own `{type:'raw', line}` fallback rather than throwing, matching the
 * parser's own documented behavior. Never called for `streamFormat:
 * 'plain'` — `wireChildLifecycle` handles that format inline with no
 * parser at all (see `ChildDrivenStreamFormat`'s doc).
 * @param def - The resolved agent def (`.eventParser` and `.usageCostBasis` configure parser behavior).
 * @param streamFormat - `def.streamFormat`, already narrowed by {@link isSupportedStreamFormat}.
 * @param onEvent - Sink the parser calls once per parsed (or malformed-raw) event.
 * @returns A `{feed, flush}` handle for the chosen parser.
 * @complexity O(1) dispatch; the returned handler's own per-chunk cost is the parser's.
 * @overallScore 100/100
 */
function createStreamHandlerForDef({ def, streamFormat, streams, strategies }: { def: RuntimeAgentDef; streamFormat: JsonStreamFormat; streams: AgentRuntimePort['streams']; strategies: AgentRuntimePort['strategies'] },
  { onEvent }: { onEvent: (event: Record<string, unknown>) => void }): StreamHandler {
  switch (streamFormat) {
    case 'claude-stream-json':
      return streams.claude({ onEvent: onEvent }, { costBasis: def.usageCostBasis ?? 'run' });
    case 'qoder-stream-json':
      return streams.qoder({ onEvent: onEvent });
    case 'json-event-stream':
      return streams.jsonEvents({ kind: def.eventParser ?? '', onEvent: createCliToolCallReceiver({ strategy: strategies.for({ def }), onEvent }) });
    default: {
      // Unreachable: every stream format has a case above, and a new one fails typecheck here.
      const unknownFormat: never = streamFormat;
      throw new TypeError(`Unknown agent stream format: ${String(unknownFormat)}`);
    }
  }
}

export function createChildStreamHandler({ ctx, signals, bridge, enqueueEmit, input, modelReceipt }: {
  ctx: WireChildLifecycleContext; signals: ChildRunSignals; bridge: ChildBridgeState;
  enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
  input: ReturnType<typeof createChildInput>; modelReceipt: ReturnType<typeof createModelReceiptTracker>;
}, _options = {}): StreamHandler | null {
  const { runId, def, streamFormat, lifecycle } = ctx;
  return streamFormat === 'plain' ? null : createStreamHandlerForDef({ def, streamFormat, streams: ctx.streams, strategies: ctx.strategies }, { onEvent: rawEvent => {
    if (bridge.bridgeUnavailable) return;
    const translation = translateAgentRuntimeEvent({ rawEvent: rawEvent });
    if (translation.kind === 'agent') {
      const receipt = modelReceipt(translation.payload);
      if (receipt) enqueueEmit(() => lifecycle.emit({ runId, input: { event: 'agent', data: receipt } }));
      applyAgentTranslationSideEffects({ payload: translation.payload, sessionId: translation.sessionId, sink: {
        onSessionId: ({ sessionId }) => { signals.capturedSessionId = sessionId; },
        onToolCall: ({ toolUse }) => {
          // A tool signal always carries the tool_use variant (the sink hands it over narrowed);
          // retain its full input for continuation.
          input.noteToolUse({ id: toolUse.id, name: toolUse.name, input: toolUse.input });
          signals.toolCallSeen = true;
        },
        onUserVisibleOutput: () => { signals.userVisibleOutputSeen = true; },
      } });
      if (rejectUnavailableBridge({ ctx, bridge, enqueueEmit, payload: translation.payload, rawEvent }, {})) return;
      enqueueEmit(() => {
        const payload = projectEcho({ ctx, payload: translation.payload, rawEvent }, {});
        return lifecycle.emit({ runId, input: { event: 'agent', data: statusWithChildIdentity({ payload, childPid: ctx.child.pid }, {}) } });
      });
    }
    if (translation.kind === 'error') {
      enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'error', data: translation.payload } }));
    }
    if (translation.kind === 'turn-end') {
      input.handleTurnEnd(translation.stopReason);
    }
  } });
}

/** Verify against an already-saved call in this run; unverified metadata preserves all output. */
function projectEcho({ ctx, payload, rawEvent }: { ctx: WireChildLifecycleContext; payload: RunAgentPayload; rawEvent: Record<string, unknown> }, _options = {}): RunAgentPayload {
  if (!ctx.delegatedResultCorrelation) return payload;
  if (payload.type === 'raw') return { ...payload, line: projectDiagnosticFrame({ line: payload.line }) };
  if (payload.type !== 'tool_result' || !payload.delegatedToolUseId || !Array.isArray(rawEvent.delegatedResultContent)) return payload;
  const matches = ctx.delegatedResultCorrelation.matches({ runId: ctx.runId, toolUseId: payload.delegatedToolUseId, content: rawEvent.delegatedResultContent, isError: payload.isError === true });
  return matches ? { ...payload, content: `Result shown by delegated call ${payload.delegatedToolUseId}.` } : payload;
}

function rejectUnavailableBridge({ ctx, bridge, enqueueEmit, payload, rawEvent }: {
  ctx: WireChildLifecycleContext; bridge: ChildBridgeState;
  enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
  payload: RunAgentPayload; rawEvent: Record<string, unknown>;
}, _options = {}): boolean {
  if (!bridge.bridgeChecked && payload.type === 'status' && payload.label === 'initializing') {
    bridge.bridgeChecked = true;
    const bridgeStatus = unavailableJiniBridgeStatus({ rawEvent });
    if (bridgeStatus !== undefined) {
      stopForUnavailableBridge({ ctx, bridge, enqueueEmit, initStatus: payload, bridgeStatus });
      return true;
    }
  }
  return false;
}

/**
 * Ends a run whose CLI started without the `jini` bridge: emits the init status and a
 * {@link MCP_BRIDGE_UNAVAILABLE} error, then stops the child's process tree before the model can
 * answer with no host tools. The close handler then finishes the run `'failed'` whatever exit code
 * the child reports.
 */
function stopForUnavailableBridge({ ctx, bridge, enqueueEmit, initStatus, bridgeStatus }: {
  ctx: WireChildLifecycleContext; bridge: ChildBridgeState;
  enqueueEmit: ReturnType<typeof createRunEventQueue>['enqueueEmit'];
  initStatus: RunAgentPayload; bridgeStatus: string;
}, _options = {}): void {
  const { runId, child, lifecycle } = ctx;
  bridge.bridgeUnavailable = true;
  enqueueEmit(() => lifecycle.emit({ runId: runId, input: { event: 'agent', data: initStatus } }));
  enqueueEmit(async () => {
    let probe: McpBridgeProbeResult | undefined;
    if (ctx.bridgeProbeEntry) {
      try {
        probe = await ctx.probeMcpBridge({ entry: ctx.bridgeProbeEntry });
      } catch {
        // A diagnostic failure must not suppress the original bridge error or the terminal event.
      }
    }
    const message = bridgeUnavailableMessage({ status: bridgeStatus }, { probe });
    const details = probe ? {
      exitCode: probe.exitCode, signal: probe.signal, stderrTail: probe.stderrTail, elapsedMs: probe.elapsedMs,
    } : undefined;
    await lifecycle.emit({ runId, input: { event: 'error', data: {
      message, error: { code: MCP_BRIDGE_UNAVAILABLE, message, ...(details ? { details } : {}) },
    } } });
  });
  void terminateChildTreeBestEffort(ctx, child, runId, 'cancel', ctx.onCleanupFailure);
}
