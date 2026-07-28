/**
 * @module useToolTimeline
 *
 * Per-tool lifecycle rows for a message's events: pairs each `tool_use` with
 * its `tool_result` (deduped by id via `@jini-ai/chat-core`'s
 * `dedupeToolUsesById`), derives a four-state status via
 * `deriveToolStatus`, and tracks per-row expand/collapse UI state. Pure over
 * `AgentEvent[]` — zero I/O. Per
 * `foundry/docs/jini-port/recon/r4b-webui-design.md` §4.
 */
import { useCallback, useMemo, useState } from 'react';
import type { AgentEvent, ToolRenderProps, ToolStatus } from '@jini-ai/chat-core';
import { dedupeToolUsesById, deriveToolStatus } from '@jini-ai/chat-core';

type ToolUseEvent = Extract<AgentEvent, { kind: 'tool_use' }>;
type ToolResultEvent = Extract<AgentEvent, { kind: 'tool_result' }>;

export interface ToolTimelineRow {
  id: string;
  name: string;
  use: ToolUseEvent;
  result: ToolResultEvent | undefined;
  status: ToolStatus;
  expanded: boolean;
  renderProps: ToolRenderProps;
}

export interface UseToolTimelineOptions {
  /** Whether the owning run is still emitting events. */
  runStreaming?: boolean;
  /** Whether the (already-terminal) owning run reached a successful status. Ignored while `runStreaming` is true. */
  runSucceeded?: boolean;
  /** Rows start expanded by default. Defaults to `false` (collapsed). */
  defaultExpanded?: boolean;
}

export interface UseToolTimelineResult {
  rows: ToolTimelineRow[];
  toggle: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

export function useToolTimeline(events: AgentEvent[] | undefined, options: UseToolTimelineOptions = {}): UseToolTimelineResult {
  const { runStreaming = false, runSucceeded = false, defaultExpanded = false } = options;
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const deduped = useMemo(() => dedupeToolUsesById(events), [events]);

  const rows = useMemo<ToolTimelineRow[]>(() => {
    const out: ToolTimelineRow[] = [];
    for (const ev of deduped) {
      if (ev.kind !== 'tool_use') continue;
      const result = deduped.find((r): r is ToolResultEvent => r.kind === 'tool_result' && r.toolUseId === ev.id);
      const status = deriveToolStatus(result, runStreaming, runSucceeded);
      out.push({
        id: ev.id,
        name: ev.name,
        use: ev,
        result,
        status,
        expanded: overrides[ev.id] ?? defaultExpanded,
        renderProps: { status, name: ev.name, args: ev.input, result: result?.content, isError: result?.isError ?? false },
      });
    }
    return out;
  }, [deduped, defaultExpanded, overrides, runStreaming, runSucceeded]);

  const toggle = useCallback((id: string) => {
    setOverrides((prev) => ({ ...prev, [id]: !(prev[id] ?? defaultExpanded) }));
  }, [defaultExpanded]);

  const expandAll = useCallback(() => {
    setOverrides(Object.fromEntries(deduped.filter((e) => e.kind === 'tool_use').map((e) => [(e as ToolUseEvent).id, true])));
  }, [deduped]);

  const collapseAll = useCallback(() => {
    setOverrides(Object.fromEntries(deduped.filter((e) => e.kind === 'tool_use').map((e) => [(e as ToolUseEvent).id, false])));
  }, [deduped]);

  return { rows, toggle, expandAll, collapseAll };
}
