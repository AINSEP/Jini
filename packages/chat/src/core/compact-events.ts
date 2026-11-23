import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

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
export function mergeAdjacentTextEvents({ events }: { events: readonly AgentEvent[] | undefined }): AgentEvent[] {
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
