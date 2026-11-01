import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../core/index.js';
import { useToolTimeline } from '../useToolTimeline.js';
import { DIRECT_MCP_EVENTS } from '../../../core/__tests__/fixtures/direct-mcp-events.js';
import { ANTIGRAVITY_BUFFERED_EVENTS } from '../../../core/__tests__/fixtures/antigravity-buffered-events.js';

const events: AgentEvent[] = [
  { kind: 'text', text: 'starting' },
  { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
  { kind: 'tool_result', toolUseId: 't1', content: 'a.txt', isError: false },
  { kind: 'tool_use', id: 't2', name: 'WebFetch', input: { url: 'https://example.com' } },
];

describe('useToolTimeline', () => {
  it('never adds a phantom row when buffered Antigravity wrappers arrive after the bridge', () => {
    const bridgeId = '90bb33de-9693-41c2-bf80-b551abccd86c';
    const wrapperId = 'd8e6d95d-b865-4c31-a8f2-86ab2c485a6f:20';
    const stored = ANTIGRAVITY_BUFFERED_EVENTS.filter(event => event.kind === 'tool_use'
      ? [bridgeId, wrapperId].includes(event.id)
      : event.kind === 'tool_result' && [bridgeId, wrapperId].includes(event.toolUseId));
    const renderedIds: string[][] = [];
    const { result, rerender } = renderHook(({ current }: { current: AgentEvent[] }) => {
      const timeline = useToolTimeline({ events: current }, { runStreaming: true });
      renderedIds.push(timeline.rows.map(row => row.id));
      return timeline;
    }, { initialProps: { current: stored.slice(0, 1) } });
    act(() => result.current.toggle(bridgeId));
    for (let length = 2; length <= stored.length; length += 1) {
      rerender({ current: stored.slice(0, length) });
      expect(result.current.rows).toHaveLength(1);
      expect(result.current.rows[0]).toMatchObject({ id: bridgeId, status: 'complete', expanded: true });
    }
    expect(renderedIds.every(ids => ids.length === 1 && ids[0] === bridgeId)).toBe(true);
    expect(result.current.rows[0]?.result).toEqual(stored[1]);
  });

  it('never pairs a turn-two wrapper with the equal bridge call from turn one', () => {
    const canonical: AgentEvent = { kind: 'tool_use', id: 'turn-one', name: 'theme_read_file', input: { path: 'a' } };
    const wrapper: AgentEvent = { kind: 'tool_use', id: 'turn-two', name: 'call_mcp_tool',
      input: { ServerName: 'jini', ToolName: 'theme_read_file', Arguments: { path: 'a' } } };
    const { result, rerender } = renderHook(({ next }: { next: AgentEvent[] }) => ({
      first: useToolTimeline({ events: [canonical] }).rows,
      second: useToolTimeline({ events: next }, { runStreaming: true }).rows,
    }), { initialProps: { next: [] as AgentEvent[] } });
    rerender({ next: [wrapper] });
    expect(result.current.first.map(row => row.id)).toEqual(['turn-one']);
    expect(result.current.second.map(row => row.id)).toEqual(['turn-two']);
    const nextBridge = { ...canonical, id: 'turn-two-bridge' };
    rerender({ next: [wrapper, nextBridge] });
    expect(result.current.first.map(row => row.id)).toEqual(['turn-one']);
    expect(result.current.second.map(row => row.id)).toEqual(['turn-two-bridge']);
  });

  it('shows one direct MCP row using the bridge result and status, including while streaming', () => {
    const { result, rerender } = renderHook(({ stored }: { stored: AgentEvent[] }) =>
      useToolTimeline({ events: stored }, { runStreaming: true }),
    { initialProps: { stored: DIRECT_MCP_EVENTS.slice(0, 1) } });
    expect(result.current.rows).toHaveLength(1);
    rerender({ stored: DIRECT_MCP_EVENTS.slice(0, 2) });
    expect(result.current.rows.map(row => [row.id, row.status])).toEqual([['67fcf6dd-7237-4c6a-9ee3-f25130822bdf', 'executing']]);
    rerender({ stored: DIRECT_MCP_EVENTS });
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]).toMatchObject({
      id: '67fcf6dd-7237-4c6a-9ee3-f25130822bdf', name: 'assistant_ask_choice', status: 'complete',
      renderProps: { result: expect.stringContaining('"choice":"about"'), isError: false },
    });
  });

  it('pairs tool_use with its tool_result and derives status', () => {
    const { result } = renderHook(() => useToolTimeline({ events: events }, { runStreaming: true }));
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[0]).toMatchObject({ id: 't1', name: 'Bash', status: 'complete' });
    // t2 has no result yet and the run is still streaming -> executing.
    expect(result.current.rows[1]).toMatchObject({ id: 't2', name: 'WebFetch', status: 'executing' });
  });

  it('marks unresolved tool calls as error once the run finishes unsuccessfully', () => {
    const { result } = renderHook(() => useToolTimeline({ events: events }, { runStreaming: false, runSucceeded: false }));
    expect(result.current.rows[1]?.status).toBe('error');
  });

  it('dedupes repeated tool_use events sharing an id (reconnect replay)', () => {
    const duplicated: AgentEvent[] = [
      { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
    ];
    const { result } = renderHook(() => useToolTimeline({ events: duplicated }));
    expect(result.current.rows).toHaveLength(1);
  });

  it('shows one row per delegated call, not a wrapper row plus a canonical row (chat.db e8c84205)', () => {
    // A failed call (no input, refused) and its retry: each arrives as a doubled wrapper row with
    // the CLI's id plus a canonical row with the bridge's own id. Before the fold this was 4 rows.
    const stored: AgentEvent[] = [
      { kind: 'tool_use', id: 'toolu_017N', name: 'mcp__jini__execute_readonly_delegated_tool', input: { toolId: 'content_stats' } },
      { kind: 'tool_use', id: 'toolu_017N', name: 'mcp__jini__execute_readonly_delegated_tool', input: { toolId: 'content_stats' } },
      { kind: 'tool_use', id: 'ad3e4275', name: 'content_stats', input: undefined },
      { kind: 'tool_result', toolUseId: 'ad3e4275', content: 'input must be an object', isError: true },
      { kind: 'tool_result', toolUseId: 'toolu_017N', content: 'daemon 400: BAD_REQUEST: input must be an object', isError: true },
      { kind: 'tool_use', id: 'toolu_01Nv', name: 'mcp__jini__execute_readonly_delegated_tool', input: { toolId: 'content_stats', input: {} } },
      { kind: 'tool_use', id: 'toolu_01Nv', name: 'mcp__jini__execute_readonly_delegated_tool', input: { toolId: 'content_stats', input: {} } },
      { kind: 'tool_use', id: '81ef04f5', name: 'content_stats', input: {} },
      { kind: 'tool_result', toolUseId: '81ef04f5', content: '{"posts":{"total":10}}', isError: false },
      { kind: 'tool_result', toolUseId: 'toolu_01Nv', content: '{"status":"completed"}', isError: false },
    ];
    const { result } = renderHook(() => useToolTimeline({ events: stored }, { runSucceeded: true }));
    expect(result.current.rows.map((r) => [r.id, r.name, r.status])).toEqual([
      ['ad3e4275', 'content_stats', 'error'],
      ['81ef04f5', 'content_stats', 'complete'],
    ]);
  });

  it('toggle() flips a single row expanded state without affecting others', () => {
    const { result } = renderHook(() => useToolTimeline({ events: events }, { defaultExpanded: false }));
    expect(result.current.rows.every((r) => !r.expanded)).toBe(true);
    act(() => result.current.toggle('t1'));
    expect(result.current.rows.find((r) => r.id === 't1')?.expanded).toBe(true);
    expect(result.current.rows.find((r) => r.id === 't2')?.expanded).toBe(false);
  });

  it('expandAll()/collapseAll() apply to every row', () => {
    const { result } = renderHook(() => useToolTimeline({ events: events }));
    act(() => result.current.expandAll());
    expect(result.current.rows.every((r) => r.expanded)).toBe(true);
    act(() => result.current.collapseAll());
    expect(result.current.rows.every((r) => !r.expanded)).toBe(true);
  });

  it('returns no rows for undefined/empty events', () => {
    const { result } = renderHook(() => useToolTimeline({ events: undefined }));
    expect(result.current.rows).toEqual([]);
  });
});
