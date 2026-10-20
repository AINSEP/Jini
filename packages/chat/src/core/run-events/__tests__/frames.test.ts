import { describe, expect, it } from 'vitest';
import {
  parseFrame,
  readSseFrames,
  runContentFromEvents,
  runEventsForSave,
  readTerminalOutcome,
  readTerminalReason,
  runInterruptedNotice,
  terminalFailureError,
  terminalOutcomeNotice,
  terminalReasonNotice,
  translateRunAgentPayload,
  translateRunFrame,
  type RunFrameCarry,
} from '../entry.js';
import { notices } from './fixture.js';

const end = (payload: Record<string, unknown>): string => JSON.stringify({ runId: 'r', kind: 'end', payload });
const out = (chunk: unknown): string => JSON.stringify({ runId: 'r', kind: 'stdout', payload: { chunk } });

describe('translateRunAgentPayload — remaining payload types', () => {
  it('drops thinking_start', () => {
    expect(translateRunAgentPayload({ payload: { type: 'thinking_start' } })).toBeNull();
  });
  it('omits media from a tool_result that carries none', () => {
    expect(translateRunAgentPayload({ payload: { type: 'tool_result', toolUseId: 't', content: 'ok' } }))
      .toEqual({ kind: 'tool_result', toolUseId: 't', content: 'ok', isError: false });
  });
  it('omits detail from a status with an empty detail', () => {
    expect(translateRunAgentPayload({ payload: { type: 'status', label: 'L', detail: '' } })).toEqual({ kind: 'status', label: 'L' });
  });
  it('renders a non-string status label as JSON', () => {
    expect(translateRunAgentPayload({ payload: { type: 'status', label: { a: 1 }, detail: 2 } }))
      .toEqual({ kind: 'status', label: '{"a":1}', detail: '2' });
  });
  it('unwraps the a2ui message', () => {
    expect(translateRunAgentPayload({ payload: { type: 'a2ui', message: { m: 1 } } })).toEqual({ kind: 'ext', name: 'a2ui', data: { m: 1 } });
  });
  it('unwraps the mcp-ui resource', () => {
    expect(translateRunAgentPayload({ payload: { type: 'mcp-ui', resource: { r: 1 } } })).toEqual({ kind: 'ext', name: 'mcp-ui', data: { r: 1 } });
  });
  it('keeps the cumulative cost and cost session fields of a usage payload', () => {
    expect(translateRunAgentPayload({ payload: { type: 'usage', cumulativeCostUsd: 0.5, costSessionId: 's1' } }))
      .toEqual({ kind: 'usage', cumulativeCostUsd: 0.5, costSessionId: 's1' });
  });
  it('drops a non-string cost session and non-numeric cumulative cost', () => {
    expect(translateRunAgentPayload({ payload: { type: 'usage', cumulativeCostUsd: '1', costSessionId: 2 } })).toEqual({ kind: 'usage' });
  });
  it('keeps a raw line', () => {
    expect(translateRunAgentPayload({ payload: { type: 'raw', line: 'x' } })).toEqual({ kind: 'raw', line: 'x' });
  });
});

describe('terminal readers', () => {
  it('terminalReasonNotice ignores reasons other than max_tool_turns', () => {
    expect(terminalReasonNotice({ reason: 'end_turn', notice: notices.toolStepLimit })).toBeNull();
  });
  it('readTerminalOutcome returns null for an absent body', () => {
    expect(readTerminalOutcome({ raw: undefined })).toBeNull();
  });
  it('readTerminalOutcome returns null for a succeeded run', () => {
    expect(readTerminalOutcome({ raw: end({ status: 'succeeded' }) })).toBeNull();
  });
  it('readTerminalOutcome renders absent fields as none/no', () => {
    expect(readTerminalOutcome({ raw: end({ status: 'canceled', code: '1', signal: 2, resumable: 'yes' }) }))
      .toEqual({ status: 'canceled', code: 'none', signal: 'none', resumable: 'no' });
  });
  it('terminalOutcomeNotice uses the canceled label', () => {
    expect(terminalOutcomeNotice({ raw: end({ status: 'canceled', code: 0 }), notices }))
      .toEqual({ kind: 'status', label: 'Run canceled', detail: 'exit code 0, signal none, resumable no' });
  });
  it('terminalOutcomeNotice uses the never-started notice for a run with no process', () => {
    expect(terminalOutcomeNotice({ raw: end({ status: 'failed' }), notices })).toEqual(notices.neverStarted);
  });
  it('terminalOutcomeNotice returns null for a succeeded run', () => {
    expect(terminalOutcomeNotice({ raw: end({ status: 'succeeded' }), notices })).toBeNull();
  });
  it('terminalFailureError reports a run that never started', () => {
    expect(terminalFailureError({ raw: end({ status: 'failed' }) })?.message).toBe('The run failed before the agent started.');
  });
  it('terminalFailureError does not treat cancellation as failure', () => {
    expect(terminalFailureError({ raw: end({ status: 'canceled', code: 1 }) })).toBeNull();
  });
  it('terminalFailureError returns null for an absent body', () => {
    expect(terminalFailureError({ raw: undefined })).toBeNull();
  });
  it('readTerminalReason reads a bare provider reason', () => {
    expect(readTerminalReason({ raw: '{"reason":"stop"}', wrapped: false })).toBe('stop');
  });
  it('readTerminalReason reads a wrapped daemon reason', () => {
    expect(readTerminalReason({ raw: end({ reason: 'max_tool_turns' }), wrapped: true })).toBe('max_tool_turns');
  });
  it('readTerminalReason tolerates a wrapped body with no payload', () => {
    expect(readTerminalReason({ raw: '{}', wrapped: true })).toBe('');
  });
  it('readTerminalReason fails soft on an absent body', () => {
    expect(readTerminalReason({ raw: undefined, wrapped: true })).toBe('');
  });
  it('readTerminalReason fails soft on unparseable JSON', () => {
    expect(readTerminalReason({ raw: '{', wrapped: false })).toBe('');
  });
  it('runInterruptedNotice copies the host notice', () => {
    const copy = runInterruptedNotice({ notice: notices.interrupted });
    expect(copy).toEqual(notices.interrupted);
    expect(copy).not.toBe(notices.interrupted);
  });
});

describe('SSE framing', () => {
  it.each(['\n', '\r\n'])('keeps parsed and byte-streamed run reductions identical with %j delimiters', async (newline) => {
    const payloads = [
      { type: 'text_delta', delta: 'café ' },
      { type: 'text_delta', delta: 'ready' },
      { type: 'tool_use', id: 't1', name: 'search', input: {} },
      { type: 'text_delta', delta: 'Après' },
    ];
    const records = [
      ...payloads.map(payload => `event: agent${newline}data: ${JSON.stringify({ payload })}`),
      `event: end${newline}data: ${end({ status: 'succeeded' })}`,
    ];
    const parsedOutcomes = records.map(rawFrame => {
      const frame = parseFrame({ rawFrame });
      expect(frame).not.toBeNull();
      return translateRunFrame({ kind: frame!.event, raw: frame!.data, notices });
    });
    const bytes = new TextEncoder().encode(records.join(newline + newline) + newline + newline);
    const body = new ReadableStream<Uint8Array>({
      start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); },
    });
    const streamedOutcomes = [];
    for await (const frame of readSseFrames({ body })) {
      streamedOutcomes.push(translateRunFrame({ kind: frame.event, raw: frame.data, notices }));
    }
    expect(parsedOutcomes).toEqual([
      { events: [{ kind: 'text', text: 'café ' }] },
      { events: [{ kind: 'text', text: 'ready' }] },
      { events: [{ kind: 'tool_use', id: 't1', name: 'search', input: {} }] },
      { events: [{ kind: 'text', text: 'Après' }] },
      { events: [], terminal: 'succeeded' },
    ]);
    expect(streamedOutcomes).toEqual(parsedOutcomes);
    for (const outcomes of [parsedOutcomes, streamedOutcomes]) {
      const events = outcomes.flatMap(outcome => outcome.events);
      expect(runEventsForSave({ events })).toEqual([
        { kind: 'text', text: 'café ready' },
        { kind: 'tool_use', id: 't1', name: 'search', input: {} },
        { kind: 'text', text: 'Après' },
      ]);
      expect(runContentFromEvents({ events })).toBe('café ready\n\nAprès');
    }
    expect(body.locked).toBe(false);
  });

  it('parseFrame defaults the event name to message and trims data lines', () => {
    expect(parseFrame({ rawFrame: 'data:  a \ndata: b' })).toEqual({ event: 'message', data: 'a\nb' });
  });
  it('parseFrame returns null for a data-less keepalive', () => {
    expect(parseFrame({ rawFrame: 'event: ping' })).toBeNull();
  });
  it('readSseFrames releases the reader without canceling after a stream that ended', async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode('event: agent\ndata: x\n\n')); c.close(); },
      cancel() { canceled = true; },
    });
    const frames = [];
    for await (const frame of readSseFrames({ body })) frames.push(frame);
    expect(frames).toEqual([{ event: 'agent', data: 'x' }]);
    expect(canceled).toBe(false);
    expect(body.locked).toBe(false);
  });
});

describe('translateRunFrame — frame kinds', () => {
  it('an unknown frame kind yields nothing', () => {
    expect(translateRunFrame({ kind: 'start', raw: '{}', notices })).toEqual({ events: [] });
  });
  it('an agent frame whose payload type is not a string yields nothing', () => {
    expect(translateRunFrame({ kind: 'agent', raw: JSON.stringify({ payload: { type: 1 } }), notices })).toEqual({ events: [] });
  });
  it('an agent frame with a dropped payload type yields nothing', () => {
    expect(translateRunFrame({ kind: 'agent', raw: JSON.stringify({ payload: { type: 'thinking_start' } }), notices })).toEqual({ events: [] });
  });
  it('an agent frame yields its translated event', () => {
    expect(translateRunFrame({ kind: 'agent', raw: JSON.stringify({ payload: { type: 'text_delta', delta: 'hi' } }), notices }))
      .toEqual({ events: [{ kind: 'text', text: 'hi' }] });
  });
  it('an error frame becomes a status event and a failure carrying the message', () => {
    const outcome = translateRunFrame({ kind: 'error', raw: JSON.stringify({ payload: { message: 'boom' } }), notices });
    expect(outcome.events).toEqual([{ kind: 'status', label: 'boom' }]);
    expect(outcome.error?.message).toBe('boom');
  });
  it('an error frame without a message falls back to the generic failure text', () => {
    const outcome = translateRunFrame({ kind: 'error', raw: undefined, notices });
    expect(outcome.events).toEqual([{ kind: 'status', label: 'agent run failed' }]);
    expect(outcome.error?.message).toBe('agent run failed');
  });
  it('an error frame with a null payload falls back to the generic failure text', () => {
    expect(translateRunFrame({ kind: 'error', raw: '{"payload":null}', notices }).error?.message).toBe('agent run failed');
  });
  it('an end frame for a succeeded run carries no error and no events', () => {
    expect(translateRunFrame({ kind: 'end', raw: end({ status: 'succeeded' }), notices })).toEqual({ events: [], terminal: 'succeeded' });
  });
  it('an end frame with no body is a success', () => {
    expect(translateRunFrame({ kind: 'end', raw: undefined, notices })).toEqual({ events: [], terminal: 'succeeded' });
  });
  it('an end frame for a canceled run carries a notice but no error', () => {
    expect(translateRunFrame({ kind: 'end', raw: end({ status: 'canceled', code: 0 }), notices })).toEqual({
      events: [{ kind: 'status', label: 'Run canceled', detail: 'exit code 0, signal none, resumable no' }],
      terminal: 'canceled',
    });
  });
});

describe('translateRunFrame — stdout/stderr chunks', () => {
  it('an absent body yields nothing', () => {
    expect(translateRunFrame({ kind: 'stdout', raw: undefined, notices })).toEqual({ events: [] });
  });
  it('a malformed body yields nothing', () => {
    expect(translateRunFrame({ kind: 'stderr', raw: 'nope', notices })).toEqual({ events: [] });
  });
  it('a null payload yields nothing', () => {
    expect(translateRunFrame({ kind: 'stdout', raw: '{"payload":null}', notices })).toEqual({ events: [] });
  });
  it('a plain-text chunk is one raw event, verbatim', () => {
    expect(translateRunFrame({ kind: 'stdout', raw: out('hello\nworld'), notices })).toEqual({ events: [{ kind: 'raw', line: 'hello\nworld' }] });
  });
  it('a non-string chunk is rendered as JSON', () => {
    expect(translateRunFrame({ kind: 'stdout', raw: out(5), notices })).toEqual({ events: [{ kind: 'raw', line: '5' }] });
  });
  it('an unparseable JSON-looking line stays raw with no status', () => {
    expect(translateRunFrame({ kind: 'stdout', raw: out('{not json\n'), notices })).toEqual({ events: [{ kind: 'raw', line: '{not json\n' }] });
  });
  it('a JSON line of another type stays raw with no status', () => {
    expect(translateRunFrame({ kind: 'stdout', raw: out('{"type":"result"}\n'), notices }).events).toEqual([{ kind: 'raw', line: '{"type":"result"}\n' }]);
  });
  it('a system line with an unknown subtype stays raw with no status', () => {
    expect(translateRunFrame({ kind: 'stdout', raw: out('{"type":"system","subtype":"init"}\n'), notices }).events)
      .toEqual([{ kind: 'raw', line: '{"type":"system","subtype":"init"}\n' }]);
  });
  it('a tool_progress line without elapsed time has no data', () => {
    expect(translateRunFrame({ kind: 'stdout', raw: out('{"type":"tool_progress"}'), notices }).events[1])
      .toEqual({ kind: 'status', code: 'tool_progress', label: 'tool_progress' });
  });
  it('a non-finite elapsed time is dropped', () => {
    const raw = `{"runId":"r","kind":"stdout","payload":{"chunk":"{\\"type\\":\\"tool_progress\\",\\"elapsed_time_seconds\\":1e999}"}}`;
    expect(translateRunFrame({ kind: 'stdout', raw, notices }).events[1]).toEqual({ kind: 'status', code: 'tool_progress', label: 'tool_progress' });
  });
  it('an api_retry line without error fields has no detail and only the service', () => {
    expect(translateRunFrame({ kind: 'stdout', raw: out('{"type":"system","subtype":"api_retry"}'), notices }).events[1])
      .toEqual({ kind: 'status', code: 'api_retry', label: 'api_retry', data: { service: 'Claude' } });
  });
  it('a chunk made only of an echo line yields nothing', () => {
    expect(translateRunFrame({ kind: 'stdout', raw: out('{"type":"assistant","x":1}\n'), notices })).toEqual({ events: [] });
  });
  it('an empty chunk yields nothing', () => {
    expect(translateRunFrame({ kind: 'stdout', raw: out(''), notices })).toEqual({ events: [] });
  });
  it('a carry with an open echo drops an empty continuation chunk and keeps the channel open', () => {
    const carry: RunFrameCarry = {};
    translateRunFrame({ kind: 'stdout', raw: out('{"type":"user","a":'), notices }, { carry });
    expect(translateRunFrame({ kind: 'stdout', raw: out(''), notices }, { carry })).toEqual({ events: [] });
    expect(carry.openEchoChannels?.has('stdout')).toBe(true);
  });
  it('a carry closes the echo once the line ends, so the next line is kept', () => {
    const carry: RunFrameCarry = {};
    translateRunFrame({ kind: 'stdout', raw: out('{"type":"user","a":'), notices }, { carry });
    expect(translateRunFrame({ kind: 'stdout', raw: out('1}\nnext'), notices }, { carry })).toEqual({ events: [{ kind: 'raw', line: 'next' }] });
    expect(carry.openEchoChannels?.has('stdout')).toBe(false);
  });
  it('a carry reuses an existing channel set', () => {
    const openEchoChannels = new Set<string>(['stdout']);
    expect(translateRunFrame({ kind: 'stdout', raw: out('tail\n'), notices }, { carry: { openEchoChannels } })).toEqual({ events: [] });
    expect(openEchoChannels.size).toBe(0);
  });
});
