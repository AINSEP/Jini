import type { AgentEvent } from './events.js';

/**
 * Drop repeated `tool_use` events that share an `id`. A retried/duplicated
 * stream can replay the same tool-call id (e.g. reconnect-and-replay landing
 * an event twice); rendering it twice would show a phantom second call.
 * Non-`tool_use` events (and the first occurrence of each id) pass through
 * unchanged and in original order.
 *
 * @param events - The event list to dedupe, or `undefined` for an empty conversation turn.
 * @returns A new array with later duplicate `tool_use` events removed, or the
 *   original array reference when nothing needed to change (cheap no-op for
 *   the common case).
 * @complexity O(n) time / O(k) extra space, where `n` is `events.length` and
 *   `k` is the number of distinct `tool_use` ids seen — one linear pass with
 *   a `Set` membership check.
 */
export function dedupeToolUsesById(events: AgentEvent[] | undefined): AgentEvent[] {
  if (!events || events.length === 0) return [];

  const seen = new Set<string>();
  let deduped: AgentEvent[] | null = null;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]!;
    if (event.kind === 'tool_use') {
      if (seen.has(event.id)) {
        if (!deduped) deduped = events.slice(0, i);
        continue;
      }
      seen.add(event.id);
    }
    if (deduped) deduped.push(event);
  }

  return deduped ?? events;
}
