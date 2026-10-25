/**
 * @module message-blocks
 *
 * Restores the original event-stream ordering of an assistant message: text and tool cards
 * interleaved where they actually happened, instead of all the text followed by all the tools.
 *
 * ## Why this needs computing at all
 *
 * A rendered assistant message draws from three different shapes of the same turn.
 * `ChatMessage.content` is a single string — `useConversation.ts` builds it by concatenating every
 * `kind: 'text'` event (`out += ev.text`) — tool cards come from `ChatMessage.events`'s `tool_use`
 * entries, and interactive surfaces (MCP-UI, A2UI) come from that same array's `kind: 'ext'`
 * entries. Rendering `content`, then the tool timeline, then every `ext` group is the
 * straightforward composition, and it is what `MessageRow.tsx` shipped in v1 (its own header
 * records this as a known deferral pending the `AssistantMessage.tsx` extraction).
 *
 * The cost is not merely cosmetic ordering. Because the text runs on either side of a tool call (or
 * an interactive surface) get concatenated with nothing between them, a message reads as
 * `"I'll look for a tool that changes the site language.Done — the language is now English."` —
 * two separate thoughts, from before and after the tool ran, fused mid-sentence. Worse for an `ext`
 * surface specifically: a reply narrating what the human just submitted through an MCP-UI form (a
 * `text` event that only exists BECAUSE the form's `ext` event was answered) renders ABOVE that
 * form instead of below it — the answer appears to precede the question. The reader cannot tell
 * which claims preceded the evidence and which followed it.
 *
 * Since `content` is exactly the concatenation of the text events, the split points are recoverable:
 * walk the events in order, and every tool call or ext surface marks a boundary in that
 * concatenation.
 *
 * ## Refuses rather than guesses
 *
 * {@link interleaveMessageBlocks} returns `null` whenever it cannot prove the reconstruction is
 * lossless, and the caller falls back to the old flat layout. Losing the ordering is a presentation
 * regression; dropping or duplicating a chunk of the assistant's actual words is a correctness one,
 * so every check below prefers the former.
 *
 * It refuses when:
 * - there are no events, or no tool rows AND no ext events (AND no thinking, when the caller asked
 *   for it) to interleave (nothing to do — the flat path is identical);
 * - the concatenated text events do not reproduce `content` byte for byte. This is the load-bearing
 *   check. A message persisted before the events schema settled, one rebuilt by a host that
 *   assembles `content` some other way, or any future divergence between the two, all land here;
 * - the walk does not emit exactly the rows it was given (a `tool_use` with no matching row, or a
 *   row never reached), which would mean silently dropping a tool card.
 *
 * Artifacts are handled by the caller, not here — see `MessageRow.tsx`.
 */
import type { AgentEvent } from '../core/index.js';
import { assistantContentFromEvents, isReplyBoundary, legacyAssistantContentFromEvents } from '../core/index.js';
import { isAssistantStepBoundary } from '../core/assistant-content.js';
import { MID_RUN_USER_MESSAGE_EVENT_NAME } from '../core/turn-usage.js';

/**
 * One rendered block. Consecutive tool cards are coalesced into a single `tools` block so they keep
 * rendering inside one `.jini-message-tools` container, exactly as the flat layout did — a run of
 * back-to-back calls should stay one visual group, not become N separately-boxed ones. An `ext`
 * block marks where a `kind: 'ext'` group of a given `name` (an MCP-UI/A2UI surface, or any other
 * host-registered ext renderer) belongs in reading order — one block per name, at its FIRST
 * occurrence, since `MessageRow.tsx`'s `useExtEventGroups` already folds every event sharing that
 * name (however many arrive, however late) into one evolving render slot; this block only fixes
 * WHERE that slot sits relative to the surrounding text, not what it renders.
 */
export type MessageBlock<Row> =
  | { readonly kind: 'text'; readonly text: string; readonly key: string }
  | { readonly kind: 'tools'; readonly rows: readonly Row[]; readonly key: string }
  | { readonly kind: 'ext'; readonly name: string; readonly slot: string; readonly key: string }
  /** Where reply `index` of a run ends: just before the mid-run user message that started the next
   * reply (`isReplyBoundary`). `MessageRow` hangs that reply's own "Done" line here. */
  | { readonly kind: 'reply-end'; readonly index: number; readonly key: string }
  /** The model's reasoning (`kind: 'thinking'` events), where it happened. Emitted only when the
   * caller passes `includeThinking` (a host's "show thinking" display choice, 2026-10-11);
   * back-to-back thinking events with no text between them join into one block. */
  | { readonly kind: 'thinking'; readonly text: string; readonly key: string };

/** Split assistant sections around user receipts so each bubble can be an ordinary transcript row.
 * @complexity O(b) time/space for b blocks; preserves every block and its order.
 */
export function splitMidRunBlocks<Row>(
  { blocks }: { blocks: readonly MessageBlock<Row>[] }, _options = {},
): MessageBlock<Row>[][] {
  const sections: MessageBlock<Row>[][] = [];
  let assistant: MessageBlock<Row>[] = [];
  for (const block of blocks) {
    if (block.kind === 'ext' && block.name === MID_RUN_USER_MESSAGE_EVENT_NAME) {
      if (assistant.length > 0) sections.push(assistant);
      sections.push([block]);
      assistant = [];
    } else assistant.push(block);
  }
  if (assistant.length > 0) sections.push(assistant);
  return sections;
}

/** Mutable walk state threaded through the per-event helpers of {@link interleaveMessageBlocks}. */
interface WalkState<Row> {
  readonly rowById: ReadonlyMap<string, Row>;
  readonly blocks: MessageBlock<Row>[];
  readonly emitted: Set<string>;
  readonly emittedExtSlots: Set<string>;
  buffer: string;
  replies: number;
}

type SlotOf = (ev: { readonly name: string; readonly data: unknown }) => string;

/** Whether there is anything besides plain text to place: a tool row, an ext event, or (when asked
 * for) non-blank thinking. With none of these the flat path is identical. */
function hasSomethingToInterleave(
  { events, rows }: { events: readonly AgentEvent[]; rows: readonly unknown[] },
  { includeThinking }: { includeThinking: boolean },
): boolean {
  if (rows.length > 0) return true;
  return events.some((ev) => isAssistantStepBoundary({ event: ev }) || (includeThinking && ev.kind === 'thinking' && ev.text.trim() !== ''));
}

/** Whether `content` is demonstrably built from the text events. */
function contentMatchesEvents({ events, content }: { events: readonly AgentEvent[]; content: string }): boolean {
  // Both producers' shapes count: today's (a paragraph break between steps, see
  // `assistantContentFromEvents`) and the old plain concatenation older saved rows carry.
  return content === assistantContentFromEvents({ events }) || content === legacyAssistantContentFromEvents({ events });
}

function flushText<Row>({ state }: { state: WalkState<Row> }): void {
  if (state.buffer.length === 0) return;
  state.blocks.push({ kind: 'text', text: state.buffer, key: `text-${state.blocks.length}` });
  state.buffer = '';
}

function placeThinking<Row>({ state, text }: { state: WalkState<Row>; text: string }): void {
  flushText({ state });
  const { blocks } = state;
  const last = blocks[blocks.length - 1];
  if (last && last.kind === 'thinking') blocks[blocks.length - 1] = { kind: 'thinking', text: last.text + text, key: last.key };
  else blocks.push({ kind: 'thinking', text, key: `thinking-${blocks.length}` });
}

function placeReplyEnd<Row>({ state }: { state: WalkState<Row> }): void {
  flushText({ state });
  state.blocks.push({ kind: 'reply-end', index: state.replies, key: `reply-end-${state.replies}` });
  state.replies += 1;
}

function placeExt<Row>(
  { state, ev }: { state: WalkState<Row>; ev: { readonly name: string; readonly data: unknown } },
  { slotOf }: { slotOf: SlotOf },
): void {
  // One block per SLOT, at its first occurrence — later events in the same slot fold into it
  // (`useExtEventGroups`'s job in `MessageRow.tsx`), not a second block. A slot is the `name`
  // unless its renderer keys events into separate surfaces (see `ExtEventSlotKey`).
  const slot = slotOf(ev);
  if (state.emittedExtSlots.has(slot)) return;
  state.emittedExtSlots.add(slot);
  flushText({ state });
  state.blocks.push({ kind: 'ext', name: ev.name, slot, key: `ext-${slot}` });
}

function placeToolUse<Row>({ state, id }: { state: WalkState<Row>; id: string }): void {
  const row = state.rowById.get(id);
  // A `tool_use` the timeline did not surface (deduped away as a repeat of one already seen).
  // Skipping it keeps this function's output consistent with `rows`, which is the authority on
  // what gets a card.
  if (!row || state.emitted.has(id)) return;
  state.emitted.add(id);

  flushText({ state });
  const { blocks } = state;
  const last = blocks[blocks.length - 1];
  if (last && last.kind === 'tools') {
    blocks[blocks.length - 1] = { kind: 'tools', rows: [...last.rows, row], key: last.key };
  } else {
    blocks.push({ kind: 'tools', rows: [row], key: `tools-${blocks.length}` });
  }
}

function placeEvent<Row>(
  { state, ev }: { state: WalkState<Row>; ev: AgentEvent },
  { slotOf, includeThinking }: { slotOf: SlotOf; includeThinking: boolean },
): void {
  if (ev.kind === 'text') {
    state.buffer += ev.text;
    return;
  }
  if (ev.kind === 'thinking') {
    if (includeThinking) placeThinking({ state, text: ev.text });
    return;
  }
  // Usage and step-start markers separate paragraphs even when no tool/card renders there.
  // Tool and card events keep their own placement rules (a folded card or repeated tool id never splits).
  if ((ev.kind === 'usage' || ev.kind === 'status') && isAssistantStepBoundary({ event: ev })) flushText({ state });
  // Emitted per boundary, before any slot dedupe below, so every reply gets its own end marker.
  if (isReplyBoundary({ event: ev })) placeReplyEnd({ state });
  if (ev.kind === 'ext') placeExt({ state, ev }, { slotOf });
  else if (ev.kind === 'tool_use') placeToolUse({ state, id: ev.id });
}

/**
 * Rebuilds an assistant message as ordered blocks, or returns `null` if that cannot be done
 * losslessly.
 *
 * @param events - The message's event array, in arrival order.
 * @param content - The message's `content`, expected to equal the concatenated text events.
 * @param rows - The tool timeline rows, already deduped and paired by `useToolTimeline`. Only rows
 *   present here are emitted, so a row the timeline chose to drop stays dropped.
 * @param slotOf - The render slot an ext event belongs to (default: its `name`).
 * @param includeThinking - Emit `thinking` blocks for the model's reasoning (default `false`: thinking
 *   events are skipped, the layout every host had before this option). Thinking text is not part of
 *   `content`, so it never affects the lossless check below.
 * @returns Ordered blocks, or `null` to signal "render the flat layout instead".
 * @complexity O(n + m) in the event and row counts.
 */
export function interleaveMessageBlocks<Row extends { id: string }>(
  { events, content, rows }: { events: readonly AgentEvent[] | undefined; content: string; rows: readonly Row[] },
  { slotOf = (ev) => ev.name, includeThinking = false }: {
    slotOf?: SlotOf;
    includeThinking?: boolean;
  } = {},
): MessageBlock<Row>[] | null {
  if (!events || events.length === 0) return null;
  if (!hasSomethingToInterleave({ events, rows }, { includeThinking })) return null;

  // The reconstruction is only trustworthy if the text events are demonstrably the source `content`
  // was built from. Anything else and the offsets below are fiction.
  if (!contentMatchesEvents({ events, content })) return null;

  const state: WalkState<Row> = {
    rowById: new Map(rows.map((row) => [row.id, row])),
    blocks: [],
    emitted: new Set<string>(),
    emittedExtSlots: new Set<string>(),
    buffer: '',
    replies: 0,
  };
  for (const ev of events) placeEvent({ state, ev }, { slotOf, includeThinking });
  flushText({ state });

  // Every row must have found its place. If one did not, the message would render with a tool card
  // missing entirely — strictly worse than the flat layout it would have had.
  if (state.emitted.size !== rows.length) return null;

  return state.blocks;
}
