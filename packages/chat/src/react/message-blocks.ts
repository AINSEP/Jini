/**
 * @module message-blocks
 *
 * Restores the original event-stream ordering of an assistant message: text and tool cards
 * interleaved where they actually happened, instead of all the text followed by all the tools.
 *
 * ## Why this needs computing at all
 *
 * A rendered assistant message draws from two different shapes of the same turn.
 * `ChatMessage.content` is a single string — `useConversation.ts` builds it by concatenating every
 * `kind: 'text'` event (`out += ev.text`) — while the tool cards come from `ChatMessage.events`,
 * the ordered array. Rendering `content` and then the tool timeline is the straightforward
 * composition, and it is what `MessageRow.tsx` shipped in v1 (its own header records this as a
 * known deferral pending the `AssistantMessage.tsx` extraction).
 *
 * The cost is not merely cosmetic ordering. Because the text runs on either side of a tool call get
 * concatenated with nothing between them, a message reads as
 * `"I'll look for a tool that changes the site language.Done — the language is now English."` —
 * two separate thoughts, from before and after the tool ran, fused mid-sentence. The reader cannot
 * tell which claims preceded the evidence and which followed it.
 *
 * Since `content` is exactly the concatenation of the text events, the split points are recoverable:
 * walk the events in order, and every tool call marks a boundary in that concatenation.
 *
 * ## Refuses rather than guesses
 *
 * {@link interleaveMessageBlocks} returns `null` whenever it cannot prove the reconstruction is
 * lossless, and the caller falls back to the old flat layout. Losing the ordering is a presentation
 * regression; dropping or duplicating a chunk of the assistant's actual words is a correctness one,
 * so every check below prefers the former.
 *
 * It refuses when:
 * - there are no events, or no tool rows to interleave (nothing to do — the flat path is identical);
 * - the concatenated text events do not reproduce `content` byte for byte. This is the load-bearing
 *   check. A message persisted before the events schema settled, one rebuilt by a host that
 *   assembles `content` some other way, or any future divergence between the two, all land here;
 * - the walk does not emit exactly the rows it was given (a `tool_use` with no matching row, or a
 *   row never reached), which would mean silently dropping a tool card.
 *
 * Artifacts are handled by the caller, not here — see `MessageRow.tsx`.
 */
import type { AgentEvent } from '../core/index.js';

/**
 * One rendered block. Consecutive tool cards are coalesced into a single `tools` block so they keep
 * rendering inside one `.jini-message-tools` container, exactly as the flat layout did — a run of
 * back-to-back calls should stay one visual group, not become N separately-boxed ones.
 */
export type MessageBlock<Row> =
  | { readonly kind: 'text'; readonly text: string; readonly key: string }
  | { readonly kind: 'tools'; readonly rows: readonly Row[]; readonly key: string };

/**
 * Rebuilds an assistant message as ordered blocks, or returns `null` if that cannot be done
 * losslessly.
 *
 * @param events - The message's event array, in arrival order.
 * @param content - The message's `content`, expected to equal the concatenated text events.
 * @param rows - The tool timeline rows, already deduped and paired by `useToolTimeline`. Only rows
 *   present here are emitted, so a row the timeline chose to drop stays dropped.
 * @returns Ordered blocks, or `null` to signal "render the flat layout instead".
 * @complexity O(n + m) in the event and row counts.
 */
export function interleaveMessageBlocks<Row extends { id: string }>(
  events: readonly AgentEvent[] | undefined,
  content: string,
  rows: readonly Row[],
): MessageBlock<Row>[] | null {
  if (!events || events.length === 0 || rows.length === 0) return null;

  // The reconstruction is only trustworthy if the text events are demonstrably the source `content`
  // was built from. Anything else and the offsets below are fiction.
  let concatenated = '';
  for (const ev of events) {
    if (ev.kind === 'text') concatenated += ev.text;
  }
  if (concatenated !== content) return null;

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const blocks: MessageBlock<Row>[] = [];
  const emitted = new Set<string>();
  let buffer = '';

  const flushText = (): void => {
    if (buffer.length === 0) return;
    blocks.push({ kind: 'text', text: buffer, key: `text-${blocks.length}` });
    buffer = '';
  };

  for (const ev of events) {
    if (ev.kind === 'text') {
      buffer += ev.text;
      continue;
    }
    if (ev.kind !== 'tool_use') continue;

    const row = rowById.get(ev.id);
    // A `tool_use` the timeline did not surface (deduped away as a repeat of one already seen).
    // Skipping it keeps this function's output consistent with `rows`, which is the authority on
    // what gets a card.
    if (!row || emitted.has(ev.id)) continue;
    emitted.add(ev.id);

    flushText();
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'tools') {
      blocks[blocks.length - 1] = { kind: 'tools', rows: [...last.rows, row], key: last.key };
    } else {
      blocks.push({ kind: 'tools', rows: [row], key: `tools-${blocks.length}` });
    }
  }
  flushText();

  // Every row must have found its place. If one did not, the message would render with a tool card
  // missing entirely — strictly worse than the flat layout it would have had.
  if (emitted.size !== rows.length) return null;

  return blocks;
}
