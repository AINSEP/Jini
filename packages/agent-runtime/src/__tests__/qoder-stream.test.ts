import { describe, expect, it } from 'vitest';
import { createQoderStreamHandler } from '../qoder-stream.js';

/** Synthetic trace shaped like Qoder CLI's `--output-format stream-json`; see `claude-stream.test.ts` for the network-access caveat. */
function feed(lines: unknown[]) {
  const events: Record<string, unknown>[] = [];
  const handler = createQoderStreamHandler({ onEvent: (event) => events.push(event) });
  for (const line of lines) handler.feed({ chunk: `${JSON.stringify(line)}\n` });
  handler.flush();
  return events;
}

describe('createQoderStreamHandler', () => {
  it('replays an init → assistant text → result trace', () => {
    const events = feed([
      { type: 'system', subtype: 'init', model: 'qoder-ultimate', session_id: 'qsess_1', qodercli_version: '1.2.3' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Building the page.' }] } },
      { type: 'result', usage: { input_tokens: 10 }, total_cost_usd: 0.001, duration_ms: 400, stop_reason: 'stop', is_error: false },
    ]);

    expect(events.map((e) => e.type)).toEqual(['status', 'text_delta', 'usage']);
    expect(events[0]).toMatchObject({ label: 'initializing', model: 'qoder-ultimate', sessionId: 'qsess_1', qodercliVersion: '1.2.3' });
    expect(events[1]).toEqual({ type: 'text_delta', delta: 'Building the page.' });
    expect(events[2]).toMatchObject({ isError: false, costUsd: 0.001 });
  });

  it('surfaces a failed result as both a usage record and an error event', () => {
    const events = feed([{ type: 'result', is_error: true, stop_reason: 'quota_exceeded' }]);
    expect(events.map((e) => e.type)).toEqual(['usage', 'error']);
    expect(events[1]?.message).toContain('quota_exceeded');
  });

  it('emits thinking_start once then thinking_delta for subsequent thinking blocks', () => {
    const events = feed([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'considering approach A' },
            { type: 'thinking', thinking: 'considering approach B' },
          ],
        },
      },
    ]);
    expect(events.map((e) => e.type)).toEqual(['thinking_start', 'thinking_delta', 'thinking_delta']);
  });

  it('emits a raw event for malformed JSON', () => {
    const handler = createQoderStreamHandler({ onEvent: () => {} });
    expect(() => handler.feed({ chunk: '{bad json\n' })).not.toThrow();
  });

  it('omits model/session/version fields from init status when absent', () => {
    const events = feed([{ type: 'system', subtype: 'init' }]);
    expect(events).toEqual([
      { type: 'status', label: 'initializing', model: undefined, sessionId: undefined, qodercliVersion: undefined },
    ]);
  });

  it('emits plain-string assistant content directly when content is not an array', () => {
    const events = feed([{ type: 'assistant', message: { content: 'a flat string reply' } }]);
    expect(events).toEqual([{ type: 'text_delta', delta: 'a flat string reply' }]);
  });

  it('emits an error event for an assistant message whose content produced no text (object error)', () => {
    const record = { type: 'assistant', message: { content: [] }, error: { message: 'tool invocation failed' } };
    const events = feed([record]);
    expect(events).toEqual([{ type: 'error', message: 'tool invocation failed', raw: JSON.stringify(record) }]);
  });

  it('falls back to "Unknown Qoder error" when the error value has no usable message', () => {
    const record = { type: 'assistant', message: { content: [] }, error: {} };
    const events = feed([record]);
    expect(events).toEqual([{ type: 'error', message: 'Unknown Qoder error', raw: JSON.stringify(record) }]);
  });

  it('uses a string error value verbatim as the message', () => {
    const record = { type: 'assistant', message: { content: [] }, error: 'plain string error' };
    const events = feed([record]);
    expect(events).toEqual([{ type: 'error', message: 'plain string error', raw: JSON.stringify(record) }]);
  });

  it('does not emit an error event when text was already produced even if error is set', () => {
    const events = feed([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'partial answer' }] }, error: 'ignored because text streamed' },
    ]);
    expect(events).toEqual([{ type: 'text_delta', delta: 'partial answer' }]);
  });

  it("surfaces messageFromResult's error-object branch on a failed result", () => {
    const events = feed([{ type: 'result', is_error: true, error: { message: 'rate limited' } }]);
    expect(events[1]).toMatchObject({ message: 'rate limited' });
  });

  it("surfaces messageFromResult's string-error branch on a failed result", () => {
    const events = feed([{ type: 'result', is_error: true, error: 'quota gone' }]);
    expect(events[1]).toMatchObject({ message: 'quota gone' });
  });

  it("surfaces messageFromResult's message-field branch on a failed result", () => {
    const events = feed([{ type: 'result', is_error: true, message: 'explicit failure message' }]);
    expect(events[1]).toMatchObject({ message: 'explicit failure message' });
  });

  it('falls back to "Qoder run failed" when a failed result carries no error/message/stop_reason', () => {
    const events = feed([{ type: 'result', is_error: true }]);
    expect(events[1]).toMatchObject({ message: 'Qoder run failed' });
  });

  it('defaults usage.stopReason to null when the result has no stop_reason', () => {
    const events = feed([{ type: 'result' }]);
    expect(events[0]).toMatchObject({ type: 'usage', stopReason: null, isError: false });
  });

  it('emits a raw event for a top-level record type it has no handler for', () => {
    const record = { type: 'something_unrecognized', payload: 1 };
    const events = feed([record]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify(record) }]);
  });

  it('ignores blank lines between records', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createQoderStreamHandler({ onEvent: (event) => events.push(event) });
    handler.feed({ chunk: '\n\n' });
    handler.feed({ chunk: `${JSON.stringify({ type: 'result' })}\n` });
    handler.flush();
    expect(events).toEqual([{ type: 'usage', usage: null, modelUsage: undefined, costUsd: null, durationMs: null, stopReason: null, isError: false }]);
  });

  it('flush() is a no-op when the buffer is empty', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createQoderStreamHandler({ onEvent: (event) => events.push(event) });
    handler.flush();
    expect(events).toEqual([]);
  });

  it('flush() processes a final line with no trailing newline', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createQoderStreamHandler({ onEvent: (event) => events.push(event) });
    handler.feed({ chunk: JSON.stringify({ type: 'result', stop_reason: 'stop' }) });
    handler.flush();
    expect(events).toEqual([{ type: 'usage', usage: null, modelUsage: undefined, costUsd: null, durationMs: null, stopReason: 'stop', isError: false }]);
  });

  it('ignores a non-record content block (e.g. a bare string element)', () => {
    const events = feed([{ type: 'assistant', message: { content: ['not a record', 42, null] } }]);
    expect(events).toEqual([]);
  });

  it('ignores a text-typed content block with no string text field', () => {
    const events = feed([{ type: 'assistant', message: { content: [{ type: 'text' }] } }]);
    expect(events).toEqual([]);
  });

  it("falls back to a block's bare `text` field when `type` isn't 'text'", () => {
    const events = feed([{ type: 'assistant', message: { content: [{ type: 'other', text: 'fallback text' }] } }]);
    expect(events).toEqual([{ type: 'text_delta', delta: 'fallback text' }]);
  });

  it('ignores a top-level JSON value that parses but is not a record (e.g. a bare number)', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createQoderStreamHandler({ onEvent: (event) => events.push(event) });
    handler.feed({ chunk: '42\n' });
    handler.flush();
    expect(events).toEqual([]);
  });

  it('emits the malformed line itself as a raw event', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createQoderStreamHandler({ onEvent: (event) => events.push(event) });
    handler.feed({ chunk: '  {bad json  \n' });
    expect(events).toEqual([{ type: 'raw', line: '{bad json' }]);
  });

  it('emits a raw event for a system record that is not init', () => {
    const events = feed([{ type: 'system', subtype: 'heartbeat' }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'system', subtype: 'heartbeat' }) }]);
  });

  it('emits a raw event for an assistant record without a message object', () => {
    const events = feed([{ type: 'assistant', message: 'hi' }]);
    expect(events).toEqual([{ type: 'raw', line: JSON.stringify({ type: 'assistant', message: 'hi' }) }]);
  });

  it('ignores an empty thinking block and keeps thinking_start pending for a later one', () => {
    const events = feed([
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'later' }] } },
    ]);
    expect(events).toEqual([{ type: 'thinking_start' }, { type: 'thinking_delta', delta: 'later' }]);
  });

  it('emits thinking_start only once across separate assistant records', () => {
    const events = feed([
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'a' }] } },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'b' }] } },
    ]);
    expect(events.map((e) => e.type)).toEqual(['thinking_start', 'thinking_delta', 'thinking_delta']);
  });

  it('interleaves text and thinking blocks in content order', () => {
    const events = feed([{ type: 'assistant', message: { content: [
      { type: 'text', text: 'one' }, { type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'two' },
    ] } }]);
    expect(events).toEqual([
      { type: 'text_delta', delta: 'one' }, { type: 'thinking_start' }, { type: 'thinking_delta', delta: 'hmm' }, { type: 'text_delta', delta: 'two' },
    ]);
  });

  it('still reports an assistant error when only thinking was produced', () => {
    const record = { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 't' }] }, error: 'boom' };
    const events = feed([record]);
    expect(events).toEqual([{ type: 'thinking_start' }, { type: 'thinking_delta', delta: 't' }, { type: 'error', message: 'boom', raw: JSON.stringify(record) }]);
  });

  it('does not report an assistant error when the string content was emitted', () => {
    const events = feed([{ type: 'assistant', message: { content: 'reply' }, error: 'boom' }]);
    expect(events).toEqual([{ type: 'text_delta', delta: 'reply' }]);
  });

  it('ignores a falsy assistant error value', () => {
    const events = feed([{ type: 'assistant', message: { content: [] }, error: '' }]);
    expect(events).toEqual([]);
  });

  it('falls back to "Unknown Qoder error" for an error object without a string message', () => {
    const record = { type: 'assistant', message: { content: [] }, error: { code: 7 } };
    expect(feed([record])).toEqual([{ type: 'error', message: 'Unknown Qoder error', raw: JSON.stringify(record) }]);
  });

  it('carries every result field into the usage event', () => {
    const events = feed([{ type: 'result', usage: { a: 1 }, modelUsage: { m: {} }, total_cost_usd: 2, duration_ms: 5, stop_reason: 'end' }]);
    expect(events).toEqual([{ type: 'usage', usage: { a: 1 }, modelUsage: { m: {} }, costUsd: 2, durationMs: 5, stopReason: 'end', isError: false }]);
  });

  it('marks the usage event as an error for a failed result', () => {
    const events = feed([{ type: 'result', is_error: true }]);
    expect(events[0]).toMatchObject({ type: 'usage', isError: true });
  });

  it('ignores a thinking field on a block that is not thinking-typed', () => {
    const events = feed([{ type: 'assistant', message: { content: [{ type: 'other', thinking: 'hidden' }] } }]);
    expect(events).toEqual([]);
  });

  it('nulls a non-numeric result duration', () => {
    const events = feed([{ type: 'result', duration_ms: '5' }]);
    expect(events[0]).toMatchObject({ type: 'usage', durationMs: null });
  });

  it('skips empty error/message fields when building a failed-result message', () => {
    const events = feed([{ type: 'result', is_error: 1, error: '', message: '', stop_reason: '' }]);
    expect(events[1]).toMatchObject({ type: 'error', message: 'Qoder run failed' });
  });

  it('skips an error object with an empty message and falls through to message', () => {
    const events = feed([{ type: 'result', is_error: true, error: { message: '' }, message: 'outer' }]);
    expect(events[1]).toMatchObject({ type: 'error', message: 'outer' });
  });

  it('prefers a string error over the message field on a failed result', () => {
    const events = feed([{ type: 'result', is_error: true, error: 'inner', message: 'outer' }]);
    expect(events[1]).toMatchObject({ type: 'error', message: 'inner' });
  });

  it('splits multiple records arriving in one chunk and buffers a partial tail', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createQoderStreamHandler({ onEvent: (event) => events.push(event) });
    handler.feed({ chunk: '{"type":"x"}\n{"type":"y"}\n{"type":' });
    expect(events).toEqual([{ type: 'raw', line: '{"type":"x"}' }, { type: 'raw', line: '{"type":"y"}' }]);
    handler.feed({ chunk: '"z"}\n' });
    expect(events[2]).toEqual({ type: 'raw', line: '{"type":"z"}' });
  });

  it('re-emits a line as raw when the event sink throws while handling it (reported, not fixed)', () => {
    // handleLine's try/catch wraps the sink call as well as JSON.parse, so a
    // consumer exception is swallowed and the parsed line is re-reported as raw.
    const events: Record<string, unknown>[] = [];
    const handler = createQoderStreamHandler({ onEvent: (event) => {
      if (event.type === 'text_delta') throw new Error('sink failed');
      events.push(event);
    } });
    const line = JSON.stringify({ type: 'assistant', message: { content: 'hi' } });
    handler.feed({ chunk: `${line}\n` });
    expect(events).toEqual([{ type: 'raw', line }]);
  });

  describe('stringifyContent (via feed(chunk: unknown))', () => {
    it('accepts a Buffer chunk and decodes it as utf8', () => {
      const events: Record<string, unknown>[] = [];
      const handler = createQoderStreamHandler({ onEvent: (event) => events.push(event) });
      const line = `${JSON.stringify({ type: 'result', stop_reason: 'stop' })}\n`;
      handler.feed({ chunk: Buffer.from(line, 'utf8') });
      expect(events).toEqual([{ type: 'usage', usage: null, modelUsage: undefined, costUsd: null, durationMs: null, stopReason: 'stop', isError: false }]);
    });

    it('treats a null/undefined chunk as empty content', () => {
      const events: Record<string, unknown>[] = [];
      const handler = createQoderStreamHandler({ onEvent: (event) => events.push(event) });
      handler.feed({ chunk: null });
      handler.feed({ chunk: undefined });
      handler.flush();
      expect(events).toEqual([]);
    });

    it('JSON.stringifies a non-string, non-Buffer chunk (e.g. a plain object)', () => {
      // A plain object chunk isn't valid stream input in practice, but the
      // implementation still needs to coerce it to text: JSON.stringify
      // produces `{"foo":"bar"}` with no trailing newline, so nothing is
      // processed until flush().
      const events: Record<string, unknown>[] = [];
      const handler = createQoderStreamHandler({ onEvent: (event) => events.push(event) });
      handler.feed({ chunk: { foo: 'bar' } as unknown as string });
      handler.flush();
      expect(events).toEqual([{ type: 'raw', line: '{"foo":"bar"}' }]);
    });

    it('falls back to String(value) when JSON.stringify throws (circular reference)', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const events: Record<string, unknown>[] = [];
      const handler = createQoderStreamHandler({ onEvent: (event) => events.push(event) });
      handler.feed({ chunk: circular as unknown as string });
      handler.flush();
      expect(events).toEqual([{ type: 'raw', line: '[object Object]' }]);
    });
  });
});
