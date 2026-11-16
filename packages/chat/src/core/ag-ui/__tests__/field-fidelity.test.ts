/** Design S1 step B4 (field map of design 4.1): a tool call's display correlation and a tool
 * result's error flag, media and outcome ride as extra fields on the standard AG-UI events (the
 * official schemas are passthrough) and come back exactly. Absent fields stay absent, so a plain
 * call's bytes are what they were before. */
import { EventSchemas, EventType } from '@ag-ui/core';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../events.js';
import { createAgUiTranslationState, translateAgentEventToAgUi, type AgUiEvent } from '../event-projection.js';
import { createAgUiToAgentTranslationState, translateAgUiEventToAgentEvent } from '../event-reduction.js';
import { IDS, NAMES } from './wire-fixture.js';

const project = (events: readonly AgentEvent[]): AgUiEvent[] => {
  const state = createAgUiTranslationState({ ids: IDS, customEventNames: NAMES });
  return events.flatMap((event) => translateAgentEventToAgUi({ event, state }));
};
const reduce = (events: readonly AgUiEvent[]): AgentEvent[] => {
  const state = createAgUiToAgentTranslationState({ customEventNames: NAMES });
  return events.flatMap((event) => translateAgUiEventToAgentEvent({ event, state }));
};
/** What a client receives: JSON over the wire, then the official schema parse. */
const overTheWire = (events: readonly AgUiEvent[]): AgUiEvent[] =>
  events.map((event) => EventSchemas.parse(JSON.parse(JSON.stringify(event))) as AgUiEvent);

const BRIDGE_CALL: AgentEvent = {
  kind: 'tool_use', id: 'call-1', name: 'search', input: { q: 'posts' },
  toolOrigin: 'bridge', bridgeCall: { name: 'posts.search', input: { q: 'posts' }, buffered: true },
};
const FAILED_RESULT: AgentEvent = {
  kind: 'tool_result', toolUseId: 'call-1', content: 'found 3', isError: true,
  media: [{ type: 'image', mimeType: 'image/png', data: 'AAAA', title: 'Chart', href: '/media/1' }, { type: 'text', text: 'caption' }],
  outcome: 'unknown',
};

describe('AG-UI field fidelity: projection', () => {
  it('writes a tool call\'s correlation on TOOL_CALL_START only', () => {
    expect(project([BRIDGE_CALL])).toStrictEqual([
      { type: EventType.TOOL_CALL_START, toolCallId: 'call-1', toolCallName: 'search', toolOrigin: 'bridge', bridgeCall: { name: 'posts.search', input: { q: 'posts' }, buffered: true } },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'call-1', delta: '{"q":"posts"}' },
      { type: EventType.TOOL_CALL_END, toolCallId: 'call-1' },
    ]);
  });

  it('writes a tool result\'s error flag, media and outcome on TOOL_CALL_RESULT', () => {
    expect(project([FAILED_RESULT])).toStrictEqual([{
      type: EventType.TOOL_CALL_RESULT, messageId: 'tool_result_msg_1', toolCallId: 'call-1', content: 'found 3', role: 'tool',
      isError: true, media: FAILED_RESULT.kind === 'tool_result' ? FAILED_RESULT.media : undefined, outcome: 'unknown',
    }]);
  });

  it('adds no field to a plain call and a plain successful result', () => {
    expect(project([
      { kind: 'tool_use', id: 'call-2', name: 'ping', input: {} },
      { kind: 'tool_result', toolUseId: 'call-2', content: 'pong', isError: false },
    ])).toStrictEqual([
      { type: EventType.TOOL_CALL_START, toolCallId: 'call-2', toolCallName: 'ping' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'call-2', delta: '{}' },
      { type: EventType.TOOL_CALL_END, toolCallId: 'call-2' },
      { type: EventType.TOOL_CALL_RESULT, messageId: 'tool_result_msg_1', toolCallId: 'call-2', content: 'pong', role: 'tool' },
    ]);
  });
});

describe('AG-UI field fidelity: reduction', () => {
  it('brings every optional tool field back exactly, through JSON and the official schemas', () => {
    expect(reduce(overTheWire(project([BRIDGE_CALL, FAILED_RESULT])))).toStrictEqual([BRIDGE_CALL, FAILED_RESULT]);
  });

  it('keeps each call\'s correlation with its own id when two calls are open at once', () => {
    const plain: AgentEvent = { kind: 'tool_use', id: 'call-2', name: 'ping', input: { n: 1 } };
    const [startA, argsA, endA] = project([BRIDGE_CALL]);
    const [startB, argsB, endB] = project([plain]);
    expect(reduce([startA!, startB!, argsB!, argsA!, endB!, endA!])).toStrictEqual([plain, BRIDGE_CALL]);
  });

  it('ignores extra fields it cannot read, as the daemon payload reducer does', () => {
    const wire = [
      { type: EventType.TOOL_CALL_START, toolCallId: 'c', toolCallName: 'ping', toolOrigin: 'elsewhere', bridgeCall: { input: 1 } },
      { type: EventType.TOOL_CALL_END, toolCallId: 'c' },
      { type: EventType.TOOL_CALL_RESULT, messageId: 'm', toolCallId: 'c', content: 'pong', media: 'not-a-list', outcome: 'done' },
    ] as AgUiEvent[];
    expect(reduce(wire)).toStrictEqual([
      { kind: 'tool_use', id: 'c', name: 'ping', input: {} },
      { kind: 'tool_result', toolUseId: 'c', content: 'pong', isError: false },
    ]);
  });

  it('keeps a bridge call without the buffered flag as it was sent', () => {
    const call: AgentEvent = { kind: 'tool_use', id: 'c', name: 'ping', input: {}, bridgeCall: { name: 'x.ping', input: null } };
    expect(reduce(overTheWire(project([call])))).toStrictEqual([call]);
  });
});
