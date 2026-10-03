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

/**
 * @param slotOf - Which render slot an event belongs to. Defaults to its `name`, the one-slot-per-name
 *   grouping this hook always had; `MessageRow` passes the registry's `extEventSlot`.
 */
export function useExtEventGroups({ events }: { events: AgentEvent[] | undefined }, { slotOf = (name) => name }: { slotOf?: ((name: string, data: unknown) => string) | undefined } = {}
): ExtEventGroup[] {
  return useMemo(() => {
    const order: ExtEventGroup[] = [];
    const bySlot = new Map<string, ExtEventGroup>();
    // Calls still open at this point in the stream, in the order they opened; the newest open one
    // is the call an ext event arrived inside.
    const openCalls = new Map<string, { name: string; input: unknown }>();
    const ownerOf = new Map<ExtEventGroup, { id: string; name: string; input: unknown }>();
    const results = new Map<string, { content: string; isError: boolean }>();
    for (const ev of events ?? []) {
      if (ev.kind === 'tool_use') {
        openCalls.set(ev.id, { name: ev.name, input: ev.input });
        continue;
      }
      if (ev.kind === 'tool_result') {
        openCalls.delete(ev.toolUseId);
        results.set(ev.toolUseId, { content: ev.content, isError: ev.isError });
        continue;
      }
      if (ev.kind !== 'ext') continue;
      const slot = slotOf(ev.name, ev.data);
      let group = bySlot.get(slot);
      if (!group) {
        group = { name: ev.name, slot, events: [] };
        bySlot.set(slot, group);
        order.push(group);
        const owner = [...openCalls].at(-1);
        if (owner !== undefined) ownerOf.set(group, { id: owner[0], ...owner[1] });
      }
      group.events.push(ev.data);
    }
    for (const group of order) {
      const owner = ownerOf.get(group);
      if (owner === undefined) continue;
      const result = results.get(owner.id);
      group.call = { name: owner.name, input: owner.input, ...(result === undefined ? {} : { result }) };
    }
    return order;
  }, [events, slotOf]);
}
