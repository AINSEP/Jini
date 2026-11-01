import { describe, expect, it } from 'vitest';
import type { AgentEvent, ToolUseEvent } from '../events.js';
import { foldDelegatedWrapperCalls } from '../tool-events.js';
import { AGY_DIRECT, AGY_GATEWAY } from './fixtures/cli-tool-events.js';
import { ANTIGRAVITY_BUFFERED_EVENTS } from './fixtures/antigravity-buffered-events.js';

// Canonical bridge shapes copied from the same chat.db messages as the receipts.
function bridge(wrapper: ToolUseEvent, id = 'bridge'): ToolUseEvent {
  const args = wrapper.input as { ToolName: string; Arguments: { toolId?: string; input?: unknown } };
  return { kind: 'tool_use', id, name: args.Arguments.toolId ?? args.ToolName,
    input: args.Arguments.toolId ? args.Arguments.input : args.Arguments };
}
function result(id: string): AgentEvent {
  return { kind: 'tool_result', toolUseId: id, content: 'done', isError: false };
}

describe('Antigravity wrapper folding safety', () => {
  it.each([AGY_DIRECT, AGY_GATEWAY])('folds a wrapper onto a matching later bridge row: $id', wrapper => {
    const canonical = bridge(wrapper);
    expect(foldDelegatedWrapperCalls({ events: [wrapper, canonical, result(canonical.id), result(wrapper.id)] }))
      .toEqual([canonical, result(canonical.id)]);
  });

  it.each([AGY_DIRECT, AGY_GATEWAY])('keeps mismatched inputs separate in either event order: $id', wrapper => {
    const canonical = bridge(wrapper);
    const different = { ...canonical, input: { path: 'other.html' } };
    for (const events of [[wrapper, different, result(wrapper.id)], [different, result(wrapper.id), wrapper]]) {
      expect(foldDelegatedWrapperCalls({ events })).toBe(events);
    }
  });

  it('claims each bridge once, even with parallel and replayed wrappers', () => {
    const canonical = bridge(AGY_DIRECT);
    const other = { ...AGY_DIRECT, id: 'second' };
    expect(foldDelegatedWrapperCalls({ events: [AGY_DIRECT, AGY_DIRECT, other, canonical] }))
      .toEqual([other, canonical]);
    const next = bridge(other, 'next');
    expect(foldDelegatedWrapperCalls({ events: [canonical, next, AGY_DIRECT, AGY_DIRECT, other] }))
      .toEqual([canonical, next]);
  });

  it('preserves genuine repeated calls with their own results', () => {
    const second = { ...AGY_DIRECT, id: 'second' };
    const firstBridge = bridge(AGY_DIRECT, 'b1');
    const secondBridge = bridge(second, 'b2');
    expect(foldDelegatedWrapperCalls({ events: [AGY_DIRECT, firstBridge, result('b1'), result(AGY_DIRECT.id),
      second, secondBridge, result('b2'), result(second.id)] }))
      .toEqual([firstBridge, result('b1'), secondBridge, result('b2')]);
  });

  it('folds a buffered wrapper onto its earlier bridge row and keeps the bridge result', () => {
    const canonical = bridge(AGY_DIRECT);
    const events = [canonical, result(canonical.id), AGY_DIRECT, result(AGY_DIRECT.id)];
    expect(foldDelegatedWrapperCalls({ events })).toEqual([canonical, result(canonical.id)]);
  });

  it('folds the real 3a080c0e saved order while retaining every unrelated event', () => {
    const foldedIds = new Set([
      'd8e6d95d-b865-4c31-a8f2-86ab2c485a6f:20',
      'd8e6d95d-b865-4c31-a8f2-86ab2c485a6f:22',
      'd8e6d95d-b865-4c31-a8f2-86ab2c485a6f:24',
    ]);
    const expected = ANTIGRAVITY_BUFFERED_EVENTS.filter(event => event.kind === 'tool_use'
      ? !foldedIds.has(event.id) : event.kind !== 'tool_result' || !foldedIds.has(event.toolUseId));
    expect(foldDelegatedWrapperCalls({ events: ANTIGRAVITY_BUFFERED_EVENTS })).toEqual(expected);
  });

  it.each([AGY_DIRECT, AGY_GATEWAY])('pairs identical genuine calls one-to-one in every interleaving: $id', wrapper => {
    const first = bridge(wrapper, 'b1');
    const second = bridge(wrapper, 'b2');
    const wrappers = [wrapper, { ...wrapper, id: 'w2' }, { ...wrapper, id: 'unmatched' }];
    // Exhaust every placement of two bridge rows among three equal-key wrappers.
    for (let i = 0; i < 4; i += 1) {
      for (let j = i + 1; j < 5; j += 1) {
        const events: AgentEvent[] = [...wrappers];
        events.splice(i, 0, first);
        events.splice(j, 0, second);
        expect(foldDelegatedWrapperCalls({ events })).toEqual(events.filter(event => event !== wrappers[0] && event !== wrappers[1]));
      }
    }
  });

  it('keeps two genuine identical calls as two canonical rows with their distinct results', () => {
    const first = bridge(AGY_DIRECT, 'b1');
    const second = bridge(AGY_DIRECT, 'b2');
    const secondWrapper = { ...AGY_DIRECT, id: 'w2' };
    const canonicalEvents = [first, result(first.id), second, result(second.id)];
    const events = [...canonicalEvents, AGY_DIRECT, result(AGY_DIRECT.id), secondWrapper, result(secondWrapper.id)];
    expect(foldDelegatedWrapperCalls({ events })).toEqual(canonicalEvents);
  });

  it('claims equal-key bridge rows in appearance order', () => {
    const first = bridge(AGY_DIRECT, 'b1');
    const second = bridge(AGY_DIRECT, 'b2');
    const direct = { ...second, id: 'direct', name: 'mcp__jini__theme_read_file' };
    // The buffered wrapper must claim b1, leaving b2 for the direct call's later-only window.
    expect(foldDelegatedWrapperCalls({ events: [first, AGY_DIRECT, direct, second] })).toEqual([first, second]);
  });

  it('matches canonical JSON across object key order, but preserves array order', () => {
    const wrapper = { ...AGY_DIRECT, input: { ServerName: 'jini', ToolName: 'theme_read_file',
      Arguments: { path: 'a', options: { raw: true, lines: [1, 2] } } } };
    const different: ToolUseEvent = { kind: 'tool_use', id: 'different', name: 'theme_read_file',
      input: { options: { lines: [2, 1], raw: true }, path: 'a' } };
    const canonical = { ...different, id: 'canonical', input: { options: { lines: [1, 2], raw: true }, path: 'a' } };
    const unmatched = [different, wrapper];
    expect(foldDelegatedWrapperCalls({ events: unmatched })).toBe(unmatched);
    expect(foldDelegatedWrapperCalls({ events: [different, canonical, wrapper] })).toEqual([different, canonical]);
  });

  it('allows buffered wrapper receipts before their bridge row within the same turn', () => {
    const canonical = bridge(AGY_DIRECT);
    const events = [AGY_DIRECT, result(AGY_DIRECT.id), canonical, result(canonical.id)];
    expect(foldDelegatedWrapperCalls({ events })).toEqual([canonical, result(canonical.id)]);
  });
});
