import type { AgentEvent } from './events.js';
import type { ChatMessage } from './messages.js';
type UsageEvent = Extract<AgentEvent, { kind: 'usage' }>;
export type ChatUsageSummary = UsageEvent & { totalCostUsd?: number };
type SessionCost = { sessionId: string; chargedUsd: number };

/** Resolve one charge against this agent/session's last snapshot. State is local to an
 * ordered transcript projection; revisiting a session keeps its baseline. A lower snapshot
 * starts a new counter epoch (some CLIs reset their counter on resume). O(1) map access. */
function usageCost({ event, agentId, sessions }: { event: UsageEvent; agentId: string; sessions: Map<string, SessionCost> }, _optional = {}): number | undefined {
  const sessionId = event.costSessionId;
  if (!sessionId) return validCost(event.costUsd);
  const key = JSON.stringify([agentId, sessionId]);
  const chargedUsd = sessions.get(key)?.chargedUsd ?? 0;
  const cumulative = validCost(event.cumulativeCostUsd);
  const cost = cumulative === undefined ? validCost(event.costUsd)
    : cumulative < chargedUsd ? cumulative : cumulative - chargedUsd;
  // Interim interrupted-segment charges are already paid; later snapshots subtract them.
  // After a counter reset the new snapshot, rather than the old epoch's total, is the baseline.
  sessions.set(key, { sessionId, chargedUsd: cumulative ?? chargedUsd + (cost ?? 0) });
  return cost;
}

/** Missing or malformed costs stay unknown; never infer charges from tokens. */
function validCost(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Sum reported segment usage for a turn, including aborted segments and recovered attempts.
 * Optional projection state is updated to reconcile session snapshots across turns.
 * Missing fields stay absent; money is never inferred. O(n) time for n events.
 * @example turnUsage({ events: message.events }) */
export function turnUsage({ events }: { events: readonly AgentEvent[] | undefined }, { sessions = new Map<string, SessionCost>(), agentId = '' }: { sessions?: Map<string, SessionCost>; agentId?: string } = {}): UsageEvent | undefined {
  let total: UsageEvent | undefined;
  for (const event of events ?? []) {
    if (event.kind !== 'usage') continue;
    total ??= { kind: 'usage' };
    for (const field of ['inputTokens', 'outputTokens', 'durationMs'] as const) {
      const value = event[field];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) total[field] = (total[field] ?? 0) + value;
    }
    const cost = usageCost({ event, agentId, sessions });
    if (cost !== undefined) total.costUsd = (total.costUsd ?? 0) + cost;
  }
  return total;
}

/** Derive per-turn charges and prefix totals from persisted events_json, for live and reloaded
 * chats alike. O(e + m) for e events and m messages; no per-row transcript scans or I/O.
 * @example conversationUsage({ messages: savedMessages }).get('assistant-2') */
export function conversationUsage({ messages }: { messages: readonly ChatMessage[] }, _optional = {}): Map<string, ChatUsageSummary> {
  const sessions = new Map<string, SessionCost>();
  const summaries = new Map<string, ChatUsageSummary>();
  let totalCostUsd: number | undefined;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const usage = turnUsage({ events: message.events }, { sessions, agentId: message.agentId ?? '' });
    if (!usage) continue;
    if (usage.costUsd !== undefined) totalCostUsd = (totalCostUsd ?? 0) + usage.costUsd;
    summaries.set(message.id, { ...usage, ...(totalCostUsd === undefined ? {} : { totalCostUsd }) });
  }
  return summaries;
}
