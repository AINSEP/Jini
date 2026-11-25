/**
 * The expanded body of a tool-call row: what the agent sent, what came back, and — when nothing
 * came back — why. Shared by every card in `react/components/ToolCard.tsx` so no row kind (a CLI
 * built-in like WebFetch, an unknown MCP tool, a card tool such as `assistant_ask_choice` still
 * waiting on the person's answer) is left without a readable call.
 */
import { orFallbackSync } from '@jini-ai/core/errors/idioms';
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
  const inputText = showSafely({ text: serializeInput(input), redact, maxChars });
  const { text, noteKey } = selectOutputOrNote({ result, runStreaming, runSucceeded });
  return { inputText, outputText: showSafely({ text, redact, maxChars }), noteKey };
}

/** Redacts, then caps — never the reverse, so a cut can never leave part of a secret the redactor would have matched whole. */
function showSafely(
  { text, redact, maxChars }: { text: string | null; redact: RedactUserText; maxChars: number },
  _optional = {},
): string | null {
  return text === null ? null : truncate(redact({ text: text }).text, maxChars);
}

/** The unredacted output text to show, or the note explaining why there is none. */
function selectOutputOrNote(
  { result, runStreaming, runSucceeded }: { result: Parameters<typeof describeToolCallDetail>[0]['result']; runStreaming: boolean; runSucceeded: boolean },
  _optional = {},
): { text: string | null; noteKey: ToolCallDetailNote | null } {
  if (!result) return { text: null, noteKey: missingResultNote({ runStreaming, runSucceeded }) };
  if (!result.content.trim()) return { text: null, noteKey: result.isError ? 'Failed without an error message.' : 'Finished with no output.' };
  const text = result.isError && isRefusedArgumentsError(result.content) ? REFUSED_ARGUMENTS_SENTENCE : formatToolOutputForDisplay({ text: result.content });
  return { text, noteKey: null };
}

/**
 * The tool server words a refused call for the model that made it ("invalid arguments for <tool>: change
 * `path`: ..." plus the accepted-argument contract) so it can repair the call. That text is protocol, not
 * something a person can act on, so the card says it in plain words; the model still receives the original.
 */
const REFUSED_ARGUMENTS_PREFIX = 'invalid arguments for ';
const REFUSED_ARGUMENTS_SENTENCE = 'This step did not run because the assistant sent details the tool could not use. It usually corrects itself and tries again.';

function isRefusedArgumentsError(content: string): boolean {
  return content.trimStart().startsWith(REFUSED_ARGUMENTS_PREFIX);
}

/** Per-block cap for the text a collapsed row keeps mounted — see {@link describeCollapsedToolCall}. */
export const COLLAPSED_DETAIL_MAX_CHARS = 400;

/**
 * The short, single-node text a collapsed row keeps in the DOM in place of its full detail. A long
 * chat mounts hundreds of collapsed rows (713 in a 38-message chat, 3.45 MB of hidden text at the
 * full 10 000-char cap), so the full panel is mounted only while open; this keeps the gist —
 * input, then output or the note explaining its absence — readable through the row's
 * `textContent` for a `page.*` DOM reader that never clicks.
 *
 * @param required - Same as {@link describeToolCallDetail}.
 * @param options - Same as {@link describeToolCallDetail}; `maxChars` defaults to {@link COLLAPSED_DETAIL_MAX_CHARS}.
 * @returns Input (when it has a JSON form) and output or note, joined by a newline — never empty, since a missing output always carries a note.
 * @complexity O(n) in the serialized input plus result length (redaction runs before the cap).
 */
export function describeCollapsedToolCall(
  required: Parameters<typeof describeToolCallDetail>[0],
  options: ToolCallDetailOptions = {},
): string {
  const detail = describeToolCallDetail(required, { maxChars: COLLAPSED_DETAIL_MAX_CHARS, ...options });
  return [detail.inputText, detail.outputText ?? detail.noteKey].filter((part): part is string => part !== null).join('\n');
}

function missingResultNote({ runStreaming, runSucceeded }: { runStreaming: boolean; runSucceeded: boolean }): ToolCallDetailNote {
  if (runStreaming) return 'Waiting for the result or answer…';
  return runSucceeded ? 'No result was recorded for this call.' : 'The run ended before this call returned a result.';
}

/** A string input is shown as given (re-indented only when it is itself a JSON object/array); anything else is pretty JSON, or `null` when it has no JSON form (circular, a function). */
function serializeInput(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string') return formatToolOutputForDisplay({ text: input });
  return orFallbackSync({ work: () => JSON.stringify(input, null, 2) ?? null, fallback: null, step: 'Format tool input for display' });
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}
