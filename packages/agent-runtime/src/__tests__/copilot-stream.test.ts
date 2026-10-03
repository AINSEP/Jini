import { describe, expect, it } from 'vitest';
import { createCopilotStreamHandler } from '../copilot-stream.js';

/** Synthetic trace shaped like GitHub Copilot CLI's `--output-format json`; see `claude-stream.test.ts` for the network-access caveat. */
function feed(lines: unknown[]) {
  const events: Record<string, unknown>[] = [];
  const handler = createCopilotStreamHandler({ onEvent: (event) => events.push(event) });
  for (const line of lines) handler.feed({ chunk: `${JSON.stringify(line)}\n` });
  handler.flush();
  return events;
}

describe('createCopilotStreamHandler', () => {
  it('replays a session-init → text → tool-call → result trace', () => {
    const events = feed([
      { type: 'session.tools_updated', data: { model: 'gpt-5.2' } },
      { type: 'assistant.turn_start', data: {} },
      { type: 'assistant.message_delta', data: { deltaContent: 'Looking into it.' } },
      { type: 'tool.execution_start', data: { toolCallId: 'call_1', toolName: 'bash', arguments: { command: 'ls' } } },
      { type: 'tool.execution_complete', data: { toolCallId: 'call_1', result: 'index.html', success: true } },
      { type: 'result', usage: { sessionDurationMs: 900 }, success: true },
    ]);

    expect(events.map((e) => e.type)).toEqual(['status', 'status', 'text_delta', 'tool_use', 'tool_result', 'usage']);
    expect(events[0]).toEqual({ type: 'status', label: 'initializing', model: 'gpt-5.2' });
    expect(events[3]).toEqual({ type: 'tool_use', id: 'call_1', name: 'bash', input: { command: 'ls' } });
    expect(events[4]).toEqual({ type: 'tool_result', toolUseId: 'call_1', content: 'index.html', isError: false });
    expect(events[5]).toMatchObject({ stopReason: 'completed', durationMs: 900 });
  });

  it('flags a tool failure and a non-success result', () => {
    const events = feed([
      { type: 'tool.execution_complete', data: { toolCallId: 'call_2', result: 'permission denied', success: false } },
      { type: 'result', usage: {}, success: false, exitCode: 1 },
    ]);
    expect(events[0]).toMatchObject({ isError: true });
    expect(events[1]).toMatchObject({ stopReason: 'error' });
  });

  it('emits a raw event for malformed JSON instead of throwing', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createCopilotStreamHandler({ onEvent: (event) => events.push(event) });
    expect(() => handler.feed({ chunk: '{unterminated\n' })).not.toThrow();
    expect(events).toEqual([{ type: 'raw', line: '{unterminated' }]);
  });

  it('flush() processes a final line with no trailing newline', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createCopilotStreamHandler({ onEvent: (event) => events.push(event) });
    handler.feed({ chunk: JSON.stringify({ type: 'assistant.turn_start', data: {} }) });
    handler.flush();
    expect(events).toEqual([{ type: 'status', label: 'streaming' }]);
  });

  it('ignores blank lines between records', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createCopilotStreamHandler({ onEvent: (event) => events.push(event) });
    handler.feed({ chunk: '\n\n' });
    handler.feed({ chunk: `${JSON.stringify({ type: 'assistant.turn_start', data: {} })}\n` });
    handler.flush();
    expect(events).toEqual([{ type: 'status', label: 'streaming' }]);
  });

  it('flush() is a no-op when the buffer is empty', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createCopilotStreamHandler({ onEvent: (event) => events.push(event) });
    handler.flush();
    expect(events).toEqual([]);
  });

  it('flush() emits a raw event for a malformed trailing line', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createCopilotStreamHandler({ onEvent: (event) => events.push(event) });
    handler.feed({ chunk: '{still not json' });
    handler.flush();
    expect(events).toEqual([{ type: 'raw', line: '{still not json' }]);
  });

  it('ignores a top-level record with no `type` field or a non-string `type`', () => {
    expect(feed([{ data: {} }])).toEqual([]);
    expect(feed([{ type: 42 }])).toEqual([]);
  });

  it('ignores a top-level JSON value that is not a record (e.g. a bare number)', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createCopilotStreamHandler({ onEvent: (event) => events.push(event) });
    handler.feed({ chunk: '42\n' });
    handler.flush();
    expect(events).toEqual([]);
  });

  it('does not emit an initializing status when session.tools_updated has no model', () => {
    expect(feed([{ type: 'session.tools_updated', data: {} }])).toEqual([]);
  });

  it('emits thinking_delta for assistant.reasoning_delta and ignores it without deltaContent', () => {
    expect(feed([{ type: 'assistant.reasoning_delta', data: { deltaContent: 'pondering...' } }])).toEqual([
      { type: 'thinking_delta', delta: 'pondering...' },
    ]);
    expect(feed([{ type: 'assistant.reasoning_delta', data: {} }])).toEqual([]);
  });

  it('ignores assistant.message_delta without a string deltaContent', () => {
    expect(feed([{ type: 'assistant.message_delta', data: {} }])).toEqual([]);
  });

  it('falls through unrecognized event types via the default case', () => {
    expect(feed([{ type: 'session.mcp_status', data: { anything: true } }])).toEqual([]);
  });

  it('defaults tool_use id/name/input to null when the payload omits them', () => {
    expect(feed([{ type: 'tool.execution_start', data: {} }])).toEqual([
      { type: 'tool_use', id: null, name: null, input: null },
    ]);
  });

  it('defaults tool_result toolUseId to null when the payload omits it', () => {
    const events = feed([{ type: 'tool.execution_complete', data: { result: 'ok', success: true } }]);
    expect(events).toEqual([{ type: 'tool_result', toolUseId: null, content: 'ok', isError: false }]);
  });

  it('defaults usage to null and durationMs to null when the result has no usage', () => {
    const events = feed([{ type: 'result', success: true }]);
    expect(events).toEqual([{ type: 'usage', usage: null, stopReason: 'completed', durationMs: null }]);
  });

  it('defaults durationMs to null when usage is present but lacks sessionDurationMs', () => {
    const events = feed([{ type: 'result', usage: { totalTokens: 10 }, success: true }]);
    expect(events).toEqual([{ type: 'usage', usage: { totalTokens: 10 }, stopReason: 'completed', durationMs: null }]);
  });

  describe('stringifyResult (via tool.execution_complete)', () => {
    it('renders a null/undefined result as an empty string', () => {
      const events = feed([{ type: 'tool.execution_complete', data: { toolCallId: 'c', result: null } }]);
      expect(events[0]).toMatchObject({ content: '' });
    });

    it("prefers a result object's `content` field", () => {
      const events = feed([
        { type: 'tool.execution_complete', data: { toolCallId: 'c', result: { content: 'from content', detailedContent: 'ignored' } } },
      ]);
      expect(events[0]).toMatchObject({ content: 'from content' });
    });

    it("falls back to a result object's `detailedContent` field", () => {
      const events = feed([
        { type: 'tool.execution_complete', data: { toolCallId: 'c', result: { detailedContent: 'from detailed' } } },
      ]);
      expect(events[0]).toMatchObject({ content: 'from detailed' });
    });

    it('JSON-stringifies a result object with neither content field', () => {
      const events = feed([
        { type: 'tool.execution_complete', data: { toolCallId: 'c', result: { exitCode: 0 } } },
      ]);
      expect(events[0]).toMatchObject({ content: JSON.stringify({ exitCode: 0 }) });
    });

    it('JSON-stringifies a non-record, non-string, non-null result (e.g. a number)', () => {
      const events = feed([{ type: 'tool.execution_complete', data: { toolCallId: 'c', result: 7 } }]);
      expect(events[0]).toMatchObject({ content: '7' });
    });
  });
});
