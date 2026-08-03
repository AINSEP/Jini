/**
 * @module transcript
 *
 * Pure transcript-assembly helpers: turning a `ChatMessage[]` history into
 * the flattened text a host sends to an agent as prior-turn context.
 *
 * Adapted from OD's `providers/daemon.ts` transcript section (see
 * source-map.md). The OD original also owned SSE/fetch transport
 * (`streamViaDaemon`, `DaemonStreamHandlers`) — none of that is ported here;
 * only the pure string-assembly helpers. It also hard-coded OD's BYOK/
 * OpenCode agent-family policy and an `agent-browser`-tool-specific
 * context-warning heuristic; both are OD product policy, not generic
 * transcript assembly, so they are generalized into caller-supplied hooks
 * (or dropped) below — see source-map.md for the full accounting.
 */
import type { ChatMessage } from './messages.js';
import type { PersistedArtifactFileRef } from './util/strip.js';
import { summarizeArtifactsForTranscript } from './util/strip.js';

const DEFAULT_MAX_TRANSCRIPT_MESSAGE_CHARS = 12_000;
const DEFAULT_LARGE_TOOL_RESULT_CHARS = 8_000;
const DEFAULT_HIGH_INPUT_TOKEN_WARNING_THRESHOLD = 200_000;

/** The most recent `user`-authored message's content, or `''` if there isn't one. */
export function latestUserPromptFromHistory(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message?.role === 'user') return message.content;
  }
  return '';
}

function truncateForTranscript(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const omitted = content.length - maxChars;
  return `${content.slice(0, maxChars)}\n\n[truncated ${omitted} chars from this prior message before sending it to the agent. Full content remains in persisted history.]`;
}

function escapeTranscriptRoleDelimiters(content: string): string {
  return content.replace(/^(## (?:user|assistant)[ \t]*)(\r?)$/gm, '\\$1$2');
}

/**
 * Build a short warning block when prior-run telemetry embedded in
 * `history`'s events suggests the next turn should keep its own output
 * compact (a previous run reported a very high input-token count, or
 * carries large persisted tool results that a fresh turn shouldn't replay
 * verbatim).
 * @complexity O(n) across all messages' events.
 */
function buildPriorRunContextWarning(history: ChatMessage[], largeToolResultChars: number, highInputTokenWarningThreshold: number): string | null {
  let highestInputTokens = 0;
  let largeToolResults = 0;

  for (const message of history) {
    for (const event of message.events ?? []) {
      if (event.kind === 'usage' && typeof event.inputTokens === 'number') {
        highestInputTokens = Math.max(highestInputTokens, event.inputTokens);
      }
      if (event.kind === 'tool_result' && event.content.length > largeToolResultChars) {
        largeToolResults += 1;
      }
    }
  }

  const notes: string[] = [];
  if (highestInputTokens >= highInputTokenWarningThreshold) {
    notes.push(`a previous run reported ${highestInputTokens} input tokens`);
  }
  if (largeToolResults > 0) {
    notes.push(`${largeToolResults} large prior tool result${largeToolResults === 1 ? '' : 's'} exist only in persisted event history`);
  }
  if (notes.length === 0) return null;

  return ['## context warning', `Detected ${notes.join(', ')}.`, 'Keep this turn compact: summarize prior tool output, read large references from temp files, and quote only task-relevant lines.'].join('\n');
}

function scopeHistoryToAgent(history: ChatMessage[], targetAgentId: string | undefined, isSameAgentFamily: (agentId: string, targetAgentId: string) => boolean): ChatMessage[] {
  if (!targetAgentId) return history;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message?.role === 'assistant' && message.agentId && !isSameAgentFamily(message.agentId, targetAgentId)) {
      return history.slice(i + 1);
    }
  }
  return history;
}

/**
 * Strip transcript-echo hazards from a prior assistant turn before it goes
 * back to the agent as history: an already-answered `<question-form>` /
 * `<ask-question>` block (and a fenced JSON schema echo of the same shape),
 * plus any `<artifact>` body CONFIRMED persisted to `persistedArtifactFiles`
 * (replaced with a one-line pointer to the on-disk file — see
 * {@link summarizeArtifactsForTranscript}).
 *
 * Leaving an answered form literal in the transcript causes a weak/plain
 * model to pattern-match it as a template and re-emit an identical form on
 * the user's next turn, looking like the clarification loop never breaks.
 *
 * User-authored content is never sanitized by this function — a user
 * legitimately quoting `<question-form>` markup must not be mangled; only
 * assistant turns should be passed in.
 *
 * @complexity O(n) in `content.length` (a small fixed number of regex
 *   passes) plus {@link summarizeArtifactsForTranscript}'s cost.
 */
export function sanitizePriorAssistantTurn(content: string, persistedArtifactFiles: ReadonlyArray<PersistedArtifactFileRef> = []): string {
  let sanitized = content.replace(
    // `\1` backreference keeps the open/close tag names matched so this never
    // splices across a `<question-form>…</ask-question>` mismatch.
    /<(question-form|ask-question)\b[^>]*>[\s\S]*?<\/\1>/g,
    '[question-form was emitted here on a prior turn; the user already answered, see their reply below.]',
  );
  // Strip ```json (or plain ```) fenced blocks whose body matches the form
  // schema shape — `"questions": [` is the strongest tell. A generic JSON
  // snippet without that key is left intact.
  sanitized = sanitized.replace(/```(?:json)?\s*\n([\s\S]*?)\n```/g, (match, body: string) => {
    if (/"questions"\s*:\s*\[/.test(body)) {
      return '[form schema was echoed here on a prior turn; stripped to avoid a loop.]';
    }
    return match;
  });
  // Replace prior-turn `<artifact>` HTML with a one-line summary for
  // artifacts CONFIRMED persisted (see summarizeArtifactsForTranscript's own
  // doc for why an unconfirmed save is left verbatim).
  sanitized = summarizeArtifactsForTranscript(sanitized, persistedArtifactFiles);
  return sanitized;
}

export interface BuildTranscriptOptions {
  /**
   * Scope the transcript to messages from this agent's family onward,
   * dropping any older history from a different agent. Omit to include the
   * full history (no scoping).
   */
  targetAgentId?: string;
  /**
   * How to decide two agent ids belong to the "same family" for the
   * purposes of `targetAgentId` scoping (e.g. a host may route several
   * model ids through one shared agent identity). Defaults to exact-id
   * equality when omitted.
   */
  isSameAgentFamily?: (agentId: string, targetAgentId: string) => boolean;
  /**
   * Resolve the files a given message's artifacts were confirmed persisted
   * to, so their bodies can be summarized instead of replayed verbatim. A
   * host derives this from its own file-write bookkeeping — chat-core's
   * `ChatMessage` intentionally carries no `producedFiles`-shaped field.
   * Defaults to "nothing persisted" (no summarization).
   */
  resolvePersistedArtifactFiles?: (message: ChatMessage) => ReadonlyArray<PersistedArtifactFileRef>;
  /** Per-message character cap before truncation. @default 12000 */
  maxMessageChars?: number;
  /** `tool_result.content` length above which a result counts as "large" for the context warning. @default 8000 */
  largeToolResultChars?: number;
  /** `usage.inputTokens` above which the context warning fires. @default 200000 */
  highInputTokenWarningThreshold?: number;
}

/**
 * Flatten a conversation history into the `## role\n<content>` transcript
 * text sent to an agent as prior-turn context: scopes to the target agent
 * family (if requested), sanitizes each assistant turn, truncates
 * over-length messages, and prepends a compact-turn warning when prior-run
 * telemetry suggests one is warranted.
 *
 * @complexity O(n) in the total transcript character count — one pass to
 *   scope, one to sanitize/truncate/join each message, one to scan events
 *   for the warning.
 */
export function buildTranscript(history: ChatMessage[], options: BuildTranscriptOptions = {}): string {
  const maxMessageChars = options.maxMessageChars ?? DEFAULT_MAX_TRANSCRIPT_MESSAGE_CHARS;
  const largeToolResultChars = options.largeToolResultChars ?? DEFAULT_LARGE_TOOL_RESULT_CHARS;
  const highInputTokenWarningThreshold = options.highInputTokenWarningThreshold ?? DEFAULT_HIGH_INPUT_TOKEN_WARNING_THRESHOLD;
  const isSameAgentFamily = options.isSameAgentFamily ?? ((agentId: string, targetAgentId: string) => agentId === targetAgentId);
  const resolvePersistedArtifactFiles = options.resolvePersistedArtifactFiles ?? (() => [] as ReadonlyArray<PersistedArtifactFileRef>);

  const scopedHistory = scopeHistoryToAgent(history, options.targetAgentId, isSameAgentFamily);
  const transcript = scopedHistory
    .map((m) => {
      const trimmed = m.content.trim();
      const sanitized = m.role === 'assistant' ? sanitizePriorAssistantTurn(trimmed, resolvePersistedArtifactFiles(m)) : trimmed;
      return `## ${m.role}\n${escapeTranscriptRoleDelimiters(truncateForTranscript(sanitized, maxMessageChars))}`;
    })
    .join('\n\n');
  const warning = buildPriorRunContextWarning(scopedHistory, largeToolResultChars, highInputTokenWarningThreshold);
  return warning ? `${warning}\n\n${transcript}` : transcript;
}
