import type { AgentEvent } from './events.js';
import type { ChatMessage } from './messages.js';
type UsageEvent = Extract<AgentEvent, { kind: 'usage' }>;
/** A turn's reported usage plus the conversation's prefix total. `segments` is present only when the
 * message holds more than one reply (a mid-run message started a new one): one entry per reply, in
 * order, each with its own prefix total, so every reply can show its own "Done" line. */
export type ChatUsageSummary = UsageEvent & { totalCostUsd?: number; segments?: readonly (ChatUsageSummary | undefined)[] };
type SessionCost = { sessionId: string; chargedUsd: number };

/** The ext event a message sent mid-run arrives as (the daemon's `user_message` run event). The agent
 * answers it as a new reply inside the same run, so it ends the reply before it. */
export const MID_RUN_USER_MESSAGE_EVENT_NAME = 'user_message';

/** Whether this event is a mid-run user message, i.e. the boundary between two replies of one run. */
export function isReplyBoundary({ event }: { event: AgentEvent }, _optional = {}): boolean {
  return event.kind === 'ext' && event.name === MID_RUN_USER_MESSAGE_EVENT_NAME;
}

/** Queued/consumed receipts update one input, so usage must split that reply only once. */
function newReplyBoundary({ event, seen }: { event: AgentEvent; seen: Set<string> }, _options = {}): boolean {
  if (!isReplyBoundary({ event })) return false;
  const id = (event as Extract<AgentEvent, { kind: 'ext' }>).data as { id?: unknown } | null;
  if (typeof id?.id !== 'string') return true;
  if (seen.has(id.id)) return false;
  seen.add(id.id);
  return true;
}

/** Split one assistant message's events into replies at each mid-run user message. A usage event
 * that lands after a boundary but before the next reply produced anything is the interrupted
 * reply's own result (the daemon notes it can arrive after the interrupt ack), so it stays with
 * the reply before. Event order is otherwise preserved. O(n) for n events.
 * @example replySegments({ events }).length // 1 + number of mid-run user messages */
export function replySegments({ events }: { events: readonly AgentEvent[] | undefined }, _optional = {}): AgentEvent[][] {
  const segments: AgentEvent[][] = [[]];
  let started = false;
  const seen = new Set<string>();
  for (const event of events ?? []) {
    if (newReplyBoundary({ event, seen })) {
      segments.push([]);
      started = false;
      continue;
    }
    const lateResult = event.kind === 'usage' && !started && segments.length > 1;
    started ||= producesReplyOutput({ event });
    segments[segments.length - (lateResult ? 2 : 1)]!.push(event);
  }
  return segments;
}

/** Usage, status and raw lines are bookkeeping; anything else means the reply has produced output. */
function producesReplyOutput({ event }: { event: AgentEvent }, _optional = {}): boolean {
  return !['usage', 'status', 'raw'].includes(event.kind) && !isReplyBoundary({ event });
}

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
    addReportedCounts({ total, event });
    if (event.stopReason !== undefined) total.stopReason = event.stopReason;
    const cost = usageCost({ event, agentId, sessions });
    if (cost !== undefined) total.costUsd = (total.costUsd ?? 0) + cost;
  }
  return total;
}

/** Add an event's well-formed token and duration counts into `total`, in place. */
function addReportedCounts({ total, event }: { total: UsageEvent; event: UsageEvent }, _optional = {}): void {
  for (const field of ['inputTokens', 'outputTokens', 'durationMs'] as const) {
    const value = event[field];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) total[field] = (total[field] ?? 0) + value;
  }
}

/** Add one reply's usage into a message total; fields absent from both stay absent. O(1). */
function addUsage({ total, usage }: { total: UsageEvent | undefined; usage: UsageEvent | undefined }, _optional = {}): UsageEvent | undefined {
  if (!usage) return total;
  const next: UsageEvent = { ...(total ?? { kind: 'usage' }) };
  if (usage.stopReason !== undefined) next.stopReason = usage.stopReason;
  for (const field of ['inputTokens', 'outputTokens', 'durationMs', 'costUsd'] as const) {
    const value = usage[field];
    if (value !== undefined) next[field] = (next[field] ?? 0) + value;
  }
  return next;
}

/** Derive per-turn charges and prefix totals from persisted events_json, for live and reloaded
 * chats alike. Single replies without reported duration use the message's elapsed run time.
 * A message with mid-run replies also gets per-reply `segments`. O(e + m) for e events
 * and m messages; no per-row transcript scans or I/O.
 * @example conversationUsage({ messages: savedMessages }).get('assistant-2') */
export function conversationUsage({ messages }: { messages: readonly ChatMessage[] }, _optional = {}): Map<string, ChatUsageSummary> {
  const sessions = new Map<string, SessionCost>();
  const summaries = new Map<string, ChatUsageSummary>();
  let totalCostUsd: number | undefined;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const result = messageUsage({ message, sessions, totalCostUsd });
    totalCostUsd = result.totalCostUsd;
    if (result.usage) summaries.set(message.id, messageSummary({ ...result, usage: result.usage, message }));
  }
  return summaries;
}

/** A message's summary: its usage, the prefix total, and per-reply segments when it holds several replies. */
function messageSummary(
  { usage, segments, totalCostUsd, message }: {
    usage: UsageEvent;
    segments: (ChatUsageSummary | undefined)[];
    totalCostUsd: number | undefined;
    message: ChatMessage;
  },
  _optional = {},
): ChatUsageSummary {
  // Tokens-only runtimes still have run timestamps; those cannot time individual mid-run replies.
  if (segments.length === 1) fillRunDuration({ usage, message });
  return {
    ...usage,
    ...(totalCostUsd === undefined ? {} : { totalCostUsd }),
    ...(segments.length > 1 ? { segments } : {}),
  };
}

/** One assistant message's summed usage and per-reply summaries, advancing the conversation's prefix total. */
function messageUsage(
  { message, sessions, totalCostUsd }: { message: ChatMessage; sessions: Map<string, SessionCost>; totalCostUsd: number | undefined },
  _optional = {},
): { usage: UsageEvent | undefined; segments: (ChatUsageSummary | undefined)[]; totalCostUsd: number | undefined } {
  // Replies run in event order through one session map, so their sum equals the whole-message charge.
  const segments: (ChatUsageSummary | undefined)[] = [];
  let usage: UsageEvent | undefined;
  let prefixTotal = totalCostUsd;
  for (const events of replySegments({ events: message.events })) {
    const segment = turnUsage({ events }, { sessions, agentId: message.agentId ?? '' });
    usage = addUsage({ total: usage, usage: segment });
    if (segment?.costUsd !== undefined) prefixTotal = (prefixTotal ?? 0) + segment.costUsd;
    segments.push(segment && { ...segment, ...(prefixTotal === undefined ? {} : { totalCostUsd: prefixTotal }) });
  }
  return { usage, segments, totalCostUsd: prefixTotal };
}

/** Use the message's elapsed run time when no reply reported a duration; invalid timestamps stay unknown. */
function fillRunDuration({ usage, message }: { usage: UsageEvent; message: ChatMessage }, _optional = {}): void {
  if (usage.durationMs !== undefined || message.startedAt === undefined || message.endedAt === undefined) return;
  const durationMs = message.endedAt - message.startedAt;
  if (Number.isFinite(durationMs) && durationMs >= 0) usage.durationMs = durationMs;
}
