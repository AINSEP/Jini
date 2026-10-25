/**
 * @module assistant-content
 *
 * The ONE rule for turning a turn's events into its saved text `content`.
 *
 * Why it exists: `content` used to be every `text` event glued together (`out += ev.text`). A model
 * that writes a short note, calls a tool, then answers produced `"Need project id. Find
 * list_projects.`test_table` now exists…"` — the working note fused onto the answer mid-sentence,
 * in the saved row, the copy button, and any transcript rebuilt from it. The live pane already
 * shows those as separate steps (text, tool card, text); the saved string now keeps them apart too,
 * with a blank line (a Markdown paragraph break) wherever a tool call or card sat between them.
 *
 * Every producer of `content` must use this: the browser (`useConversation`) and any host that
 * saves a finished turn server-side. `interleaveMessageBlocks` accepts both this shape and the old
 * glued one, so rows saved before this change still render in order.
 */
import type { AgentEvent } from './events.js';
import { dedupeToolUsesById } from './tool-events.js';

/** What separates two text runs that a tool call or card sat between. */
export const ASSISTANT_STEP_SEPARATOR = '\n\n';

function separatorBefore({ out, text }: { out: string; text: string }, _options = {}): string {
  if (out.length === 0 || out.endsWith(ASSISTANT_STEP_SEPARATOR) || text.startsWith('\n')) return '';
  return out.endsWith('\n') ? '\n' : ASSISTANT_STEP_SEPARATOR;
}

/** Only explicit step transitions separate text. Thinking-token heartbeats and raw diagnostics
 * may occur inside a streamed step and must never split its deltas.
 * @complexity O(1); no mutation or I/O.
 */
export function isAssistantStepBoundary({ event }: { event: AgentEvent }, _options = {}): boolean {
  if (event.kind === 'tool_use' || event.kind === 'ext' || event.kind === 'usage') return true;
  if (event.kind !== 'status') return false;
  if (event.code !== undefined) return event.code === 'step_start';
  return event.label === 'thinking' || event.label === 'running';
}

/**
 * A turn's text, with a paragraph break between runs separated by a tool call or card.
 * A replay of an already-seen tool ID is not a new step, matching the saved-event projection.
 *
 * @param events - The turn's events, in arrival order.
 * @complexity O(n + total text length) time and O(n) space for n events.
 */
export function assistantContentFromEvents({ events }: { events: readonly AgentEvent[] | undefined }, _options = {}): string {
  let out = '';
  let stepBoundary = false;
  for (const ev of dedupeToolUsesById({ events: events ? [...events] : undefined })) {
    if (isAssistantStepBoundary({ event: ev })) {
      stepBoundary = true;
    } else if (ev.kind === 'text' && ev.text.length > 0) {
      out += (stepBoundary ? separatorBefore({ out, text: ev.text }) : '') + ev.text;
      stepBoundary = false;
    }
  }
  return out;
}

/** The pre-2026-09-27 rule (plain concatenation), kept only so older saved rows still match. */
export function legacyAssistantContentFromEvents({ events }: { events: readonly AgentEvent[] | undefined }): string {
  let out = '';
  for (const ev of events ?? []) {
    if (ev.kind === 'text') out += ev.text;
  }
  return out;
}
