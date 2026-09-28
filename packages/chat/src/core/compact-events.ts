/**
 * @module compact-events
 *
 * Shrinks a finished turn's events before they are saved.
 *
 * With partial-message streaming on, the CLI reports text a few tokens at a time, so one answer
 * arrives as ~100 `text` events (`"Here"`, `" are your"`, …). Live, that is what makes words appear
 * as they are written. Saved, it only repeats `{"kind":"text","text":…}` per token. Joining each
 * run of back-to-back `text` events (and back-to-back `thinking` events) into one keeps the saved
 * row's meaning intact: nothing is reordered, and any other event between two deltas — a tool call,
 * a card, a status or raw line — still separates them, so `assistantContentFromEvents` and the
 * pane's step layout read the same before and after.
 */
import type { AgentEvent } from './events.js';

type DeltaEvent = Extract<AgentEvent, { kind: 'text' | 'thinking' }>;

function isDelta(event: AgentEvent): event is DeltaEvent {
  return event.kind === 'text' || event.kind === 'thinking';
}

/**
 * The events with every run of adjacent `text` (or adjacent `thinking`) events joined into one.
 * Returns a new array; the input is not changed.
 *
 * @param events - A turn's events, in arrival order.
 * @complexity O(number of events + total text length).
 */
export function mergeAdjacentTextEvents(events: readonly AgentEvent[] | undefined): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const event of events ?? []) {
    const last = out[out.length - 1];
    if (last && isDelta(event) && isDelta(last) && last.kind === event.kind) {
      out[out.length - 1] = { kind: last.kind, text: last.text + event.text };
      continue;
    }
    out.push(event);
  }
  return out;
}
