/** Accepted composer input has one identity across optimistic display, replay and recall. */
import { questionAnswerFromResult, questionAnswerLabel } from './question-answer.js';
import type { AgentEvent } from './events.js';
import type { ChatAttachment, ChatMessage } from './messages.js';
import { MID_RUN_USER_MESSAGE_EVENT_NAME } from './turn-usage.js';

export interface AcceptedChatInput {
  id: string;
  text: string;
  /** Standalone questions have no owning tool id; a receipt answers the preceding document at its URI. */
  surfaceUri?: string;
  /** The card's answer without its title; text retains the complete user bubble. */
  answerText?: string;
  /** Absent for legacy/ordinary inputs; consumed only after a CLI UUID receipt. */
  deliveryState?: 'queued' | 'consumed';
  attachments?: ChatAttachment[];
  secretRedaction?: ChatMessage['secretRedaction'];
  /** Wire ids replaced by this receipt remain seen by recall. */
  aliases?: readonly string[];
}

/** Display queue constituents using their accepted identities; storage and delivery retain one turn.
 * MOVE: Receipts travel in events_json, so separate bubbles survive a history reload without another store.
 * @complexity O(m + e + i) time/space for m messages, e receipt events and i accepted queue inputs.
 */
export function projectAcceptedInputMessages({ messages }: { messages: readonly ChatMessage[] }, _options = {}): ChatMessage[] {
  return messages.flatMap(message => {
    if (message.role !== 'user') return [message];
    const inputs = (message.events ?? []).flatMap(event => {
      const input = acceptedInputEvent({ event });
      return input ? [input.data] : [];
    });
    if (inputs.length === 0) return [message];
    const { attachments: _attachments, secretRedaction: _redaction, ...turn } = message;
    // MOVE: Older receipts have no per-input files; retain those legacy files on the final bubble.
    return inputs.map((input, index) => ({ ...turn, id: input.id, content: input.text,
      attachments: input.attachments ?? (index === inputs.length - 1 ? message.attachments ?? [] : []), ...(input.secretRedaction ? { secretRedaction: input.secretRedaction } : {}) }));
  });
}

type UserMessageEvent = Extract<AgentEvent, { kind: 'ext' }> & {
  data: AcceptedChatInput & { optimistic?: boolean; toolUseId?: string; afterInputId?: string; inputs?: AcceptedChatInput[] };
};

/** Hosts can recover standalone form labels without adding a DOM dependency to core. */
export interface AcceptedInputProjectionOptions {
  answerContexts?: ReadonlyMap<string, { input: unknown; includeTitle?: boolean }>;
}

/** Reads the existing event-backed user bubble without depending on a host renderer. */
export function acceptedInputEvent({ event }: { event: AgentEvent }, _options = {}): UserMessageEvent | null {
  if (event.kind !== 'ext' || event.name !== MID_RUN_USER_MESSAGE_EVENT_NAME) return null;
  const data = event.data as Partial<UserMessageEvent['data']> | null;
  return data && typeof data.id === 'string' && typeof data.text === 'string' ? event as UserMessageEvent : null;
}

/** Read resource identity without importing the browser/UI parser into core. */
function surfaceUriOf({ event }: { event: AgentEvent }, _options = {}): string | undefined {
  if (event.kind !== 'ext' || event.name !== 'mcp-ui') return undefined;
  const data = event.data as { resource?: { uri?: unknown } } | null;
  return typeof data?.resource?.uri === 'string' ? data.resource.uri : undefined;
}

/** Bind each unique receipt to the preceding document, never a later outcome or retry at its URI.
 * Both transcript closure and activity use this projection; resource identity alone is not an answer.
 * @returns Answer labels keyed by the original ext-event data; no caller mutation or I/O.
 * @complexity O(e) time/space for events, including replay deduplication by accepted-input id.
 */
export function recordedSurfaceAnswers({ events }: { events: readonly AgentEvent[] }, _options = {}): ReadonlyMap<unknown, string> {
  const latest = new Map<string, unknown>();
  const answers = new Map<unknown, string>();
  const seen = new Set<string>();
  for (const event of events) {
    const uri = surfaceUriOf({ event });
    if (uri !== undefined && event.kind === 'ext') latest.set(uri, event.data);
    const receipt = acceptedInputEvent({ event })?.data;
    if (typeof receipt?.surfaceUri !== 'string' || seen.has(receipt.id)) continue;
    seen.add(receipt.id);
    const document = latest.get(receipt.surfaceUri);
    if (document !== undefined) answers.set(document, typeof receipt.answerText === 'string' ? receipt.answerText : receipt.text);
  }
  return answers;
}

/** Project a persisted answer through the same receipt owner as composer input. */
function questionAnswerEvent({ event, input }: { event: AgentEvent; input: unknown }, { includeTitle = false }: { includeTitle?: boolean } = {}): UserMessageEvent | null {
  if (event.kind !== 'tool_result') return null;
  const text = questionAnswerFromResult({ result: event, input });
  if (text === undefined) return null;
  // A standalone form's bubble reads like its closed card: "<title>: <answer>".
  return { kind: 'ext', name: MID_RUN_USER_MESSAGE_EVENT_NAME,
    data: { id: `answer:${event.toolUseId}`, text: includeTitle ? questionAnswerLabel({ input, text }) : text, toolUseId: event.toolUseId } };
}

/** Builds the same bubble for delivered answers and steering; queues use the existing pending row. */
export function acceptedInputUserEvent(
  { input, inputs, toolUseId, afterInputId }: { input: AcceptedChatInput; inputs?: AcceptedChatInput[]; toolUseId?: string; afterInputId?: string },
  { receipt = 'optimistic' }: { receipt?: 'optimistic' | 'accepted' } = {},
): AgentEvent {
  return { kind: 'ext', name: MID_RUN_USER_MESSAGE_EVENT_NAME,
    data: { ...input, ...(receipt === 'optimistic' ? { optimistic: true } : {}), ...(inputs === undefined ? {} : { inputs }), ...(afterInputId === undefined ? {} : { afterInputId }), ...(toolUseId === undefined ? {} : { toolUseId }) } };
}

type OptimisticTextQueue = { events: UserMessageEvent[]; index: number };
type OptimisticInputs = { byText: Map<string, OptimisticTextQueue>; byQuestion: Map<string, UserMessageEvent> };
type InputReconciliation = { replacements: Map<AgentEvent, AgentEvent>; replaced: Set<AgentEvent>; seen: Set<string> };

function expandQuestionAnswers({ events }: { events: readonly AgentEvent[] }, { answerContexts }: AcceptedInputProjectionOptions = {}): AgentEvent[] {
  const savedAnswers = new Set(events.flatMap(event => {
    const input = acceptedInputEvent({ event });
    return input && !input.data.optimistic && input.data.toolUseId ? [input.data.toolUseId] : [];
  }));
  // MOVE: Persisted picks carry values; the original tool input retains their human-readable labels.
  const questions = new Map(events.flatMap(event => event.kind === 'tool_use' ? [[event.id, event.input] as const] : []));
  const answers = new Map(events.flatMap(event => {
    const context = event.kind === 'tool_result' ? answerContexts?.get(event.toolUseId) : undefined;
    const input = context ? context.input : event.kind === 'tool_result' ? questions.get(event.toolUseId) : undefined;
    const answer = questionAnswerEvent({ event, input }, { includeTitle: context?.includeTitle === true });
    return answer ? [[answer.data.toolUseId!, answer] as const] : [];
  }));
  return events.flatMap(event => {
    const receipt = acceptedInputEvent({ event });
    const recorded = receipt?.data.toolUseId ? answers.get(receipt.data.toolUseId) : undefined;
    if (receipt && recorded) return [{ ...receipt, data: { ...receipt.data, text: recorded.data.text } }];
    const answer = event.kind === 'tool_result' ? answers.get(event.toolUseId) : undefined;
    return answer && !savedAnswers.has(answer.data.toolUseId!) ? [event, answer] : [event];
  });
}

function collectOptimisticInputs({ events }: { events: readonly AgentEvent[] }, _options = {}): OptimisticInputs {
  const optimisticByText = new Map<string, { events: UserMessageEvent[]; index: number }>();
  const optimisticByQuestion = new Map<string, UserMessageEvent>();
  for (const event of events) {
    const input = acceptedInputEvent({ event });
    if (!input?.data.optimistic) continue;
    if (input.data.toolUseId) optimisticByQuestion.set(input.data.toolUseId, input);
    else {
      const list = optimisticByText.get(input.data.text) ?? { events: [], index: 0 };
      list.events.push(input);
      optimisticByText.set(input.data.text, list);
    }
  }
  return { byText: optimisticByText, byQuestion: optimisticByQuestion };
}

function matchOptimisticInput(
  { input, optimistic, seen }: { input: UserMessageEvent; optimistic: OptimisticInputs; seen: Set<string> }, _options = {},
): UserMessageEvent | undefined {
  const candidates = optimistic.byText.get(input.data.text);
  const next = candidates?.events[candidates.index];
  const follows = next?.data.afterInputId === undefined || seen.has(next.data.afterInputId);
  // Keep predecessor testing before the caller adds this receipt's ids to seen.
  return input.data.toolUseId ? optimistic.byQuestion.get(input.data.toolUseId) : follows ? next : undefined;
}

/** Apply authoritative receipt data while retaining local identity and queued constituents. */
function mergeAcceptedReceipt(
  { input, pending }: { input: UserMessageEvent; pending: UserMessageEvent }, _options = {},
): UserMessageEvent {
  // Replayed queue acceptance cannot undo confirmed consumption.
  const deliveryState = pending.data.deliveryState === 'consumed' ? 'consumed' : input.data.deliveryState ?? pending.data.deliveryState;
  const { optimistic: _optimistic, afterInputId: _afterInputId, ...pendingData } = pending.data;
  const aliases = [...new Set([...(input.data.aliases ?? []), input.data.id, ...(pending.data.aliases ?? [])])].filter(id => id !== pending.data.id);
  return { ...input, data: { ...pendingData, ...input.data, id: pending.data.id,
    // Legacy acceptance receipts omit state; HTTP acceptance still means queued until consumption.
    ...(deliveryState === undefined ? {} : { deliveryState }),
    ...(pending.data.inputs ? { inputs: pending.data.inputs.map(item => ({ ...item, ...(deliveryState ? { deliveryState } : {}) })) } : {}),
    ...(aliases.length > 0 ? { aliases } : {}) } };
}

function acceptedInputIds({ input }: { input: UserMessageEvent }, _options = {}): string[] {
  return [input.data.id, ...(input.data.toolUseId ? [`answer:${input.data.toolUseId}`] : []), ...(input.data.aliases ?? [])];
}

function reconcileAcceptedInput(
  { event, optimistic, state }: { event: AgentEvent; optimistic: OptimisticInputs; state: InputReconciliation }, _options = {},
): void {
  const input = acceptedInputEvent({ event });
  if (!input || input.data.optimistic) return;
  const { replacements, replaced, seen } = state;
  const ids = acceptedInputIds({ input });
  if (ids.some(id => seen.has(id))) { replaced.add(event); return; }
  const pending = matchOptimisticInput({ input, optimistic, seen });
  for (const id of ids) seen.add(id);
  if (!pending) return;
  advanceOptimisticInput({ input, optimistic });
  for (const id of [pending.data.id, ...(pending.data.aliases ?? [])]) seen.add(id);
  optimistic.byQuestion.delete(input.data.toolUseId ?? '');
  // Acceptance can arrive after the reply it triggered. Keep the position where the person sent it.
  replaced.add(event);
  replacements.set(pending, mergeAcceptedReceipt({ input, pending }));
}

function advanceOptimisticInput(
  { input, optimistic }: { input: UserMessageEvent; optimistic: OptimisticInputs }, _options = {},
): void {
  const candidates = optimistic.byText.get(input.data.text);
  if (candidates && !input.data.toolUseId) candidates.index += 1;
}

/** Fold state updates into the original bubble, preserving its position, local id and aliases.
 * O(e + a + i) time/space for events, receipt aliases and expanded input constituents; equal text never establishes identity. */
function collapseDeliveryReceipts({ events }: { events: readonly AgentEvent[] }, _options = {}): AgentEvent[] {
  const result: AgentEvent[] = [];
  const positions = new Map<string, number>();
  for (const event of events) {
    const input = acceptedInputEvent({ event });
    const position = input ? positions.get(input.data.id) : undefined;
    if (input && position !== undefined && !input.data.optimistic) {
      const original = acceptedInputEvent({ event: result[position]! })!;
      result[position] = mergeAcceptedReceipt({ input, pending: original });
      continue;
    }
    if (input) for (const id of acceptedInputIds({ input })) positions.set(id, result.length);
    result.push(event);
  }
  return result;
}

/** Projects saved answers and reconciles optimistic bubbles with wire events, occurrence for
 * occurrence. Legacy steering receipts have no client id: only unmatched optimistic input may
 * match by text; two real events with equal text always remain distinct.
 * @complexity O(e + u + a) time, O(e + u) space for e events, u user inputs and total answer-label lookup cost a.
 */
export function projectAcceptedInputEvents(
  { events }: { events: readonly AgentEvent[] }, options?: AcceptedInputProjectionOptions,
): AgentEvent[] {
  if (options !== undefined) return projectEvents({ events }, options);
  // Event arrays are replaced, never mutated, so a transcript update re-projects only changed messages.
  let projected = defaultProjections.get(events);
  if (!projected) defaultProjections.set(events, projected = projectEvents({ events }, {}));
  return projected;
}

const defaultProjections = new WeakMap<readonly AgentEvent[], AgentEvent[]>();

function projectEvents(
  { events }: { events: readonly AgentEvent[] }, options: AcceptedInputProjectionOptions,
): AgentEvent[] {
  const expanded = expandQuestionAnswers({ events: collapseDeliveryReceipts({ events }) }, options);
  const optimistic = collectOptimisticInputs({ events: expanded });
  const state: InputReconciliation = { replacements: new Map(), replaced: new Set(), seen: new Set() };
  for (const event of expanded) reconcileAcceptedInput({ event, optimistic, state });
  const { replacements, replaced } = state;
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
