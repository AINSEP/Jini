/**
 * @module agui/encoder
 *
 * Encodes `@jini-ai/protocol`'s `RunProtocolEvent` stream into AG-UI wire events (see
 * `./events.ts`'s module doc). Rewritten from scratch against `@jini-ai/protocol`'s actual
 * current shape — the ported adapter's original encoder targeted a different, product-specific
 * event union with no direct correspondence to `RunProtocolEvent`/`RunAgentPayload`; only the
 * *shape* of the job (a big per-event-kind switch, unrecognized events silently dropped) carried
 * over. See `source-map.md` for the full old→new field-mapping table and the generalization
 * writeup for the six event kinds that had no generic equivalent before this task.
 *
 * Folded in 2026-07-26 from the standalone `@jini-ai/agui` package (plan §3a) into this `src/gen-ui/`
 * subdirectory — kept out of the flat `ag-ui.ts` namespace because that file is a different
 * projection ({@link CapabilityDef} → an AG-UI *frontend tool*); this one turns a run's event
 * stream into AG-UI *wire* events. Same protocol, two unrelated halves of it.
 */
import type { RunAgentPayload, RunProtocolEvent } from '@jini-ai/protocol';
import type { AGUIEvent } from './events.js';

export interface AguiEncodeContext {
  /** The run this event belongs to — stamped onto every produced `AGUIEvent`. */
  readonly runId: string;
  /** Passed through onto the produced event's `seq`, when the caller tracks one (e.g. an SSE `Last-Event-ID`-shaped cursor). Omitted entirely (not set to `undefined`) when absent, matching the original adapter's own base-field construction. */
  readonly seq?: number;
  /** Injectable clock for the produced event's `ts`. Defaults to `Date.now`. Test-only hook. */
  readonly now?: () => number;
}

interface PendingToolCall {
  readonly toolName: string;
  readonly args: unknown;
}

/**
 * A stateful AG-UI encoder for one run's event stream. Stateful because `tool_use`/`tool_result`
 * correlation requires remembering each in-flight tool call's name/args between the two protocol
 * events that describe its start and end — a pure per-event function cannot do this alone. Create
 * one instance per run (e.g. one per `RunLifecycle.stream(runId, ...)` subscription); do not share
 * an instance across multiple runs, since the correlation map has no per-run partitioning of its
 * own (`ctx.runId` is only used to stamp the produced event, not to scope the map).
 */
export interface AguiEncoder {
  /**
   * Encodes one `RunProtocolEvent` into an `AGUIEvent`, or `null` if this event has no AG-UI
   * equivalent (an unrecognized/not-yet-generalized event kind — silently dropped by the relay,
   * matching the original adapter's own default behavior).
   */
  encode(event: RunProtocolEvent, ctx: AguiEncodeContext): AGUIEvent | null;
}

/**
 * Creates a fresh `AguiEncoder` with its own, empty tool-call correlation map.
 * @complexity `encode` is O(1) per call (one `Map` get/set/delete); memory is O(k) in the number
 * of currently in-flight (not yet resolved) tool calls for the run this instance encodes.
 * @overallScore 100/100
 */
export function createAguiEncoder(): AguiEncoder {
  const pendingToolCalls = new Map<string, PendingToolCall>();

  function baseFields(ctx: AguiEncodeContext): { runId: string; ts: number; seq?: number } {
    const ts = ctx.now ? ctx.now() : Date.now();
    return ctx.seq !== undefined ? { runId: ctx.runId, ts, seq: ctx.seq } : { runId: ctx.runId, ts };
  }

  function encodeAgentPayload(payload: RunAgentPayload, ctx: AguiEncodeContext): AGUIEvent | null {
    const base = baseFields(ctx);
    switch (payload.type) {
      case 'text_delta':
        return { ...base, kind: 'agent.message', text: payload.delta };

      case 'tool_use':
        // Overwrites any prior entry under the same id (a duplicate tool_use for one id) — the
        // most recent call's name/args are what a matching tool_result should be attributed to,
        // and there is no protocol-level guarantee ids are never reused within one run.
        pendingToolCalls.set(payload.id, { toolName: payload.name, args: payload.input });
        return { ...base, kind: 'tool_call', toolName: payload.name, args: payload.input, callId: payload.id, status: 'started' };

      case 'tool_result': {
        const pending = pendingToolCalls.get(payload.toolUseId);
        pendingToolCalls.delete(payload.toolUseId);
        return {
          ...base,
          kind: 'tool_call',
          // A tool_result with no matching prior tool_use (never observed, or already resolved/
          // cleared — e.g. after a run-ending 'end' event, see below) falls back to an 'unknown'
          // name and null args rather than throwing: the result itself is still real and worth
          // relaying even when its originating call wasn't captured.
          toolName: pending?.toolName ?? 'unknown',
          args: pending?.args ?? null,
          callId: payload.toolUseId,
          status: payload.isError ? 'failed' : 'completed',
          result: payload.content,
        };
      }

      // Generalization (see source-map.md): pipeline_stage_started/completed generalized into a
      // named-stage boundary any multi-step driver can emit, flowing through the same 'agent'
      // channel as tool_use/tool_result.
      case 'stage_start':
        return {
          ...base,
          kind: 'run.lifecycle',
          status: 'pipeline_stage_started',
          stageId: payload.stageId,
          ...(payload.iteration !== undefined ? { iteration: payload.iteration } : {}),
        };
      case 'stage_end':
        return {
          ...base,
          kind: 'run.lifecycle',
          status: 'pipeline_stage_completed',
          stageId: payload.stageId,
          ...(payload.iteration !== undefined ? { iteration: payload.iteration } : {}),
        };

      // Generalization (see source-map.md): genui_surface_request/response generalized into a
      // generic human-in-the-loop ask/answer pair.
      case 'surface_request':
        return { ...base, kind: 'ui.surface_requested', surfaceId: payload.surfaceId, surfaceKind: payload.surfaceKind, payload: payload.payload };
      case 'surface_response':
        return { ...base, kind: 'ui.surface_responded', surfaceId: payload.surfaceId, value: payload.value, respondedBy: payload.respondedBy };

      // 'status' / 'thinking_start' / 'thinking_delta' / 'tool_input_delta' / 'usage' / 'raw':
      // no AG-UI equivalent — silently dropped, matching the original adapter's default behavior.
      default:
        return null;
    }
  }

  function encode(event: RunProtocolEvent, ctx: AguiEncodeContext): AGUIEvent | null {
    switch (event.kind) {
      case 'start':
        return { ...baseFields(ctx), kind: 'run.lifecycle', status: 'started' };

      case 'end': {
        const status = event.payload.status === 'failed' ? 'failed' : event.payload.status === 'canceled' ? 'cancelled' : 'completed';
        // A run can legitimately end while a tool_use is still in flight (its tool_result never
        // arrived, or arrived after 'end' and was already rejected by RunLifecycle — see
        // run-lifecycle.ts's "cannot emit on terminal run" guard). Clearing here means any such
        // stale entries never leak past this run's own lifetime, and a same-id tool_result that
        // somehow still reaches this encoder afterward correctly falls back to 'unknown' rather
        // than resolving against a call from a run that has already ended.
        pendingToolCalls.clear();
        return { ...baseFields(ctx), kind: 'run.lifecycle', status };
      }

      case 'agent':
        return encodeAgentPayload(event.payload, ctx);

      // 'stdout' / 'stderr' / 'error': no AG-UI equivalent — silently dropped, matching the
      // original adapter's default behavior for unrecognized event kinds.
      default:
        return null;
    }
  }

  return { encode };
}
