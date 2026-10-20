/** Accepted composer input has one identity across optimistic display, replay and recall. */
import { questionAnswerFromResult } from './question-answer.js';
import type { AgentEvent } from './events.js';
import type { ChatMessage } from './messages.js';
import { MID_RUN_USER_MESSAGE_EVENT_NAME } from './turn-usage.js';

export interface AcceptedChatInput {
  id: string;
  text: string;
  /** Wire ids replaced by this receipt remain seen by recall. */
  aliases?: readonly string[];
}

type UserMessageEvent = Extract<AgentEvent, { kind: 'ext' }> & {
  data: AcceptedChatInput & { optimistic?: boolean; toolUseId?: string; afterInputId?: string; inputs?: AcceptedChatInput[] };
};

/** Reads the existing event-backed user bubble without depending on a host renderer. */
export function acceptedInputEvent({ event }: { event: AgentEvent }, _options = {}): UserMessageEvent | null {
  if (event.kind !== 'ext' || event.name !== MID_RUN_USER_MESSAGE_EVENT_NAME) return null;
  const data = event.data as Partial<UserMessageEvent['data']> | null;
  return data && typeof data.id === 'string' && typeof data.text === 'string' ? event as UserMessageEvent : null;
}

/** Project a persisted answer through the same receipt owner as composer input. */
function questionAnswerEvent({ event, input }: { event: AgentEvent; input: unknown }, _options = {}): UserMessageEvent | null {
  if (event.kind !== 'tool_result') return null;
  const text = questionAnswerFromResult({ result: event, input });
  if (text === undefined) return null;
  return { kind: 'ext', name: MID_RUN_USER_MESSAGE_EVENT_NAME,
    data: { id: `answer:${event.toolUseId}`, text, toolUseId: event.toolUseId } };
}

/** Builds the same bubble for delivered answers and steering; queues use the existing pending row. */
export function acceptedInputUserEvent(
  { input, inputs, toolUseId, afterInputId }: { input: AcceptedChatInput; inputs?: AcceptedChatInput[]; toolUseId?: string; afterInputId?: string },
  { receipt = 'optimistic' }: { receipt?: 'optimistic' | 'accepted' } = {},
): AgentEvent {
  return { kind: 'ext', name: MID_RUN_USER_MESSAGE_EVENT_NAME,
    data: { ...input, ...(receipt === 'optimistic' ? { optimistic: true } : {}), ...(inputs === undefined ? {} : { inputs }), ...(afterInputId === undefined ? {} : { afterInputId }), ...(toolUseId === undefined ? {} : { toolUseId }) } };
}

/** Projects saved answers and reconciles optimistic bubbles with wire events, occurrence for
 * occurrence. Legacy steering receipts have no client id: only unmatched optimistic input may
 * match by text; two real events with equal text always remain distinct.
 * @complexity O(e + u + a) time, O(e + u) space for e events, u user inputs and total answer-label lookup cost a.
 */
export function projectAcceptedInputEvents(
  { events }: { events: readonly AgentEvent[] }, _options = {},
): AgentEvent[] {
  const savedAnswers = new Set(events.flatMap(event => {
    const input = acceptedInputEvent({ event });
    return input && !input.data.optimistic && input.data.toolUseId ? [input.data.toolUseId] : [];
  }));
  // MOVE: Persisted picks carry values; the original tool input retains their human-readable labels.
  const questions = new Map(events.flatMap(event => event.kind === 'tool_use' ? [[event.id, event.input] as const] : []));
  const expanded = events.flatMap(event => {
    const answer = questionAnswerEvent({ event, input: event.kind === 'tool_result' ? questions.get(event.toolUseId) : undefined });
    return answer && !savedAnswers.has(answer.data.toolUseId!) ? [event, answer] : [event];
  });
  const optimisticByText = new Map<string, { events: UserMessageEvent[]; index: number }>();
  const optimisticByQuestion = new Map<string, UserMessageEvent>();
  for (const event of expanded) {
    const input = acceptedInputEvent({ event });
    if (!input?.data.optimistic) continue;
    if (input.data.toolUseId) optimisticByQuestion.set(input.data.toolUseId, input);
    else {
      const list = optimisticByText.get(input.data.text) ?? { events: [], index: 0 };
      list.events.push(input);
      optimisticByText.set(input.data.text, list);
    }
  }
  const replacements = new Map<AgentEvent, AgentEvent>();
  const replaced = new Set<AgentEvent>();
  const seen = new Set<string>();
  for (const event of expanded) {
    const input = acceptedInputEvent({ event });
    if (!input || input.data.optimistic) continue;
    const ids = [input.data.id, ...(input.data.toolUseId ? [`answer:${input.data.toolUseId}`] : []), ...(input.data.aliases ?? [])];
    if (ids.some(id => seen.has(id))) { replaced.add(event); continue; }
    const candidates = optimisticByText.get(input.data.text);
    const next = candidates?.events[candidates.index];
    const follows = next?.data.afterInputId === undefined || seen.has(next.data.afterInputId);
    for (const id of ids) seen.add(id);
    const pending = input.data.toolUseId ? optimisticByQuestion.get(input.data.toolUseId) : follows ? next : undefined;
    if (pending && candidates && !input.data.toolUseId) candidates.index += 1;
    if (!pending) continue;
    for (const id of [pending.data.id, ...(pending.data.aliases ?? [])]) seen.add(id);
    optimisticByQuestion.delete(input.data.toolUseId ?? '');
    replaced.add(pending);
    replacements.set(event, { ...input, data: { ...input.data, id: pending.data.id,
      ...(pending.data.inputs ? { inputs: pending.data.inputs } : {}),
      aliases: [...new Set([...(input.data.aliases ?? []), input.data.id, ...(pending.data.aliases ?? [])])] } });
  }
  const projected: AgentEvent[] = [];
  const emitted = new Set<string>();
  for (const event of expanded) {
    if (replaced.has(event)) continue;
    const next = replacements.get(event) ?? event;
    const input = acceptedInputEvent({ event: next });
    if (input && emitted.has(input.data.id)) continue;
    if (input) emitted.add(input.data.id);
    projected.push(next);
  }
  return projected;
}

/** The sole transcript-to-recall projection. A merged queued turn retains its original inputs. */
export function acceptedInputsFromMessages(
  { messages }: { messages: readonly ChatMessage[] }, _options = {},
): AcceptedChatInput[] {
  return messages.flatMap(message => {
    if (message.role === 'user') {
      if (message.inputPending) return [];
      // Queue constituents travel in events_json, already preserved by the existing chat store.
      const receipts = (message.events ?? []).flatMap(event => {
        const input = acceptedInputEvent({ event });
        return input ? [input.data] : [];
      });
      return receipts.length > 0 ? receipts : [{ id: message.id, text: message.content }];
    }
    return projectAcceptedInputEvents({ events: message.events ?? [] }).flatMap(event => {
      const input = acceptedInputEvent({ event });
      if (!input) return [];
      return input.data.inputs?.map((receipt, index) => index === 0 ? { ...receipt, aliases: input.data.aliases ?? [] } : receipt) ?? [input.data];
    });
  });
}
