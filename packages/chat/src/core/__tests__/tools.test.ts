import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../events.js';
import { dedupeToolUsesById, deriveToolStatus, toRenderProps } from '../tools.js';

describe('tools: deriveToolStatus / toRenderProps', () => {
  const use: Extract<AgentEvent, { kind: 'tool_use' }> = { kind: 'tool_use', id: 't1', name: 'Read', input: { path: 'a.ts' } };

  it('reports "complete" once a non-error result has arrived', () => {
    const result: Extract<AgentEvent, { kind: 'tool_result' }> = { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false };
    expect(deriveToolStatus(result, true)).toBe('complete');
  });

  it('reports "error" once an error result has arrived, even mid-stream', () => {
    const result: Extract<AgentEvent, { kind: 'tool_result' }> = { kind: 'tool_result', toolUseId: 't1', content: 'boom', isError: true };
    expect(deriveToolStatus(result, true)).toBe('error');
  });

  it('reports "executing" while streaming with no result yet', () => {
    expect(deriveToolStatus(undefined, true)).toBe('executing');
  });

  it('reports "complete" for a stored turn missing its trailing tool_result on a run that succeeded', () => {
    expect(deriveToolStatus(undefined, false, true)).toBe('complete');
  });

  it('reports "error" for no result after a run that did not succeed', () => {
    expect(deriveToolStatus(undefined, false, false)).toBe('error');
  });

  it('toRenderProps projects the tool_use + result pair into the render-prop shape', () => {
    const result: Extract<AgentEvent, { kind: 'tool_result' }> = { kind: 'tool_result', toolUseId: 't1', content: 'ok', isError: false };
    expect(toRenderProps(use, result, false, true)).toEqual({
      status: 'complete',
      name: 'Read',
      args: { path: 'a.ts' },
      result: 'ok',
      isError: false,
    });
  });

  it('toRenderProps defaults isError to false (not undefined) when there is no result yet', () => {
    expect(toRenderProps(use, undefined, true)).toEqual({
      status: 'executing',
      name: 'Read',
      args: { path: 'a.ts' },
      result: undefined,
      isError: false,
    });
  });
});

describe('tools: dedupeToolUsesById', () => {
  it('drops a replayed duplicate tool_use id but keeps every other event in original order', () => {
    const events: AgentEvent[] = [
      { kind: 'text', text: 'starting' },
      { kind: 'tool_use', id: 'a', name: 'Read', input: {} },
      { kind: 'tool_result', toolUseId: 'a', content: 'ok', isError: false },
      { kind: 'tool_use', id: 'a', name: 'Read', input: {} }, // replayed duplicate
      { kind: 'tool_use', id: 'b', name: 'Write', input: {} },
    ];
    const deduped = dedupeToolUsesById(events);
    expect(deduped.filter((e) => e.kind === 'tool_use')).toHaveLength(2);
    expect(deduped.map((e) => e.kind)).toEqual(['text', 'tool_use', 'tool_result', 'tool_use']);
  });

  it('returns the same array reference when there is nothing to dedupe (cheap no-op)', () => {
    const events: AgentEvent[] = [{ kind: 'tool_use', id: 'a', name: 'Read', input: {} }];
    expect(dedupeToolUsesById(events)).toBe(events);
  });

  it('returns [] for undefined or empty input', () => {
    expect(dedupeToolUsesById(undefined)).toEqual([]);
    expect(dedupeToolUsesById([])).toEqual([]);
  });
});
