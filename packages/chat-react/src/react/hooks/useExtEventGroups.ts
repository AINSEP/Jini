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
import type { AgentEvent } from '@jini-ai/chat-core';

export interface ExtEventGroup {
  name: string;
  events: unknown[];
}

export function useExtEventGroups(events: AgentEvent[] | undefined): ExtEventGroup[] {
  return useMemo(() => {
    const order: string[] = [];
    const byName = new Map<string, unknown[]>();
    for (const ev of events ?? []) {
      if (ev.kind !== 'ext') continue;
      let group = byName.get(ev.name);
      if (!group) {
        group = [];
        byName.set(ev.name, group);
        order.push(ev.name);
      }
      group.push(ev.data);
    }
    return order.map((name) => ({ name, events: byName.get(name)! }));
  }, [events]);
}
