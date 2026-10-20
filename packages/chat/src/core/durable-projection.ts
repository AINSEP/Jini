import type { AgentEvent } from './events.js';
import type { ChatMessage } from './messages.js';

function identity(event: AgentEvent, usageOccurrences: Map<string, number>): string {
  const wire = event as AgentEvent & { cursor?: string | number; eventId?: string };
  if (wire.eventId !== undefined) return `event:${wire.eventId}`;
  if (wire.cursor !== undefined) return `cursor:${wire.cursor}`;
  if (event.kind === 'tool_use') return `use:${event.id}`;
  if (event.kind === 'tool_result') return `result:${event.toolUseId}`;
  const snapshot = JSON.stringify(event);
  if (event.kind === 'usage') {
    // Two segments can have identical counters. Match occurrence-for-occurrence during replay,
    // rather than treating equal charges as the same event and silently dropping one segment.
    const occurrence = (usageOccurrences.get(snapshot) ?? 0) + 1;
    usageOccurrences.set(snapshot, occurrence);
    return `usage:${snapshot}:${occurrence}`;
  }
  return snapshot;
}

function textOf(events: readonly AgentEvent[]): string {
  return events.filter((event) => event.kind === 'text').map((event) => event.text).join('');
}

/** Records `key` and reports whether it was new, so each identifiable event is merged once. */
function claimNewKey({ key, keys }: { key: string; keys: Set<string> }): boolean {
  if (keys.has(key)) return false;
  keys.add(key);
  return true;
}

const NO_ROLLOUT = /no rollout found for thread id/;

/** The missing native resume diagnostic, in either the status or the raw-line form a runtime emits. */
function isNoRolloutDiagnostic({ event }: { event: AgentEvent }): boolean {
  if (event.kind === 'status') return NO_ROLLOUT.test(`${event.label}\n${event.detail ?? ''}`);
  return event.kind === 'raw' && NO_ROLLOUT.test(event.line);
}

/** Saved checkpoints can coalesce deltas and a completion may replay only a prefix. Keep the
 * saved projection, merge identifiable events, and append only text beyond its saved prefix. */
export function mergeRunEvents({ saved, incoming }: { saved?: readonly AgentEvent[] | undefined; incoming: readonly AgentEvent[] }, _optional = {}): AgentEvent[] {
  const previous = saved ?? [];
  const result = [...previous];
  const savedUsage = new Map<string, number>();
  const incomingUsage = new Map<string, number>();
  const keys = new Set(previous.map(event => identity(event, savedUsage)));
  const before = textOf(previous);
  const after = textOf(incoming);
  let skip = after.startsWith(before) ? before.length : after.length;
  for (const event of incoming) {
    if (event.kind === 'text') {
      const text = event.text.slice(skip);
      skip = Math.max(0, skip - event.text.length);
      if (text) result.push({ ...event, text });
    } else if (claimNewKey({ key: identity(event, incomingUsage), keys })) {
      result.push(event);
    }
  }
  return result;
}

/** A recovered attempt stays visibly in progress until new text or tool work supersedes its marker. */
export function continuingRunNotice({ events, active }: { events: readonly AgentEvent[] | undefined; active: boolean }, _optional = {}): string | null {
  if (!active) return null;
  const list = events ?? [];
  const marker = list.findLastIndex((event) => event.kind === 'status' && event.code === 'run_recovering');
  if (marker < 0) return null;
  const markerEvent = list[marker];
  if (markerEvent?.kind === 'status' && markerEvent.label === '') return null;
  const progressed = list.slice(marker + 1).some((event) => event.kind === 'text' || event.kind === 'tool_use' || event.kind === 'tool_result');
  return progressed ? null : 'Continuing…';
}

export function preserveAssistantContent({ saved, incoming }: { saved: string; incoming: string }, _optional = {}): string {
  return incoming.length >= saved.length ? incoming : saved;
}

/** Terminal failure belongs to the message. Legacy resend instructions are display-only;
 * changing this copy must never execute or reopen an old terminal run. */
export function terminalMessageNotice({ message }: { message: ChatMessage }, _optional = {}): string | null {
  if (message.runStatus !== 'failed' && message.runStatus !== 'canceled') return null;
  const notice = message.events?.filter((event) => event.kind === 'status' &&
    (event.code === 'run_terminal' || /failed|stopped|restarted|could not|not logged in|cancell?ed/i.test(event.label))).at(-1);
  if (notice?.kind === 'status') return [notice.label, notice.detail].filter(Boolean).join(' ').replace(/Send your message again to retry\.?/gi, '').trim();
  return message.runStatus === 'failed' ? 'This turn failed.' : 'Stopped.';
}

/** The first answer has no earlier segment to divide, even if startup was retried. Only saved
 * visible text can justify a Continued divider; the recovery marker still records the attempt. */
export function recoveredRunEvents({ saved }: { saved: readonly AgentEvent[] }, { notice = 'visible' }: { notice?: 'visible' | 'silent' } = {}): AgentEvent[] {
  if (notice === 'silent') {
    // A missing rollout is an expected reconstruction fallback, not a failed user turn. Keep an
    // invisible attempt marker for fencing/diagnostic offsets, and preserve all unrelated work.
    const attemptStart = saved.findLastIndex(event => event.kind === 'status' && event.code === 'run_recovering') + 1;
    const diagnostic = saved.findIndex((event, index) => index >= attemptStart && isNoRolloutDiagnostic({ event }));
    const events = saved.filter((event, index) => {
      if (diagnostic < 0 || index < attemptStart) return true;
      if (event.kind === 'status' && event.label === 'Run failed — the agent process exited without answering') return false;
      return !isNoRolloutDiagnostic({ event });
    });
    return [...events, { kind: 'status', code: 'run_recovering', label: '' }];
  }
  const hasAnswer = saved.some(event => event.kind === 'text' && event.text.trim().length > 0);
  return [...saved, ...(hasAnswer ? [{ kind: 'text' as const, text: '\n\n---\n\nContinued\n\n' }] : []),
    { kind: 'status', code: 'run_recovering', label: 'Continuing…' }];
}
