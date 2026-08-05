import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../core/index.js';
import { useExtEventGroups } from '../useExtEventGroups.js';

describe('useExtEventGroups', () => {
  it('returns an empty array for events with no ext kind', () => {
    const events: AgentEvent[] = [{ kind: 'text', text: 'hi' }];
    const { result } = renderHook(() => useExtEventGroups(events));
    expect(result.current).toEqual([]);
  });

  it('returns an empty array for undefined events', () => {
    const { result } = renderHook(() => useExtEventGroups(undefined));
    expect(result.current).toEqual([]);
  });

  it('groups ext events by name, preserving arrival order within a group', () => {
    const events: AgentEvent[] = [
      { kind: 'text', text: 'starting' },
      { kind: 'ext', name: 'a2ui', data: { step: 1 } },
      { kind: 'tool_use', id: 't1', name: 'Bash', input: {} },
      { kind: 'ext', name: 'a2ui', data: { step: 2 } },
    ];
    const { result } = renderHook(() => useExtEventGroups(events));
    expect(result.current).toEqual([{ name: 'a2ui', events: [{ step: 1 }, { step: 2 }] }]);
  });

  it('orders groups by each name\'s first occurrence, interleaving correctly across names', () => {
    const events: AgentEvent[] = [
      { kind: 'ext', name: 'a2ui', data: 'a1' },
      { kind: 'ext', name: 'live_artifact', data: 'l1' },
      { kind: 'ext', name: 'a2ui', data: 'a2' },
      { kind: 'ext', name: 'live_artifact', data: 'l2' },
    ];
    const { result } = renderHook(() => useExtEventGroups(events));
    expect(result.current).toEqual([
      { name: 'a2ui', events: ['a1', 'a2'] },
      { name: 'live_artifact', events: ['l1', 'l2'] },
    ]);
  });
});
