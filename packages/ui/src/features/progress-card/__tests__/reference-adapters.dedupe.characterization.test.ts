import { describe, expect, it } from 'vitest';
import { dedupeToolUsesById, type AgentEventLike } from '../reference-adapters.js';

describe('dedupeToolUsesById branch characterization', () => {
  it('returns fresh empty arrays for absent and empty streams', () => {
    const empty: AgentEventLike[] = [];
    expect(dedupeToolUsesById(undefined)).toEqual([]);
    expect(dedupeToolUsesById(empty)).toEqual([]);
    expect(dedupeToolUsesById(empty)).not.toBe(empty);
  });

  it('returns the original array when valid tool ids are unique', () => {
    const events: AgentEventLike[] = [
      { kind: 'text' },
      { kind: 'tool_use', id: 'a', name: 'Read', input: {} },
      { kind: 'tool_use', id: 'b', name: 'Write', input: {} },
      { kind: 'tool_result', toolUseId: 'a' },
    ];
    expect(dedupeToolUsesById(events)).toBe(events);
  });

  it('preserves malformed tool-use events before and after the first duplicate', () => {
    const missingId: AgentEventLike = { kind: 'tool_use', name: 'Read' };
    const missingName: AgentEventLike = { kind: 'tool_use', id: 'a' };
    const first: AgentEventLike = { kind: 'tool_use', id: 'a', name: 'Read', input: {} };
    const events = [missingId, missingName, first, first, missingId, missingName];
    expect(dedupeToolUsesById(events)).toEqual([
      missingId, missingName, first, missingId, missingName,
    ]);
  });

  it('retains the first attempt despite the final-attempt documentation (reported, not fixed)', () => {
    const first: AgentEventLike = { kind: 'tool_use', id: 'a', name: 'Read', input: { path: 'first.ts' } };
    const retry: AgentEventLike = { kind: 'tool_use', id: 'a', name: 'Write', input: { path: 'retry.ts' } };
    const other: AgentEventLike = { kind: 'tool_use', id: 'b', name: 'Edit', input: {} };
    const result: AgentEventLike = { kind: 'tool_result', toolUseId: 'a' };
    const events = [first, retry, other, result, retry, other, result];
    const output = dedupeToolUsesById(events);
    expect(output).toEqual([first, other, result, result]);
    expect(output).not.toBe(events);
    expect(output[0]).toBe(first);
    expect(output[1]).toBe(other);
    expect(output[2]).toBe(result);
    expect(events).toEqual([first, retry, other, result, retry, other, result]);
  });
});
