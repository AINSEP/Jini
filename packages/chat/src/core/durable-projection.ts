import type { AgentEvent } from './events.js';
import type { ChatMessage } from './messages.js';

function identity(event: AgentEvent): string {
  const wire = event as AgentEvent & { cursor?: string | number; eventId?: string };
  if (wire.eventId !== undefined) return `event:${wire.eventId}`;
  if (wire.cursor !== undefined) return `cursor:${wire.cursor}`;
  if (event.kind === 'tool_use') return `use:${event.id}`;
  if (event.kind === 'tool_result') return `result:${event.toolUseId}`;
  return JSON.stringify(event);
}

function textOf(events: readonly AgentEvent[]): string {
  return events.filter((event) => event.kind === 'text').map((event) => event.text).join('');
}

/** Saved checkpoints can coalesce deltas and a completion may replay only a prefix. Keep the
 * saved projection, merge identifiable events, and append only text beyond its saved prefix. */
export function mergeRunEvents({ saved, incoming }: { saved?: readonly AgentEvent[] | undefined; incoming: readonly AgentEvent[] }, _optional = {}): AgentEvent[] {
  const previous = saved ?? [];
  const result = [...previous];
  const keys = new Set(previous.map(identity));
  const before = textOf(previous);
  const after = textOf(incoming);
  let skip = after.startsWith(before) ? before.length : after.length;
  for (const event of incoming) {
    if (event.kind === 'text') {
      const text = event.text.slice(skip);
      skip = Math.max(0, skip - event.text.length);
      if (text) result.push({ ...event, text });
    } else if (!keys.has(identity(event))) {
      keys.add(identity(event));
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
export function recoveredRunEvents({ saved }: { saved: readonly AgentEvent[] }, _optional = {}): AgentEvent[] {
  const hasAnswer = saved.some(event => event.kind === 'text' && event.text.trim().length > 0);
  return [...saved, ...(hasAnswer ? [{ kind: 'text' as const, text: '\n\n---\n\nContinued\n\n' }] : []),
    { kind: 'status', code: 'run_recovering', label: 'Continuing…' }];
}
