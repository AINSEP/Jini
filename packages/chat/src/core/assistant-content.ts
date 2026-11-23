
import { dedupeToolUsesById } from './tool-events.js';
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

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
      continue;
    }
    if (ev.kind === 'text' && ev.text.length > 0) {
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
