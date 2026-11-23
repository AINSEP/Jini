/** T0-2 (AG-UI design S0), after S1 step B2: there is ONE daemon-payload reducer, `run-events`
 * `translateRunAgentPayload`. The `ag-ui` copy and the host copy are deleted (owner decision OD-2).
 * This file keeps the rows where the copies used to differ, so a second reducer cannot come back
 * with the old behaviour unnoticed: each row pins the reduced object and the serialized AG-UI
 * events a client reads. Since design step B4 the projection carries bridge correlation, the error
 * flag, media and outcome as extra fields; those rows pin them on the wire. */
import { describe, expect, it } from 'vitest';
import { translateRunAgentPayload } from '../../run-events/entry.js';
import { closeAgUiRun, createAgUiTranslationState, translateAgentEventToAgUi } from '../event-projection.js';
import { IDS, NAMES, PAYLOADS } from './wire-fixture.js';
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

/** The AG-UI events one reduced event becomes, as the bytes a client would read. */
function wire(event: AgentEvent | null): string {
  if (event === null) return '';
  const state = createAgUiTranslationState({ ids: IDS, customEventNames: NAMES });
  return JSON.stringify([...translateAgentEventToAgUi({ event, state }), ...closeAgUiRun({ state })]);
}

const reduce = (name: string): AgentEvent | null => translateRunAgentPayload({ payload: PAYLOADS[name]! });

describe('the one reducer: rows where the deleted copies differed', () => {
  it('a status without detail has no `detail` key', () => {
    expect(reduce('statusWithoutDetail')).toStrictEqual({ kind: 'status', label: 'Working' });
    expect(Object.hasOwn(reduce('statusWithoutDetail') as object, 'detail')).toBe(false);
  });

  it('tool_use keeps the bridge correlation on the event and on TOOL_CALL_START', () => {
    expect(reduce('toolUse')).toStrictEqual({
      kind: 'tool_use', id: 'call-1', name: 'search', input: { q: 'posts' },
      toolOrigin: 'bridge', bridgeCall: { name: 'posts.search', input: { q: 'posts' }, buffered: true },
    });
    expect(wire(reduce('toolUse'))).toBe('[{"type":"TOOL_CALL_START","toolCallId":"call-1","toolCallName":"search","toolOrigin":"bridge","bridgeCall":{"name":"posts.search","input":{"q":"posts"},"buffered":true}},{"type":"TOOL_CALL_ARGS","toolCallId":"call-1","delta":"{\\"q\\":\\"posts\\"}"},{"type":"TOOL_CALL_END","toolCallId":"call-1"}]');
  });

  it('tool_result keeps the error flag, media and the unknown outcome on the event and on TOOL_CALL_RESULT', () => {
    expect(reduce('toolResult')).toStrictEqual({
      kind: 'tool_result', toolUseId: 'call-1', content: 'found 3', isError: true,
      media: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }], outcome: 'unknown',
    });
    expect(wire(reduce('toolResult'))).toBe('[{"type":"TOOL_CALL_RESULT","messageId":"tool_result_msg_1","toolCallId":"call-1","content":"found 3","role":"tool","isError":true,"media":[{"type":"image","mimeType":"image/png","data":"AAAA"}],"outcome":"unknown"}]');
  });

  it('tool_input_delta is dropped: nothing reaches the wire', () => {
    expect(reduce('toolInputDelta')).toBeNull();
    expect(wire(reduce('toolInputDelta'))).toBe('');
  });

  it('mcp-ui carries the exchange identity beside the resource own metadata', () => {
    const resource = { uri: 'ui://confirm/1', mimeType: 'text/html', text: '<p>Delete?</p>' };
    const expected = { type: 'resource', resource: { ...resource, _meta: { existing: true, 'jini/surface-exchange': { exchangeId: 'ex-1', toolId: 'posts.delete', runId: 'run-1' } } } };
    expect(reduce('mcpUi')).toStrictEqual({ kind: 'ext', name: 'mcp-ui', data: expected });
    expect(wire(reduce('mcpUi'))).toBe(JSON.stringify([{ type: 'CUSTOM', name: 'jini.ext.mcp-ui', value: expected }]));
  });

  it('usage keeps the stop reason', () => {
    const expected = { kind: 'usage', inputTokens: 11, outputTokens: 7, costUsd: 0.01, cumulativeCostUsd: 0.05, costSessionId: 'cost-1', durationMs: 1200, stopReason: 'end_turn' };
    expect(reduce('usage')).toStrictEqual(expected);
    expect(wire(reduce('usage'))).toBe(JSON.stringify([{ type: 'CUSTOM', name: 'jini.usage', value: expected }]));
  });
});

describe('the one reducer: rows the copies agreed on', () => {
  it.each([
    ['statusWithDetail', { kind: 'status', label: 'Working', detail: 'step 2 of 3' }],
    ['textDelta', { kind: 'text', text: 'Hello' }],
    ['thinkingStart', null],
    ['thinkingDelta', { kind: 'thinking', text: 'plan' }],
    ['raw', { kind: 'raw', line: 'raw line' }],
    ['a2ui', { kind: 'ext', name: 'a2ui', data: { createSurface: { surfaceId: 's1', catalogId: 'basic' } } }],
    ['stageStart', { kind: 'ext', name: 'stage_start', data: { type: 'stage_start', stage: 'plan' } }],
  ])('%s', (name, expected) => {
    expect(reduce(name)).toStrictEqual(expected);
  });
});

it('the fixture has a row in this file for every payload type', () => {
  expect(Object.keys(PAYLOADS).sort()).toEqual([
    'a2ui', 'mcpUi', 'raw', 'stageStart', 'statusWithDetail', 'statusWithoutDetail', 'textDelta', 'thinkingDelta',
    'thinkingStart', 'toolInputDelta', 'toolResult', 'toolUse', 'usage',
  ]);
});
