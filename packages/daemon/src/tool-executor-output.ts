import type { createExecutionAppendEvent } from './tool-executor-audit.js';
import type { ToolExecutionResult, ToolExecutionErrorKind } from './tool-executor-types.js';
import { withNormalizationNotes, ToolInputError, type ToolDescriptor } from '@jini-ai/core';


/**
 * Enforces `maxOutputBytes` in BYTES, which is what the option is named for.
 *
 * `String.length` and `String.slice` count UTF-16 code units, so this previously let any non-ASCII
 * output through at up to ~3x the configured cap (CJK and emoji are 3–4 UTF-8 bytes per code unit)
 * — precisely the case a byte cap exists to bound. Slicing by code units also cannot split a
 * surrogate pair safely.
 *
 * The byte slice is decoded non-fatally and one trailing U+FFFD is dropped: cutting mid-sequence
 * produces exactly one replacement character at the end, and emitting that as the last visible
 * glyph of every truncated multi-byte output is worse than losing one already-truncated character.
 */
function truncateOutput(output: unknown, maxOutputBytes: number | undefined): { output: unknown; truncated: boolean } {
  if (!maxOutputBytes || typeof output !== 'string') return { output, truncated: false };
  const encoded = Buffer.from(output, 'utf8');
  if (encoded.byteLength <= maxOutputBytes) return { output, truncated: false };
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(encoded.subarray(0, maxOutputBytes));
  return { output: decoded.endsWith('�') ? decoded.slice(0, -1) : decoded, truncated: true };
}

export function createExecutionTerminal({ appendEvent }: { appendEvent: ReturnType<typeof createExecutionAppendEvent> }) {
  /** Records a terminal transition that carries no detail and returns its bare result. */
  function terminal({ executionId, status }: { executionId: string; status: 'cancelled' | 'denied' | 'confirmation-denied' | 'timed-out' }): ToolExecutionResult {
    appendEvent(executionId, status);
    return { executionId, status };
  }
  return terminal;
}

export function createExecutionOperationalFailure({ appendEvent }: { appendEvent: ReturnType<typeof createExecutionAppendEvent> }) {
  /** Records an operational (non-decision) failure under a fixed message that never carries the exception text. */
  function operationalFailure({ executionId, error }: { executionId: string; error: 'authorization failed' | 'confirmation failed' }): ToolExecutionResult {
    appendEvent(executionId, 'failed', error);
    return { executionId, status: 'failed', error };
  }
  return operationalFailure;
}

export function createExecutionFailureResult({ terminal, appendEvent }: { terminal: ReturnType<typeof createExecutionTerminal>; appendEvent: ReturnType<typeof createExecutionAppendEvent> }) {
  /**
   * Classifies a handler rejection into its terminal result, recording the matching transition.
   * Prepared `guidance` is appended to a `failed` result's error (never to its audit detail) — a
   * rejected write still returns a model-visible result; do not lose prepared guidance there.
   */
  function failureResult(
    { executionId, err, timedOut, aborted }: { executionId: string; err: unknown; timedOut: boolean; aborted: boolean },
    { normalizationNotes = [], guidance = '' }: { normalizationNotes?: readonly string[]; guidance?: string } = {},
  ): ToolExecutionResult {
    if (timedOut) return terminal({ executionId, status: 'timed-out' });
    if (aborted) return terminal({ executionId, status: 'cancelled' });
    const message = withNormalizationNotes({ output: err instanceof Error ? err.message : String(err), notes: normalizationNotes }) as string;
    appendEvent(executionId, 'failed', message);
    const errorKind: ToolExecutionErrorKind = err instanceof ToolInputError ? 'validation' : 'internal';
    const error = guidance ? `${message}\n\n${guidance}` : message;
    return { executionId, status: 'failed', error, errorKind, ...(normalizationNotes.length ? { normalizationNotes } : {}) };
  }
  return failureResult;
}

export function createExecutionSettleOutput({ failureResult, appendEvent }: { failureResult: ReturnType<typeof createExecutionFailureResult>; appendEvent: ReturnType<typeof createExecutionAppendEvent> }) {
  /**
   * Turns a resolved handler output into the terminal result: `completed` with the (guidance-
   * annotated, normalization-noted, truncated) output, or the terminal state the call already
   * reached when the handler resolved after it.
   */
  function settleOutput(
    { executionId, rawOutput, descriptor, timedOut, aborted }: { executionId: string; rawOutput: unknown; descriptor: ToolDescriptor; timedOut: boolean; aborted: boolean },
    { guidance, normalizationNotes }: { guidance: string; normalizationNotes: readonly string[] },
  ): ToolExecutionResult {
    // A handler is not OBLIGED to honour `signal` — it is handed one, not policed by one. A
    // handler that ignores it and resolves normally after the timer fired (or after `cancel`)
    // used to land here and be recorded `completed`, because the timeout/abort state was only
    // ever consulted in the `catch`. That reports success for a call the contract has already
    // declared terminal in the other direction: the caller was told `timed-out`/`cancelled` is
    // final (see this module's state-machine doc), the audit trail said `completed`, and the two
    // disagreed. Whether the handler cooperated does not change what happened to the CALL.
    if (timedOut || aborted) {
      return failureResult({ executionId, err: new Error('handler resolved after the execution was already terminal'), timedOut, aborted });
    }
    const { output, truncated } = truncateOutput(withNormalizationNotes({ output: attachToolGuidance({ output: rawOutput, guidance }), notes: normalizationNotes }), descriptor.maxOutputBytes);
    appendEvent(executionId, 'completed');
    return { executionId, status: 'completed', output, truncated, ...(normalizationNotes.length ? { normalizationNotes } : {}) };
  }
  return settleOutput;
}

/** Preserve ordinary object fields while adding model-facing guidance to this tool result. */
function attachToolGuidance({ output, guidance }: { output: unknown; guidance: string }): unknown {
  if (!guidance) return output;
  if (typeof output === 'string') return `${output}\n\n${guidance}`;
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    // MCP envelopes are projected by their content blocks; an extra JSON property may be ignored.
    if ('content' in output && Array.isArray(output.content)) return { ...output, content: [...output.content, { type: 'text', text: guidance }] };
    return { ...output, agentPluginGuidance: guidance };
  }
  return { result: output, agentPluginGuidance: guidance };
}
