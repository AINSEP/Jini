/**
 * @module useExtEventGroups
 *
 * Groups a message's `kind: 'ext'` events by `name`. Groups are ordered by each name's first
 * occurrence; within a group, events keep arrival order regardless of what's interleaved between
 * them in the raw stream — `a2ui`, `a2ui`, `foo`, `a2ui` yields `[{name:'a2ui', events:[e1,e2,e3]},
 * {name:'foo', events:[e2]}]` (indices illustrative), since `ExtEventRenderer` needs the full
 * ordered sequence for a name, not just a contiguous run of it. Pure over `AgentEvent[]` — zero
 * I/O, no React state, unlike `useToolTimeline` (which also tracks expand/collapse UI state
 * ext-event renderers don't need since `MessageRow` doesn't own any generic collapsed/expanded
 * chrome for them).
 */
import { useMemo } from 'react';
import type { AgentEvent } from '../../core/index.js';
import type { ExtEventCall } from '../ext-event-renderer-registry.js';

export interface ExtEventGroup {
  name: string;
  /**
   * The render slot this group fills — `name`, or `name:key` for a renderer registered with a slot
   * key (see `ext-event-renderer-registry.ts`'s `ExtEventSlotKey`). One group per slot.
   */
  slot: string;
  events: unknown[];
  /** The tool call open when this group's first event arrived — see `ExtEventCall`. */
  call?: ExtEventCall;
}

type CallInfo = { name: string; input: unknown };
type ToolResult = { content: string; isError: boolean };
type SlotOf = (name: string, data: unknown) => string;

/** Per-pass state of the single walk over a message's events. */
interface GroupingState {
  slotOf: SlotOf;
  /** Groups keyed by slot; a Map keeps insertion order, i.e. each slot's first occurrence. */
  bySlot: Map<string, ExtEventGroup>;
  // Calls still open at this point in the stream, in the order they opened; the newest open one
  // is the call an ext event arrived inside.
  openCalls: Map<string, CallInfo>;
  ownerOf: Map<ExtEventGroup, CallInfo & { id: string }>;
  results: Map<string, ToolResult>;
}

function addExtEvent(state: GroupingState, { name, data }: { name: string; data: unknown }): void {
  const slot = state.slotOf(name, data);
  let group = state.bySlot.get(slot);
  if (!group) {
    group = { name, slot, events: [] };
    state.bySlot.set(slot, group);
    const owner = [...state.openCalls].at(-1);
    if (owner !== undefined) state.ownerOf.set(group, { id: owner[0], ...owner[1] });
  }
  group.events.push(data);
}

function visitEvent(state: GroupingState, ev: AgentEvent): void {
  if (ev.kind === 'tool_use') {
    state.openCalls.set(ev.id, { name: ev.name, input: ev.input });
  } else if (ev.kind === 'tool_result') {
    state.openCalls.delete(ev.toolUseId);
    state.results.set(ev.toolUseId, { content: ev.content, isError: ev.isError });
  } else if (ev.kind === 'ext') {
    addExtEvent(state, ev);
  }
}

function attachCalls({ bySlot, ownerOf, results }: GroupingState): ExtEventGroup[] {
  const order = [...bySlot.values()];
  for (const group of order) {
    const owner = ownerOf.get(group);
    if (owner === undefined) continue;
    const result = results.get(owner.id);
    group.call = { name: owner.name, input: owner.input, ...(result === undefined ? {} : { result }) };
  }
  return order;
}

/**
 * @param slotOf - Which render slot an event belongs to. Defaults to its `name`, the one-slot-per-name
 *   grouping this hook always had; `MessageRow` passes the registry's `extEventSlot`.
 */
export function useExtEventGroups({ events }: { events: AgentEvent[] | undefined }, { slotOf = (name) => name }: { slotOf?: ((name: string, data: unknown) => string) | undefined } = {}
): ExtEventGroup[] {
  return useMemo(() => {
    const state: GroupingState = { slotOf, bySlot: new Map(), openCalls: new Map(), ownerOf: new Map(), results: new Map() };
    for (const ev of events ?? []) visitEvent(state, ev);
    return attachCalls(state);
  }, [events, slotOf]);
}
