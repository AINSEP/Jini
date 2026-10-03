import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../../core/index.js';
import { useExtEventGroups } from '../useExtEventGroups.js';

describe('useExtEventGroups', () => {
  it('returns an empty array for events with no ext kind', () => {
    const events: AgentEvent[] = [{ kind: 'text', text: 'hi' }];
    const { result } = renderHook(() => useExtEventGroups({ events: events }));
    expect(result.current).toEqual([]);
  });

  it('returns an empty array for undefined events', () => {
    const { result } = renderHook(() => useExtEventGroups({ events: undefined }));
    expect(result.current).toEqual([]);
  });

  it('groups ext events by name, preserving arrival order within a group', () => {
    const events: AgentEvent[] = [
      { kind: 'text', text: 'starting' },
      { kind: 'ext', name: 'a2ui', data: { step: 1 } },
      { kind: 'tool_use', id: 't1', name: 'Bash', input: {} },
      { kind: 'ext', name: 'a2ui', data: { step: 2 } },
    ];
    const { result } = renderHook(() => useExtEventGroups({ events: events }));
    expect(result.current).toEqual([{ name: 'a2ui', slot: 'a2ui', events: [{ step: 1 }, { step: 2 }] }]);
  });

  it('orders groups by each name\'s first occurrence, interleaving correctly across names', () => {
    const events: AgentEvent[] = [
      { kind: 'ext', name: 'a2ui', data: 'a1' },
      { kind: 'ext', name: 'live_artifact', data: 'l1' },
      { kind: 'ext', name: 'a2ui', data: 'a2' },
      { kind: 'ext', name: 'live_artifact', data: 'l2' },
    ];
    const { result } = renderHook(() => useExtEventGroups({ events: events }));
    expect(result.current).toEqual([
      { name: 'a2ui', slot: 'a2ui', events: ['a1', 'a2'] },
      { name: 'live_artifact', slot: 'live_artifact', events: ['l1', 'l2'] },
    ]);
  });

  it('records the tool call a surface arrived inside, with that call\'s result once it lands', () => {
    // A held-open card (ask a question, wait for the answer) is emitted while its tool call is
    // still open. The call's result is the exchange ending: answered, expired, or dismissed.
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'outer', name: 'execute_delegated_tool', input: {} },
      { kind: 'tool_use', id: 'inner', name: 'assistant_ask_choice', input: { title: 'Card one' } },
      { kind: 'ext', name: 'mcp-ui', data: 'card' },
      { kind: 'tool_result', toolUseId: 'inner', content: '{"submitted":true}', isError: false },
      { kind: 'tool_result', toolUseId: 'outer', content: 'done', isError: false },
    ];
    const { result } = renderHook(() => useExtEventGroups({ events: events }));
    expect(result.current).toEqual([
      {
        name: 'mcp-ui',
        slot: 'mcp-ui',
        events: ['card'],
        call: { name: 'assistant_ask_choice', input: { title: 'Card one' }, result: { content: '{"submitted":true}', isError: false } },
      },
    ]);
  });

  it('records a still-open call without a result', () => {
    const events: AgentEvent[] = [
      { kind: 'tool_use', id: 'inner', name: 'assistant_ask_choice', input: {} },
      { kind: 'ext', name: 'mcp-ui', data: 'card' },
    ];
    const { result } = renderHook(() => useExtEventGroups({ events: events }));
    expect(result.current[0]?.call).toEqual({ name: 'assistant_ask_choice', input: {} });
  });
});
