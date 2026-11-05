import { dedupeToolUsesById } from "../../core/tool-events.js";
import type { AgentEvent } from "../../core/index.js";
import type { CheckpointState, RunProgress } from "../../core/durable-runs/ledger-contracts.js";

/** Compare unchanged prefix values; compacting text creates fresh objects, while large tool
 * payloads normally retain their reference. Never parse the saved SQL column here. */
function sameEvent(left: AgentEvent, right: AgentEvent | undefined): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

/** A delta may append events or replace the final coalesced text event. Every earlier event
 * must match; replay reordering, thinking replacement and tool identity deduplication fall back.
 * @complexity O(prefix bytes + new suffix bytes) time; O(new suffix bytes) temporary space. */
export function checkpointDelta(
  { previous, progress }: { previous: CheckpointState; progress: RunProgress }, _options = {},
): { removeCharacters: number; suffix: string; grown: boolean } | undefined {
  if (progress.content.length < previous.content.length) return undefined;
  const incoming = progress.events;
  const saved = previous.events;
  if (incoming.length < saved.length) return undefined;
  if (dedupeToolUsesById({ events: incoming }).length !== incoming.length) return undefined;
  const prefix = saved.slice(0, -1);
  if (!prefix.every((event, index) => sameEvent(event, incoming[index]))) return undefined;
  const last = saved.at(-1);
  const next = incoming[saved.length - 1];
  const replacing = last !== undefined && !sameEvent(last, next);
  if (replacing && !extendsText({ last, next })) return undefined;
  return { ...deltaSuffix({ previous, incoming, replacing }),
    grown: progress.content.length > previous.content.length || hasNewToolProgress({ saved, incoming }) };
}

/** SQL counts characters in the removed tail, so non-BMP text never uses JS UTF-16 offsets. */
function deltaSuffix({ previous, incoming, replacing }: {
  previous: CheckpointState; incoming: readonly AgentEvent[]; replacing: boolean;
}, _options = {}): { removeCharacters: number; suffix: string } {
  const from = previous.events.length - (replacing ? 1 : 0);
  const suffixEvents = incoming.slice(from);
  const separator = !replacing && from > 0 && suffixEvents.length > 0 ? ',' : '';
  return { removeCharacters: replacing ? previous.tailLength : 1,
    suffix: separator + JSON.stringify(suffixEvents).slice(1) };
}

/** Extending text must retain every other field (including any future event metadata). */
function extendsText({ last, next }: { last: AgentEvent; next: AgentEvent | undefined }, _options = {}): boolean {
  if (last.kind !== 'text' || next?.kind !== 'text') return false;
  return next.text.startsWith(last.text) && sameEvent({ ...last, text: next.text }, next);
}

/** Same tool identity rule as the full checkpoint's progress check. O(saved + incoming events). */
export function hasNewToolProgress({ saved, incoming }: { saved: readonly AgentEvent[]; incoming: readonly AgentEvent[] }, _options = {}): boolean {
  const keys = new Set(saved.map(event => toolKey({ event })));
  return incoming.some(event => { const key = toolKey({ event }); return key !== '' && !keys.has(key); });
}

/** Durable tool identity shared by the full merge and delta progress check. */
export function toolKey({ event }: { event: AgentEvent }, _options = {}): string {
  if (event.kind === 'tool_use') return 'use:' + event.id;
  if (event.kind === 'tool_result') return 'result:' + event.toolUseId;
  return '';
}

/** Build a receipt only for an exact incoming projection; callers own its watch lifetime.
 * SQL supplies content/event lengths; the removed tail counts Unicode code points. Retain only
 * a bounded suffix for CAS, so a multi-MB tool result never becomes a guard parameter twice.
 * @complexity O(last event bytes) serialization/counting; O(last event bytes) transient space,
 * with at most 256 UTF-16 units retained beyond the existing projection references.
 */
export function checkpointState(
  { progress, length, contentLength, version }: { progress: RunProgress; length: number; contentLength: number; version: string }, _options = {},
): CheckpointState {
  const last = progress.events.at(-1);
  const fullTail = last === undefined ? '[]' : JSON.stringify(last) + ']';
  // Count SQL characters without allocating an array of code points for a multi-MB tool result.
  let tailLength = 0;
  for (const _character of fullTail) tailLength++;
  let tail = fullTail.slice(-256);
  if (/^[\uDC00-\uDFFF]/u.test(tail)) tail = tail.slice(1);
  return { content: progress.content, events: progress.events, version, length, contentLength, tailLength, tail };
}
