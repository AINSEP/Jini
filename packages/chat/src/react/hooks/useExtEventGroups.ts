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

export interface ExtEventGroup {
  name: string;
  /**
   * The render slot this group fills — `name`, or `name:key` for a renderer registered with a slot
   * key (see `ext-event-renderer-registry.ts`'s `ExtEventSlotKey`). One group per slot.
   */
  slot: string;
  events: unknown[];
}

/**
 * @param slotOf - Which render slot an event belongs to. Defaults to its `name`, the one-slot-per-name
 *   grouping this hook always had; `MessageRow` passes the registry's `extEventSlot`.
 */
export function useExtEventGroups(
  events: AgentEvent[] | undefined,
  slotOf: (name: string, data: unknown) => string = (name) => name,
): ExtEventGroup[] {
  return useMemo(() => {
    const order: ExtEventGroup[] = [];
    const bySlot = new Map<string, ExtEventGroup>();
    for (const ev of events ?? []) {
      if (ev.kind !== 'ext') continue;
      const slot = slotOf(ev.name, ev.data);
      let group = bySlot.get(slot);
      if (!group) {
        group = { name: ev.name, slot, events: [] };
        bySlot.set(slot, group);
        order.push(group);
      }
      group.events.push(ev.data);
    }
    return order;
  }, [events, slotOf]);
}
