/** T0-3 (AG-UI design S0): `AgentEvent[]` -> AG-UI events -> SSE bytes -> the official
 * `EventSchemas` parse -> reducer -> `AgentEvent[]`, with every optional field populated.
 * The bytes are `data: <json>\n\n`, the framing `@ag-ui/encoder` `encodeSSE` writes; the host route
 * golden pins the real encoder. The expected reverse list is the field table of design §4.1:
 * every event comes back exactly (bridge correlation, `isError`, `media` and `outcome` ride as extra
 * fields), and a `TEXT_MESSAGE_START` adds a `step_start` status. A change to either direction, or an
 * AG-UI upgrade that rejects one of these events, fails here.
 * Regenerate with `UPDATE_GOLDEN=1` only in a commit that names the wire change. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventSchemas, RunAgentInputSchema } from '@ag-ui/core';
import { describe, expect, it } from 'vitest';
import { closeAgUiRun, createAgUiTranslationState, translateAgentEventToAgUi, type AgUiEvent } from '../event-projection.js';
import { createAgUiToAgentTranslationState, translateAgUiEventToAgentEvent } from '../event-reduction.js';
import { A2UI_MESSAGE, IDS, NAMES } from './wire-fixture.js';
import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

const GOLDEN = fileURLToPath(new URL('./goldens/ag-ui-round-trip.golden.json', import.meta.url));

const EVENTS: readonly AgentEvent[] = [
  { kind: 'status', label: 'Working', detail: 'step 2 of 3', code: 'api_retry', data: { attempt: 2, maxAttempts: 5, reason: 'overloaded' } },
  { kind: 'thinking', text: 'plan ' },
  { kind: 'thinking', text: 'more' },
  { kind: 'text', text: 'Hel' },
  { kind: 'text', text: 'lo' },
  { kind: 'tool_use', id: 'call-1', name: 'search', input: { q: 'posts' }, toolOrigin: 'bridge', bridgeCall: { name: 'posts.search', input: { q: 'posts' }, buffered: true } },
  { kind: 'tool_result', toolUseId: 'call-1', content: 'found 3', isError: true, media: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }], outcome: 'unknown' },
  { kind: 'usage', inputTokens: 11, outputTokens: 7, costUsd: 0.01, cumulativeCostUsd: 0.05, costSessionId: 'cost-1', durationMs: 1200, stopReason: 'end_turn' },
  { kind: 'raw', line: 'raw line' },
  { kind: 'ext', name: 'a2ui', data: A2UI_MESSAGE },
  { kind: 'ext', name: 'mcp-ui', data: { type: 'resource', resource: { uri: 'ui://confirm/1', mimeType: 'text/html', text: '<p>Delete?</p>', _meta: { 'jini/surface-exchange': { exchangeId: 'ex-1', toolId: 'posts.delete', runId: 'run-1' } } } } },
  { kind: 'ext', name: 'stage_start', data: { type: 'stage_start', stage: 'plan' } },
  { kind: 'text', text: 'Done.' },
];

function encode(events: readonly AgUiEvent[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

function decode(bytes: string): AgUiEvent[] {
  return bytes.split('\n\n').filter((frame) => frame.length > 0)
    .map((frame) => EventSchemas.parse(JSON.parse(frame.slice('data: '.length))) as AgUiEvent);
}

function roundTrip(): { wire: string; back: AgentEvent[] } {
  const forward = createAgUiTranslationState({ ids: IDS, customEventNames: NAMES });
  const projected = [...EVENTS.flatMap((event) => translateAgentEventToAgUi({ event, state: forward })), ...closeAgUiRun({ state: forward })];
  const wire = encode(projected);
  const reverse = createAgUiToAgentTranslationState({ customEventNames: NAMES });
  return { wire, back: decode(wire).flatMap((event) => translateAgUiEventToAgentEvent({ event, state: reverse })) };
}

describe('AG-UI round trip golden', () => {
  it('projects, encodes, schema-parses and reduces to the pinned bytes and events', () => {
    const actual = roundTrip();
    if (process.env.UPDATE_GOLDEN === '1') writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { wire: string; back: AgentEvent[] };
    expect(actual.wire).toBe(golden.wire);
    expect(actual.back).toStrictEqual(golden.back);
  });

  it('every wire frame survives the official schema unchanged', () => {
    const { wire } = roundTrip();
    for (const frame of wire.split('\n\n').filter((entry) => entry.length > 0)) {
      const raw = JSON.parse(frame.slice('data: '.length)) as Record<string, unknown>;
      expect(EventSchemas.parse(raw)).toStrictEqual(raw);
    }
  });

  it('the only stated loss is the step boundary: every other event comes back exactly', () => {
    const { back } = roundTrip();
    expect(back.find((event) => event.kind === 'tool_use')).toStrictEqual(EVENTS.find((event) => event.kind === 'tool_use'));
    expect(back.find((event) => event.kind === 'tool_result')).toStrictEqual(EVENTS.find((event) => event.kind === 'tool_result'));
    expect(back.filter((event) => event.kind === 'status' && event.code === 'step_start')).toHaveLength(2);
    expect(back.filter((event) => !(event.kind === 'status' && event.code === 'step_start'))).toStrictEqual([...EVENTS]);
    expect(back[0]).toStrictEqual(EVENTS[0]);
    expect(back.filter((event) => event.kind === 'usage' || event.kind === 'raw' || event.kind === 'ext'))
      .toStrictEqual(EVENTS.filter((event) => event.kind === 'usage' || event.kind === 'raw' || event.kind === 'ext'));
  });
});

describe('design wire examples parse with the locked 0.0.58 schemas', () => {
  it('a run that pauses for a confirmation (design 5.1)', () => {
    const event = {
      type: 'RUN_FINISHED', threadId: 't1', runId: 'r1',
      outcome: { type: 'interrupt', interrupts: [{
        id: 'pause-1', reason: 'confirmation', toolCallId: 'call-1', message: 'Allow navigation? Open a published public page.',
        responseSchema: { type: 'object', properties: { allow: { type: 'boolean' } }, required: ['allow'] },
        expiresAt: '2026-11-16T18:31:00.000Z', metadata: { title: 'Allow navigation?', summary: 'Open a published public page.' },
      }] },
    };
    expect(EventSchemas.parse(event)).toStrictEqual(event);
  });

  it('the resume request that answers it (design 5.1)', () => {
    const input = {
      threadId: 't1', runId: 'r2', parentRunId: 'r1', state: null, messages: [], tools: [], context: [], forwardedProps: {},
      resume: [{ interruptId: 'pause-1', status: 'resolved', payload: { allow: true } }],
    };
    expect(RunAgentInputSchema.parse(input)).toStrictEqual(input);
  });

  it('a run input without `context` is refused', () => {
    expect(RunAgentInputSchema.safeParse({ threadId: 't1', runId: 'r2', messages: [], tools: [], forwardedProps: {} }).success).toBe(false);
  });
});
