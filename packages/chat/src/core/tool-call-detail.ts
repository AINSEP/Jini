/**
 * The expanded body of a tool-call row: what the agent sent, what came back, and — when nothing
 * came back — why. Shared by every card in `react/components/ToolCard.tsx` so no row kind (a CLI
 * built-in like WebFetch, an unknown MCP tool, a card tool such as `assistant_ask_choice` still
 * waiting on the person's answer) is left without a readable call.
 */
import { formatToolOutputForDisplay } from './tool-output.js';
import { redactUserText, type RedactUserText } from './user-text-redaction.js';

/** The note keys a row shows instead of (or beside) a result. English text doubles as the i18n key, as everywhere else in this package. */
export type ToolCallDetailNote =
  | 'Waiting for the result or answer…'
  | 'No result was recorded for this call.'
  | 'The run ended before this call returned a result.'
  | 'Finished with no output.'
  | 'Failed without an error message.';

export interface ToolCallDetail {
  /** The call's input, pretty-printed and redacted; `null` when there is none or it cannot be serialized. */
  readonly inputText: string | null;
  /** The result's text, re-indented when JSON and redacted; `null` when there is no result text. */
  readonly outputText: string | null;
  /** Why there is no output, when there is none; `null` when the output says it all. */
  readonly noteKey: ToolCallDetailNote | null;
}

export interface ToolCallDetailOptions {
  readonly runStreaming?: boolean;
  readonly runSucceeded?: boolean;
  /** Per-block display cap; a longer input or output is cut with an ellipsis. Defaults to 10 000. */
  readonly maxChars?: number;
  /** Defaults to the chat text policy, so a tool call never shows a key the rest of the chat would hide. */
  readonly redact?: RedactUserText;
}

const DEFAULT_MAX_CHARS = 10_000;

/**
 * Builds the readable detail for one tool call.
 *
 * @param required.input - The `tool_use` event's input, any shape.
 * @param required.result - The paired `tool_result`, when one arrived.
 * @param options - Run state that explains a missing result, the display cap, and the redactor.
 * @returns Display-ready input and output text plus a note when the output is absent.
 * @complexity O(n) in the serialized input plus result length.
 */
export function describeToolCallDetail(
  { input, result }: { readonly input: unknown; readonly result?: { readonly content: string; readonly isError?: boolean } | undefined },
  { runStreaming = false, runSucceeded = false, maxChars = DEFAULT_MAX_CHARS, redact = redactUserText }: ToolCallDetailOptions = {},
): ToolCallDetail {
  const show = (text: string | null): string | null => (text === null ? null : truncate(redact({ text: text }).text, maxChars));
  const inputText = show(serializeInput(input));
  if (!result) return { inputText, outputText: null, noteKey: missingResultNote({ runStreaming, runSucceeded }) };
  if (!result.content.trim()) return { inputText, outputText: null, noteKey: result.isError ? 'Failed without an error message.' : 'Finished with no output.' };
  return { inputText, outputText: show(formatToolOutputForDisplay({ text: result.content })), noteKey: null };
}

function missingResultNote({ runStreaming, runSucceeded }: { runStreaming: boolean; runSucceeded: boolean }): ToolCallDetailNote {
  if (runStreaming) return 'Waiting for the result or answer…';
  return runSucceeded ? 'No result was recorded for this call.' : 'The run ended before this call returned a result.';
}

/** A string input is shown as given (re-indented only when it is itself a JSON object/array); anything else is pretty JSON, or `null` when it has no JSON form (circular, a function). */
function serializeInput(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string') return formatToolOutputForDisplay({ text: input });
  try {
    return JSON.stringify(input, null, 2) ?? null;
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}
