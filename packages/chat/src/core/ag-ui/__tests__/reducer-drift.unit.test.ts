/** T0-2 (AG-UI design S0): the daemon-payload reducers must not be merged silently.
 * `run-events` `translateRunAgentPayload` is the canonical reducer; `ag-ui` `reduceAgentWirePayload`
 * is a copy that has drifted. Each row states, separately, whether the two reduced OBJECTS are equal
 * and whether the SERIALIZED AG-UI events are equal after projection: a difference JSON drops is not
 * a wire difference. A row marked "differs" pins both sides, so deleting the copy while a difference
 * is still observable needs an explicit decision in this file. */
import { describe, expect, it } from 'vitest';
import { translateRunAgentPayload } from '../../run-events/entry.js';
import type { AgentEvent } from '../../events.js';
import { closeAgUiRun, createAgUiTranslationState, reduceAgentWirePayload, translateAgentEventToAgUi } from '../event-projection.js';
import { IDS, NAMES, PAYLOADS, type FixturePayload } from './wire-fixture.js';

/** The AG-UI events one reduced event becomes, as the bytes a client would read. */
function wire(event: AgentEvent | null): string {
  if (event === null) return '';
  const state = createAgUiTranslationState({ ids: IDS, customEventNames: NAMES });
  return JSON.stringify([...translateAgentEventToAgUi({ event, state }), ...closeAgUiRun({ state })]);
}

function both(payload: FixturePayload): { canonical: AgentEvent | null; copy: AgentEvent | null } {
  return { canonical: translateRunAgentPayload({ payload }), copy: reduceAgentWirePayload({ payload }) };
}

describe('reducer drift: rows where the two reducers agree', () => {
  const same = ['statusWithDetail', 'statusWithoutDetail', 'textDelta', 'thinkingStart', 'thinkingDelta', 'raw', 'a2ui', 'stageStart'] as const;
  it.each(same)('%s reduces to the same object and the same wire bytes', (name) => {
    const { canonical, copy } = both(PAYLOADS[name]!);
    expect(copy).toStrictEqual(canonical);
    expect(wire(copy)).toBe(wire(canonical));
  });

  it('a status without detail has no `detail` key in either reducer', () => {
    const { canonical, copy } = both(PAYLOADS.statusWithoutDetail!);
    expect(Object.hasOwn(canonical as object, 'detail')).toBe(false);
    expect(Object.hasOwn(copy as object, 'detail')).toBe(false);
  });
});

describe('reducer drift: rows where the objects differ and the wire does not (yet)', () => {
  it('tool_use: only the canonical reducer keeps the bridge correlation; the projection drops it', () => {
    const { canonical, copy } = both(PAYLOADS.toolUse!);
    expect(copy).toStrictEqual({ kind: 'tool_use', id: 'call-1', name: 'search', input: { q: 'posts' } });
    expect(canonical).toStrictEqual({
      kind: 'tool_use', id: 'call-1', name: 'search', input: { q: 'posts' },
      toolOrigin: 'bridge', bridgeCall: { name: 'posts.search', input: { q: 'posts' }, buffered: true },
    });
    expect(wire(copy)).toBe(wire(canonical));
  });

  it('tool_result: only the canonical reducer keeps media and the unknown outcome; the projection drops them', () => {
    const { canonical, copy } = both(PAYLOADS.toolResult!);
    expect(copy).toStrictEqual({ kind: 'tool_result', toolUseId: 'call-1', content: 'found 3', isError: true });
    expect(canonical).toStrictEqual({
      kind: 'tool_result', toolUseId: 'call-1', content: 'found 3', isError: true,
      media: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }], outcome: 'unknown',
    });
    expect(wire(copy)).toBe(wire(canonical));
  });
});

describe('reducer drift: rows observable on the wire', () => {
  it('tool_input_delta: the canonical reducer drops it; the copy sends a CUSTOM extension event', () => {
    const { canonical, copy } = both(PAYLOADS.toolInputDelta!);
    expect(canonical).toBeNull();
    expect(copy).toStrictEqual({ kind: 'ext', name: 'tool_input_delta', data: PAYLOADS.toolInputDelta });
    expect(wire(canonical)).toBe('');
    expect(wire(copy)).toBe('[{"type":"CUSTOM","name":"jini.ext.tool_input_delta","value":{"type":"tool_input_delta","id":"call-1","delta":"{\\"q\\":"}}]');
  });

  it('mcp-ui: the canonical reducer attaches the exchange identity; the copy sends the raw resource', () => {
    const { canonical, copy } = both(PAYLOADS.mcpUi!);
    const resource = { uri: 'ui://confirm/1', mimeType: 'text/html', text: '<p>Delete?</p>' };
    expect(copy).toStrictEqual({ kind: 'ext', name: 'mcp-ui', data: { type: 'resource', resource: { ...resource, _meta: { existing: true } } } });
    expect(canonical).toStrictEqual({
      kind: 'ext', name: 'mcp-ui',
      data: { type: 'resource', resource: { ...resource, _meta: { existing: true, 'jini/surface-exchange': { exchangeId: 'ex-1', toolId: 'posts.delete', runId: 'run-1' } } } },
    });
    expect(wire(copy)).not.toBe(wire(canonical));
  });

  it('usage: only the canonical reducer keeps the stop reason', () => {
    const { canonical, copy } = both(PAYLOADS.usage!);
    const shared = { kind: 'usage', inputTokens: 11, outputTokens: 7, costUsd: 0.01, cumulativeCostUsd: 0.05, costSessionId: 'cost-1', durationMs: 1200 };
    expect(copy).toStrictEqual(shared);
    expect(canonical).toStrictEqual({ ...shared, stopReason: 'end_turn' });
    expect(wire(copy)).not.toBe(wire(canonical));
  });
});

it('the fixture has a row in this file for every payload type', () => {
  expect(Object.keys(PAYLOADS).sort()).toEqual([
    'a2ui', 'mcpUi', 'raw', 'stageStart', 'statusWithDetail', 'statusWithoutDetail', 'textDelta', 'thinkingDelta',
    'thinkingStart', 'toolInputDelta', 'toolResult', 'toolUse', 'usage',
  ]);
});
