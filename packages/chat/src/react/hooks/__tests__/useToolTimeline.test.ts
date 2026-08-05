import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../core/index.js';
import { useToolTimeline } from '../useToolTimeline.js';

const events: AgentEvent[] = [
  { kind: 'text', text: 'starting' },
  { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
  { kind: 'tool_result', toolUseId: 't1', content: 'a.txt', isError: false },
  { kind: 'tool_use', id: 't2', name: 'WebFetch', input: { url: 'https://example.com' } },
];

describe('useToolTimeline', () => {
  it('pairs tool_use with its tool_result and derives status', () => {
    const { result } = renderHook(() => useToolTimeline(events, { runStreaming: true }));
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[0]).toMatchObject({ id: 't1', name: 'Bash', status: 'complete' });
    // t2 has no result yet and the run is still streaming -> executing.
    expect(result.current.rows[1]).toMatchObject({ id: 't2', name: 'WebFetch', status: 'executing' });
  });

  it('marks unresolved tool calls as error once the run finishes unsuccessfully', () => {
    const { result } = renderHook(() => useToolTimeline(events, { runStreaming: false, runSucceeded: false }));
    expect(result.current.rows[1]?.status).toBe('error');
  });

  it('dedupes repeated tool_use events sharing an id (reconnect replay)', () => {
    const duplicated: AgentEvent[] = [
      { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { kind: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false },
    ];
    const { result } = renderHook(() => useToolTimeline(duplicated));
    expect(result.current.rows).toHaveLength(1);
  });

  it('toggle() flips a single row expanded state without affecting others', () => {
    const { result } = renderHook(() => useToolTimeline(events, { defaultExpanded: false }));
    expect(result.current.rows.every((r) => !r.expanded)).toBe(true);
    act(() => result.current.toggle('t1'));
    expect(result.current.rows.find((r) => r.id === 't1')?.expanded).toBe(true);
    expect(result.current.rows.find((r) => r.id === 't2')?.expanded).toBe(false);
  });

  it('expandAll()/collapseAll() apply to every row', () => {
    const { result } = renderHook(() => useToolTimeline(events));
    act(() => result.current.expandAll());
    expect(result.current.rows.every((r) => r.expanded)).toBe(true);
    act(() => result.current.collapseAll());
    expect(result.current.rows.every((r) => !r.expanded)).toBe(true);
  });

  it('returns no rows for undefined/empty events', () => {
    const { result } = renderHook(() => useToolTimeline(undefined));
    expect(result.current.rows).toEqual([]);
  });
});
