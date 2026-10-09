import type { AgentEvent } from './events.js';
type UsageEvent = Extract<AgentEvent, { kind: 'usage' }>;

/** Sum per-segment usage for the whole turn, including aborted segments and recovered attempts.
 * Missing fields stay absent; monetary charges are never inferred. O(n) time, O(1) space. */
export function turnUsage({ events }: { events: readonly AgentEvent[] | undefined }, _optional = {}): UsageEvent | undefined {
  let total: UsageEvent | undefined;
  for (const event of events ?? []) {
    if (event.kind !== 'usage') continue;
    total ??= { kind: 'usage' };
    for (const field of ['inputTokens', 'outputTokens', 'costUsd', 'durationMs'] as const) {
      const value = event[field];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) total[field] = (total[field] ?? 0) + value;
    }
  }
  return total;
}
