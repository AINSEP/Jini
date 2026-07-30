import { describe, expect, it } from 'vitest';
import { createClaudeStreamHandler } from '../claude-stream.js';

/**
 * Behavioral replay test: feeds a hand-built JSONL trace shaped like a real
 * `claude --output-format stream-json --include-partial-messages` session
 * (message_start → text delta → tool_use block → tool_result → result)
 * through the ported parser and asserts the emitted event sequence. OD's
 * `mocks/recordings/` corpus (the real captured-CLI-output fixtures) is
 * fetched from Cloudflare R2 via `mocks/scripts/fetch-recordings.sh` and was
 * not reachable from this sandbox (no network access to that storage), so
 * this is a synthetic trace built to match the documented wire shapes in
 * `claude-stream.ts`'s own header comment and `mocks/golden/*.events.json`
 * (which WAS available in the source checkout and was used as a shape
 * reference), not a byte-for-byte replay of a captured recording. See the
 * task report for the explicit limitation.
 */
function feedLines(handler: ReturnType<typeof createClaudeStreamHandler>, lines: unknown[]) {
  for (const line of lines) {
    handler.feed(`${JSON.stringify(line)}\n`);
  }
  handler.flush();
}

function run(lines: unknown[], options?: Parameters<typeof createClaudeStreamHandler>[1]) {
  const events: Record<string, unknown>[] = [];
  const handler = createClaudeStreamHandler((event) => events.push(event), options);
  feedLines(handler, lines);
  return events;
}

function taskToolUse(id: string, name: string, input: Record<string, unknown>) {
  return {
    type: 'assistant',
    message: { id: `m_${id}`, content: [{ type: 'tool_use', id, name, input }] },
  };
}

describe('createClaudeStreamHandler', () => {
  it('replays a representative claude-code stream-json trace', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createClaudeStreamHandler((event) => events.push(event));

    feedLines(handler, [
      { type: 'system', subtype: 'init', model: 'claude-sonnet-4-5', session_id: 'sess_abc' },
      {
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg_1' } },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Reading the file now.' },
        },
      },
      { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'tool_1', name: 'Read' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"file_path":"index.html"}' },
        },
      },
      { type: 'stream_event', event: { type: 'content_block_stop', index: 1 } },
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [{ type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: 'index.html' } }],
          stop_reason: 'tool_use',
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: '<html></html>', is_error: false }],
        },
      },
      {
        type: 'result',
        usage: { input_tokens: 120, output_tokens: 40 },
        total_cost_usd: 0.002,
        duration_ms: 850,
        stop_reason: 'end_turn',
      },
    ]);

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'status',
      'text_delta',
      'tool_input_delta',
      'tool_use',
      'turn_end',
      'tool_result',
      'turn_end',
      'usage',
    ]);

    const status = events[0]!;
    expect(status.label).toBe('initializing');
    expect(status.model).toBe('claude-sonnet-4-5');
    expect(status.sessionId).toBe('sess_abc');

    expect(events[1]).toEqual({ type: 'text_delta', delta: 'Reading the file now.' });

    const toolUse = events[3]!;
    expect(toolUse.name).toBe('Read');
    expect(toolUse.input).toEqual({ file_path: 'index.html' });

    expect(events[4]).toEqual({ type: 'turn_end', stopReason: 'tool_use' });

    expect(events[5]).toEqual({
      type: 'tool_result',
      toolUseId: 'tool_1',
      content: '<html></html>',
      isError: false,
    });

    expect(events[6]).toEqual({ type: 'turn_end', stopReason: 'end_turn' });

    const usage = events[7]!;
    expect(usage.usage).toEqual({ input_tokens: 120, output_tokens: 40 });
    expect(usage.costUsd).toBe(0.002);
    expect(usage.stopReason).toBe('end_turn');
  });

  it('does not duplicate a tool_use already streamed via input_json_delta when the final assistant wrapper repeats it', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createClaudeStreamHandler((event) => events.push(event));

    feedLines(handler, [
      {
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg_2' } },
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_2', name: 'Write' } },
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"a.html"}' } },
      },
      { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
      // The final assistant wrapper repeats the same tool_use id — must be suppressed.
      {
        type: 'assistant',
        message: {
          id: 'msg_2',
          content: [{ type: 'tool_use', id: 'tool_2', name: 'Write', input: {} }],
          stop_reason: 'tool_use',
        },
      },
    ]);

    const toolUseEvents = events.filter((e) => e.type === 'tool_use');
    expect(toolUseEvents).toHaveLength(1);
    expect(toolUseEvents[0]?.input).toEqual({ path: 'a.html' });
  });

  it('emits turn_end from a partial-stream message_delta when the assistant wrapper has a null stop reason', () => {
    const events = run([
      {
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg_partial' } },
      },
      {
        type: 'assistant',
        message: {
          id: 'msg_partial',
          content: [{ type: 'text', text: 'done' }],
          stop_reason: null,
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 4 },
        },
      },
    ]);

    expect(events.filter((event) => event.type === 'turn_end')).toEqual([
      { type: 'turn_end', stopReason: 'end_turn' },
    ]);
  });

  it('does not end the turn on a message_delta that carries no stop reason', () => {
    // Anthropic sends `message_delta` for running usage totals too, with `stop_reason: null` until
    // the turn actually finishes. Treating any `message_delta` as terminal would truncate the turn
    // mid-stream, and the dedupe guard would then swallow the real end.
    const events = run([
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_no_stop' } } },
      { type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: null }, usage: { output_tokens: 2 } } },
      { type: 'stream_event', event: { type: 'message_delta', delta: { usage: { output_tokens: 4 } } } },
    ]);

    expect(events.filter((event) => event.type === 'turn_end')).toEqual([]);
  });

  it('deduplicates turn_end across an id-less assistant wrapper and a same-reason result frame', () => {
    // The dedup key is `${currentMessageId}\0${stopReason}`, so a frame that never
    // supplied a message id leaves the key null and the guard cannot fire.
    const events = run([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'done' }],
          stop_reason: 'end_turn',
        },
      },
      { type: 'result', stop_reason: 'end_turn' },
    ]);

    expect(events.filter((event) => event.type === 'turn_end')).toEqual([
      { type: 'turn_end', stopReason: 'end_turn' },
    ]);
  });

  it('still emits a turn_end per id-less assistant wrapper when two consecutive turns share a stop reason', () => {
    // The counterpart guard to the test above: widening dedup must not swallow a
    // real second turn boundary. A suppressed `tool_use` turn_end would leave the
    // daemon's stdin-close handler waiting on a turn that never arrives.
    const events = run([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'toolu_a', name: 'Read', input: { path: 'a' } }],
          stop_reason: 'tool_use',
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'toolu_b', name: 'Read', input: { path: 'b' } }],
          stop_reason: 'tool_use',
        },
      },
    ]);

    expect(events.filter((event) => event.type === 'turn_end')).toEqual([
      { type: 'turn_end', stopReason: 'tool_use' },
      { type: 'turn_end', stopReason: 'tool_use' },
    ]);
  });

  it('deduplicates turn_end when both assistant and message_delta carry the same stop reason', () => {
    const events = run([
      {
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg_duplicate_end' } },
      },
      {
        type: 'assistant',
        message: {
          id: 'msg_duplicate_end',
          content: [{ type: 'text', text: 'done' }],
          stop_reason: 'end_turn',
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
        },
      },
    ]);

    expect(events.filter((event) => event.type === 'turn_end')).toEqual([
      { type: 'turn_end', stopReason: 'end_turn' },
    ]);
  });

  it('emits a raw event for a malformed JSON line instead of throwing', () => {
    const events: Record<string, unknown>[] = [];
    const handler = createClaudeStreamHandler((event) => events.push(event));
    handler.feed('{not valid json\n');
    handler.flush();
    expect(events).toEqual([{ type: 'raw', line: '{not valid json' }]);
  });

  describe('flush() / feed() line handling', () => {
    it('flush() emits a raw event for a malformed trailing line with no newline', () => {
      const events: Record<string, unknown>[] = [];
      const handler = createClaudeStreamHandler((event) => events.push(event));
      handler.feed('{still bad');
      handler.flush();
      expect(events).toEqual([{ type: 'raw', line: '{still bad' }]);
    });

    it('flush() is a no-op when the buffer is empty', () => {
      const events: Record<string, unknown>[] = [];
      const handler = createClaudeStreamHandler((event) => events.push(event));
      handler.flush();
      expect(events).toEqual([]);
    });

    it('flush() parses a well-formed trailing line with no newline', () => {
      const events: Record<string, unknown>[] = [];
      const handler = createClaudeStreamHandler((event) => events.push(event));
      handler.feed(JSON.stringify({ type: 'system', subtype: 'status', status: 'working' }));
      handler.flush();
      expect(events).toEqual([{ type: 'status', label: 'working' }]);
    });

    it('ignores a top-level JSON value that parses but is not a record', () => {
      const events: Record<string, unknown>[] = [];
      const handler = createClaudeStreamHandler((event) => events.push(event));
      handler.feed('42\n');
      handler.flush();
      expect(events).toEqual([]);
    });

    it('ignores literal blank lines fed directly', () => {
      const events: Record<string, unknown>[] = [];
      const handler = createClaudeStreamHandler((event) => events.push(event));
      handler.feed('\n\n');
      handler.feed(`${JSON.stringify({ type: 'system', subtype: 'status', status: 'busy' })}\n`);
      handler.flush();
      expect(events).toEqual([{ type: 'status', label: 'busy' }]);
    });
  });

  describe('system status/init events', () => {
    it('emits a status event for system/status with the given status label', () => {
      expect(run([{ type: 'system', subtype: 'status', status: 'compacting' }])).toEqual([
        { type: 'status', label: 'compacting' },
      ]);
    });

    it('defaults the status label to "working" when system/status omits it', () => {
      expect(run([{ type: 'system', subtype: 'status' }])).toEqual([{ type: 'status', label: 'working' }]);
    });

    it('defaults model/sessionId to null on system/init when absent', () => {
      expect(run([{ type: 'system', subtype: 'init' }])).toEqual([
        { type: 'status', label: 'initializing', model: null, sessionId: null },
      ]);
    });
  });

  describe('result stop-reason preference', () => {
    it('prefers stop_reason over terminal_reason', () => {
      const events = run([{ type: 'result', stop_reason: 'end_turn', terminal_reason: 'ignored' }]);
      expect(events).toEqual([
        { type: 'turn_end', stopReason: 'end_turn' },
        {
          type: 'usage',
          usage: null,
          costUsd: null,
          durationMs: null,
          stopReason: 'end_turn',
        },
      ]);
    });

    it('falls back to terminal_reason when stop_reason is absent', () => {
      const events = run([{ type: 'result', terminal_reason: 'timeout' }]);
      expect(events[0]).toEqual({ type: 'turn_end', stopReason: 'timeout' });
      expect(events[1]).toMatchObject({ type: 'usage', stopReason: 'timeout' });
    });

    it('uses result as the terminal fallback when assistant and partial frames carry no stop reason', () => {
      const events = run([
        {
          type: 'stream_event',
          event: { type: 'message_start', message: { id: 'msg_result_fallback' } },
        },
        {
          type: 'assistant',
          message: {
            id: 'msg_result_fallback',
            content: [{ type: 'text', text: 'JINI_WIRING_OK' }],
            stop_reason: null,
          },
        },
        {
          type: 'result',
          stop_reason: 'end_turn',
          terminal_reason: 'completed',
        },
      ]);

      expect(events.filter((event) => event.type === 'turn_end')).toEqual([
        { type: 'turn_end', stopReason: 'end_turn' },
      ]);
    });

    it('deduplicates result fallback after a terminal partial message_delta', () => {
      const events = run([
        {
          type: 'stream_event',
          event: { type: 'message_start', message: { id: 'msg_result_duplicate' } },
        },
        {
          type: 'stream_event',
          event: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
          },
        },
        {
          type: 'result',
          stop_reason: 'end_turn',
        },
      ]);

      expect(events.filter((event) => event.type === 'turn_end')).toEqual([
        { type: 'turn_end', stopReason: 'end_turn' },
      ]);
    });

    it('defaults stopReason/usage/cost/duration to null when the result carries none', () => {
      const events = run([{ type: 'result' }]);
      expect(events[0]).toEqual({
        type: 'usage',
        usage: null,
        costUsd: null,
        durationMs: null,
        stopReason: null,
      });
    });
  });

  describe('assistant message handling', () => {
    it('emits an error event using assistantText when the assistant message reports an error', () => {
      const events = run([
        {
          type: 'assistant',
          message: {
            id: 'm_err',
            content: [{ type: 'text', text: 'Partial answer before failure.' }],
            stop_reason: 'error',
          },
          error: 'boom',
        },
      ]);
      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toEqual({ type: 'error', message: 'Partial answer before failure.', code: 'boom' });
    });

    it('falls back to the raw error code when assistantText produces no text', () => {
      const events = run([
        {
          type: 'assistant',
          message: { id: 'm_err2', content: [], stop_reason: 'error' },
          error: 'no-text-error',
        },
      ]);
      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toEqual({ type: 'error', message: 'no-text-error', code: 'no-text-error' });
    });

    it('ignores a blank/whitespace-only error string', () => {
      const events = run([
        { type: 'assistant', message: { id: 'm_err3', content: [], stop_reason: 'end_turn' }, error: '   ' },
      ]);
      expect(events.find((e) => e.type === 'error')).toBeUndefined();
    });

    it('resets recentWriteContents/wroteHtmlFileThisTurn when the turn ends for a reason other than tool_use', () => {
      const events = run([
        {
          type: 'assistant',
          message: {
            id: 'm_write',
            content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: 'a.html', content: '<p>hi</p>' } }],
            stop_reason: 'tool_use',
          },
        },
        {
          type: 'assistant',
          message: { id: 'm_write', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' },
        },
      ]);
      // Both the tool_use and the follow-up text should surface; the turn_end
      // for 'tool_use' does NOT reset write-echo state, but the 'end_turn'
      // turn_end (a non-tool_use stop reason) does.
      expect(events.map((e) => e.type)).toEqual(['tool_use', 'turn_end', 'text_delta', 'turn_end']);
    });

    it('emits no turn_end when stop_reason is absent', () => {
      const events = run([
        { type: 'assistant', message: { id: 'm_no_stop', content: [{ type: 'text', text: 'hi' }] } },
      ]);
      expect(events.map((e) => e.type)).toEqual(['text_delta']);
    });

    it('skips non-record content blocks inside an assistant message', () => {
      const events = run([
        { type: 'assistant', message: { id: 'm_skip', content: [null, 42, { type: 'text', text: 'ok' }] } },
      ]);
      expect(events).toEqual([{ type: 'text_delta', delta: 'ok' }]);
    });

    it('does not re-emit assistant text/thinking already streamed via deltas for the same message id', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'message_start', message: { id: 'm_dup' } } },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'streamed' } },
        },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: 'thought' } },
        },
        {
          type: 'assistant',
          message: {
            id: 'm_dup',
            content: [
              { type: 'text', text: 'streamed' },
              { type: 'thinking', thinking: 'thought' },
            ],
          },
        },
      ]);
      expect(events.map((e) => e.type)).toEqual(['text_delta', 'thinking_delta']);
    });

    it('emits thinking text from the final assistant wrapper when no thinking_delta streamed it', () => {
      const events = run([
        {
          type: 'assistant',
          message: { id: 'm_think', content: [{ type: 'thinking', thinking: 'reasoning about it' }] },
        },
      ]);
      expect(events).toEqual([{ type: 'thinking_delta', delta: 'reasoning about it' }]);
    });

    it('uses currentMessageId as the streamed-text id when the wrapper omits an explicit id', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'message_start', message: { id: 'm_implicit' } } },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } },
        },
        // No `id` field on the assistant wrapper's message.
        { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } },
      ]);
      expect(events).toEqual([{ type: 'text_delta', delta: 'partial' }]);
    });

    it('uses currentMessageId as the streamed-thinking id when the wrapper omits an explicit id', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'message_start', message: { id: 'm_implicit_think' } } },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reasoning' } },
        },
        // No `id` field on the assistant wrapper's message.
        { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'reasoning' }] } },
      ]);
      expect(events).toEqual([{ type: 'thinking_delta', delta: 'reasoning' }]);
    });
  });

  describe('user message / tool_result handling', () => {
    it('skips non-record and non-tool_result content blocks', () => {
      const events = run([
        {
          type: 'user',
          message: { content: [null, { type: 'text', text: 'not a tool result' }, { type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }] },
        },
      ]);
      expect(events).toEqual([{ type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false }]);
    });

    it('stringifies a tool_result content array with mixed text/non-text blocks', () => {
      const events = run([
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 't2',
                content: [{ type: 'text', text: 'line one' }, { type: 'image', data: 'xyz' }],
                is_error: false,
              },
            ],
          },
        },
      ]);
      expect(events[0]).toEqual({
        type: 'tool_result',
        toolUseId: 't2',
        content: `line one\n${JSON.stringify({ type: 'image', data: 'xyz' })}`,
        isError: false,
      });
    });

    it('JSON-stringifies a non-string, non-array tool_result content', () => {
      const events = run([
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: { code: 1 }, is_error: false }] } },
      ]);
      expect(events[0]).toMatchObject({ content: JSON.stringify({ code: 1 }) });
    });

    it('defaults isError to false when is_error is absent', () => {
      const events = run([
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't4', content: 'ok' }] } },
      ]);
      expect(events[0]).toMatchObject({ isError: false });
    });
  });

  describe('runtime task tracking (TaskCreate/TaskUpdate → TodoWrite)', () => {
    it('creates a task from `subject` and emits a TodoWrite snapshot', () => {
      const events = run([taskToolUse('c1', 'TaskCreate', { taskId: '1', subject: 'Write the README' })]);
      expect(events).toEqual([
        {
          type: 'tool_use',
          id: 'c1:todo-task',
          name: 'TodoWrite',
          input: { todos: [{ content: 'Write the README', status: 'pending' }] },
        },
      ]);
    });

    it('falls back to `description` when `subject` is absent', () => {
      const events = run([taskToolUse('c2', 'TaskCreate', { taskId: '2', description: 'Fix the bug' })]);
      expect(events[0]).toMatchObject({ input: { todos: [{ content: 'Fix the bug', status: 'pending' }] } });
    });

    it('falls through to a normal tool_use (no TodoWrite snapshot) when TaskCreate has neither subject nor description', () => {
      const events = run([taskToolUse('c3', 'TaskCreate', { taskId: '3' })]);
      expect(events).toEqual([{ type: 'tool_use', id: 'c3', name: 'TaskCreate', input: { taskId: '3' } }]);
    });

    it('auto-generates a numeric task id when TaskCreate omits taskId, skipping ids already taken', () => {
      const events = run([
        taskToolUse('c4', 'TaskCreate', { taskId: '1', subject: 'first' }),
        taskToolUse('c5', 'TaskCreate', { subject: 'second (auto id)' }),
      ]);
      const second = events[1]!.input as { todos: Array<{ content: string }> };
      expect(second.todos.map((t) => t.content)).toEqual(['first', 'second (auto id)']);
    });

    it('advances the id counter when an explicit numeric taskId is >= the next generated id', () => {
      const events = run([
        taskToolUse('c6', 'TaskCreate', { taskId: '5', subject: 'explicit five' }),
        taskToolUse('c7', 'TaskCreate', { subject: 'auto after five' }),
      ]);
      const snapshot = events[1]!.input as { todos: Array<{ content: string }> };
      expect(snapshot.todos).toHaveLength(2);
      expect(snapshot.todos[1]?.content).toBe('auto after five');
    });

    it('carries activeForm through TaskCreate when provided', () => {
      const events = run([taskToolUse('c8', 'TaskCreate', { taskId: '8', subject: 'do it', activeForm: 'Doing it' })]);
      expect(events[0]).toMatchObject({ input: { todos: [{ content: 'do it', status: 'pending', activeForm: 'Doing it' }] } });
    });

    it('updates an existing task via TaskUpdate, overriding subject/status/activeForm', () => {
      const events = run([
        taskToolUse('c9', 'TaskCreate', { taskId: '9', subject: 'initial', activeForm: 'Doing initial' }),
        taskToolUse('c10', 'TaskUpdate', { taskId: '9', subject: 'revised', status: 'completed' }),
      ]);
      const finalSnapshot = events[events.length - 1]!.input as { todos: Array<Record<string, unknown>> };
      expect(finalSnapshot.todos).toEqual([{ content: 'revised', status: 'completed', activeForm: 'Doing initial' }]);
    });

    it('overrides activeForm on TaskUpdate when it supplies its own', () => {
      const events = run([
        taskToolUse('c9b', 'TaskCreate', { taskId: '9b', subject: 'initial', activeForm: 'Doing initial' }),
        taskToolUse('c10b', 'TaskUpdate', { taskId: '9b', activeForm: 'Now doing revised' }),
      ]);
      const finalSnapshot = events[events.length - 1]!.input as { todos: Array<Record<string, unknown>> };
      expect(finalSnapshot.todos).toEqual([{ content: 'initial', status: 'pending', activeForm: 'Now doing revised' }]);
    });

    it('falls back to `description` and preserves existing activeForm on TaskUpdate when both are absent', () => {
      const events = run([
        taskToolUse('c11', 'TaskCreate', { taskId: '11', subject: 'orig', activeForm: 'Orig-ing' }),
        taskToolUse('c12', 'TaskUpdate', { taskId: '11', description: 'via description', status: 'in_progress' }),
      ]);
      const finalSnapshot = events[events.length - 1]!.input as { todos: Array<Record<string, unknown>> };
      expect(finalSnapshot.todos).toEqual([{ content: 'via description', status: 'in_progress', activeForm: 'Orig-ing' }]);
    });

    it('keeps the existing content when TaskUpdate supplies neither subject nor description', () => {
      const events = run([
        taskToolUse('c13', 'TaskCreate', { taskId: '13', subject: 'stays the same' }),
        taskToolUse('c14', 'TaskUpdate', { taskId: '13', status: 'stopped' }),
      ]);
      const finalSnapshot = events[events.length - 1]!.input as { todos: Array<Record<string, unknown>> };
      expect(finalSnapshot.todos).toEqual([{ content: 'stays the same', status: 'stopped' }]);
    });

    it('falls through to a normal tool_use when TaskUpdate has a non-string taskId', () => {
      const events = run([taskToolUse('c15', 'TaskUpdate', { taskId: 42, subject: 'nope' })]);
      expect(events).toEqual([{ type: 'tool_use', id: 'c15', name: 'TaskUpdate', input: { taskId: 42, subject: 'nope' } }]);
    });

    it('falls through to a normal tool_use when TaskUpdate references an unknown taskId', () => {
      const events = run([taskToolUse('c16', 'TaskUpdate', { taskId: 'ghost', subject: 'nope' })]);
      expect(events).toEqual([{ type: 'tool_use', id: 'c16', name: 'TaskUpdate', input: { taskId: 'ghost', subject: 'nope' } }]);
    });

    it('treats a repeated toolUseId as an already-handled canonical snapshot (idempotent, no duplicate emission)', () => {
      const events = run([
        taskToolUse('dup1', 'TaskCreate', { taskId: '20', subject: 'first pass' }),
        taskToolUse('dup1', 'TaskCreate', { taskId: '20', subject: 'first pass' }),
      ]);
      expect(events).toHaveLength(1);
    });

    it('passes through a normal (non-task) tool_use unaffected by the task-snapshot path', () => {
      const events = run([taskToolUse('r1', 'Read', { file_path: 'a.ts' })]);
      expect(events).toEqual([{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'a.ts' } }]);
    });

    it('falls through to a normal tool_use when a TaskCreate-named tool_use has no input object', () => {
      const events = run([
        { type: 'assistant', message: { id: 'm_bad', content: [{ type: 'tool_use', id: 'bad1', name: 'TaskCreate' }] } },
      ]);
      // `input` becomes `null` (via `block.input ?? null`), so isRecord(input)
      // is false and emitCanonicalTaskSnapshot returns false; falls through
      // to a normal tool_use emission.
      expect(events).toEqual([{ type: 'tool_use', id: 'bad1', name: 'TaskCreate', input: null }]);
    });

    describe('normalizeTaskStatus synonyms', () => {
      it.each([
        ['completed', 'completed'],
        ['in_progress', 'in_progress'],
        ['stopped', 'stopped'],
        ['complete', 'completed'],
        ['done', 'completed'],
        ['doing', 'in_progress'],
        ['active', 'in_progress'],
        ['failed', 'stopped'],
        ['canceled', 'stopped'],
        ['cancelled', 'stopped'],
        ['literally-anything-else', 'pending'],
        [undefined, 'pending'],
      ])('normalizes status %p to %p', (input, expected) => {
        const events = run([taskToolUse('ns', 'TaskCreate', { taskId: '99', subject: 'status test', status: input })]);
        expect((events[0]!.input as { todos: Array<{ status: string }> }).todos[0]?.status).toBe(expected);
      });
    });
  });

  describe('file-write / artifact-echo suppression', () => {
    it('tracks up to 6 Write tool_use events, capping recentWriteContents internally at 5', () => {
      const writes = Array.from({ length: 6 }, (_, i) =>
        taskToolUse(`w${i}`, 'Write', { file_path: `f${i}.html`, content: `content ${i}` }),
      );
      const events = run(writes);
      expect(events.filter((e) => e.type === 'tool_use')).toHaveLength(6);
    });

    it('suppresses a duplicated artifact echo matching a just-written file', () => {
      const events = run([
        {
          type: 'assistant',
          message: {
            id: 'm1',
            content: [
              { type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: 'index.html', content: '<p>Hello</p>' } },
            ],
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'm1',
            content: [{ type: 'text', text: 'Here it is:\n<artifact type="text/html">\n<p>Hello</p>\n</artifact>\nDone.' }],
          },
        },
      ]);
      const textDeltas = events.filter((e) => e.type === 'text_delta').map((e) => e.delta as string);
      const combined = textDeltas.join('');
      expect(combined).not.toContain('<artifact');
      expect(combined).toContain('Here it is:');
      expect(combined).toContain('Done.');
    });

    it('keeps a non-duplicate artifact echo whose content differs from the write', () => {
      const events = run([
        {
          type: 'assistant',
          message: {
            id: 'm2',
            content: [
              { type: 'tool_use', id: 'w2', name: 'Write', input: { file_path: 'index.html', content: '<p>Original</p>' } },
            ],
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'm2',
            content: [{ type: 'text', text: '<artifact type="text/html">\n<p>Different content</p>\n</artifact>' }],
          },
        },
      ]);
      const combined = events.filter((e) => e.type === 'text_delta').map((e) => e.delta as string).join('');
      expect(combined).toContain('<p>Different content</p>');
    });

    it('suppresses an html artifact echo after a matching write when suppressHtmlArtifactsAfterFileWrite is set', () => {
      const events = run(
        [
          {
            type: 'assistant',
            message: {
              id: 'm3',
              content: [
                { type: 'tool_use', id: 'w3', name: 'Write', input: { file_path: 'index.html', content: '<p>same</p>' } },
              ],
              stop_reason: 'tool_use',
            },
          },
          {
            type: 'assistant',
            message: {
              id: 'm3',
              content: [{ type: 'text', text: '<artifact type="text/html">\n<p>same</p>\n</artifact>' }],
            },
          },
        ],
        { suppressHtmlArtifactsAfterFileWrite: true },
      );
      const combined = events.filter((e) => e.type === 'text_delta').map((e) => e.delta as string).join('');
      expect(combined).not.toContain('<artifact');
    });

    it('still suppresses a non-html artifact duplicate under suppressHtmlArtifactsAfterFileWrite via the generic body match', () => {
      const events = run(
        [
          {
            type: 'assistant',
            message: {
              id: 'm4',
              content: [
                { type: 'tool_use', id: 'w4', name: 'Write', input: { file_path: 'notes.md', content: 'shared text' } },
              ],
            },
          },
          {
            type: 'assistant',
            message: {
              id: 'm4',
              content: [{ type: 'text', text: '<artifact type="text/markdown">\nshared text\n</artifact>' }],
            },
          },
        ],
        { suppressHtmlArtifactsAfterFileWrite: true },
      );
      const combined = events.filter((e) => e.type === 'text_delta').map((e) => e.delta as string).join('');
      expect(combined).not.toContain('<artifact');
    });

    it('detects an Edit tool write via new_string and suppresses its matching echo', () => {
      const events = run([
        {
          type: 'assistant',
          message: {
            id: 'm5',
            content: [
              { type: 'tool_use', id: 'e1', name: 'Edit', input: { path: 'style.css', new_string: '.a { color: red; }' } },
            ],
          },
        },
        {
          type: 'assistant',
          message: {
            id: 'm5',
            content: [{ type: 'text', text: '<artifact type="text/css">\n.a { color: red; }\n</artifact>' }],
          },
        },
      ]);
      const combined = events.filter((e) => e.type === 'text_delta').map((e) => e.delta as string).join('');
      expect(combined).not.toContain('<artifact');
    });

    it('does not treat a Read tool_use as a file write', () => {
      const events = run([
        { type: 'assistant', message: { id: 'm6', content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'a.txt' } }] } },
      ]);
      expect(events).toEqual([{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'a.txt' } }]);
    });

    it('recognizes write_file and replace tool names as file writes', () => {
      const events1 = run([
        { type: 'assistant', message: { id: 'm7', content: [{ type: 'tool_use', id: 'wf1', name: 'write_file', input: { path: 'plain.txt', content: 'hello there' } }] } },
      ]);
      expect(events1[0]).toMatchObject({ name: 'write_file' });

      const events2 = run([
        { type: 'assistant', message: { id: 'm8', content: [{ type: 'tool_use', id: 'rp1', name: 'replace', input: { path: 'plain2.txt', new_string: 'replaced text' } }] } },
      ]);
      expect(events2[0]).toMatchObject({ name: 'replace' });
    });

    it('does not treat a Write tool_use as a file write when its path/content give no signal', () => {
      const events = run([
        { type: 'assistant', message: { id: 'm9', content: [{ type: 'tool_use', id: 'w9', name: 'Write', input: { file_path: 'noext' } }] } },
      ]);
      expect(events).toEqual([{ type: 'tool_use', id: 'w9', name: 'Write', input: { file_path: 'noext' } }]);
    });

    it('recognizes an html write via `filePath` and content sniffing (doctype) for isHtmlWriteToolInput', () => {
      const events = run(
        [
          {
            type: 'assistant',
            message: {
              id: 'm10',
              content: [
                { type: 'tool_use', id: 'w10', name: 'Write', input: { filePath: 'page.html', content: '<!doctype html><html></html>' } },
              ],
              stop_reason: 'tool_use',
            },
          },
          {
            type: 'assistant',
            message: {
              id: 'm10',
              content: [{ type: 'text', text: '<artifact type="text/html">\n<!doctype html><html></html>\n</artifact>' }],
            },
          },
        ],
        { suppressHtmlArtifactsAfterFileWrite: true },
      );
      const combined = events.filter((e) => e.type === 'text_delta').map((e) => e.delta as string).join('');
      expect(combined).not.toContain('<artifact');
    });

    it('treats a malformed artifact tag (no `>` on the open tag) as not redundant and passes it through', () => {
      // isRedundantWrittenArtifact's `close <= gt` guard exists for exactly
      // this shape: `<artifact` immediately butted against `</artifact>`
      // with no closing `>` of its own, so the only `>` in the whole
      // candidate is the closing tag's — placing `gt` AFTER `close`.
      const events = run([
        {
          type: 'assistant',
          message: {
            id: 'm12',
            content: [{ type: 'tool_use', id: 'w12', name: 'Write', input: { file_path: 'a.html', content: 'X' } }],
          },
        },
        {
          type: 'assistant',
          message: { id: 'm12', content: [{ type: 'text', text: '<artifact</artifact>' }] },
        },
      ]);
      const combined = events.filter((e) => e.type === 'text_delta').map((e) => e.delta as string).join('');
      expect(combined).toBe('<artifact</artifact>');
    });

    it('handles an artifact echo whose open tag is split across two text deltas', () => {
      const events: Record<string, unknown>[] = [];
      const handler = createClaudeStreamHandler((e) => events.push(e));
      feedLines(handler, [
        {
          type: 'assistant',
          message: { id: 'ms1', content: [{ type: 'tool_use', id: 'wsplit', name: 'Write', input: { file_path: 'index.html', content: 'split body' } }] },
        },
      ]);
      handler.feed(
        `${JSON.stringify({
          type: 'stream_event',
          event: { type: 'message_start', message: { id: 'ms1' } },
        })}\n`,
      );
      handler.feed(
        `${JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'before <arti' } },
        })}\n`,
      );
      handler.feed(
        `${JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'fact type="text/html">\nsplit body\n</artifact> after' },
          },
        })}\n`,
      );
      handler.flush();
      const combined = events.filter((e) => e.type === 'text_delta').map((e) => e.delta as string).join('');
      expect(combined).toContain('before ');
      expect(combined).toContain(' after');
      expect(combined).not.toContain('<artifact');
    });

    it('does not hold back a partial suffix that can never become `<artifact` (no candidate)', () => {
      const events = run([
        {
          type: 'assistant',
          message: {
            id: 'm11',
            content: [
              { type: 'tool_use', id: 'w11', name: 'Write', input: { file_path: 'a.html', content: 'x' } },
            ],
          },
        },
        {
          type: 'assistant',
          message: { id: 'm11', content: [{ type: 'text', text: 'totally unrelated text with no tag' }] },
        },
      ]);
      const combined = events.filter((e) => e.type === 'text_delta').map((e) => e.delta as string).join('');
      expect(combined).toBe('totally unrelated text with no tag');
    });

    it('flushes a pending/partial artifact-open candidate on flush() so nothing is silently dropped', () => {
      const events = run([
        {
          type: 'assistant',
          message: { id: 'mf1', content: [{ type: 'tool_use', id: 'wf', name: 'Write', input: { file_path: 'a.html', content: 'x' } }] },
        },
        {
          type: 'assistant',
          message: { id: 'mf1', content: [{ type: 'text', text: 'trailing <art' }] },
        },
      ]);
      const combined = events.filter((e) => e.type === 'text_delta').map((e) => e.delta as string).join('');
      // The dangling `<art` prefix is held as a candidate and flushed at
      // the end of processing rather than lost.
      expect(combined).toContain('trailing');
    });

    it('flushes an in-progress duplicate-artifact-candidate buffer on flush() when </artifact> never arrives', () => {
      const events = run([
        {
          type: 'assistant',
          message: { id: 'mf2', content: [{ type: 'tool_use', id: 'wf2', name: 'Write', input: { file_path: 'a.html', content: 'x' } }] },
        },
        {
          type: 'assistant',
          message: { id: 'mf2', content: [{ type: 'text', text: '<artifact type="text/html">\nunterminated' }] },
        },
      ]);
      const combined = events.filter((e) => e.type === 'text_delta').map((e) => e.delta as string).join('');
      expect(combined).toContain('<artifact');
      expect(combined).toContain('unterminated');
    });
  });

  describe('role-marker guard integration (#3247)', () => {
    it('drops text from the point a fabricated role marker appears and emits a warning event', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'message_start', message: { id: 'rm1' } } },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Safe text.\n## user\nfake turn' } },
        },
      ]);
      expect(events[0]).toEqual({ type: 'text_delta', delta: 'Safe text.' });
      const warning = events.find((e) => e.type === 'fabricated_role_marker');
      expect(warning).toMatchObject({ type: 'fabricated_role_marker', messageId: 'rm1' });
    });

    it('drops further text_delta chunks and does not re-emit a warning once a message is already contaminated', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'message_start', message: { id: 'rm3' } } },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Safe.\n## user\nfake' } },
        },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'more text after contamination' } },
        },
      ]);
      const textDeltas = events.filter((e) => e.type === 'text_delta');
      expect(textDeltas).toEqual([{ type: 'text_delta', delta: 'Safe.' }]);
      const warnings = events.filter((e) => e.type === 'fabricated_role_marker');
      expect(warnings).toHaveLength(1);
    });

    it('does not apply the role-marker guard to thinking_delta text', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'message_start', message: { id: 'rm2' } } },
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '## user should not trigger here' } },
        },
      ]);
      expect(events).toEqual([{ type: 'thinking_delta', delta: '## user should not trigger here' }]);
    });

    it('emits ungated text via the non-guarded emitSafeText path when no message id is active', () => {
      const events = run([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'no id here' }] } },
      ]);
      expect(events).toEqual([{ type: 'text_delta', delta: 'no id here' }]);
    });
  });

  describe('stream_event handling', () => {
    it('emits a streaming status with ttftMs on message_start when present', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'message_start', message: { id: 'ttft1' }, ttft_ms: 42 } },
      ]);
      expect(events).toEqual([{ type: 'status', label: 'streaming', ttftMs: 42 }]);
    });

    it('does not emit a status when ttft_ms is not a number', () => {
      const events = run([{ type: 'stream_event', event: { type: 'message_start', message: { id: 'ttft2' } } }]);
      expect(events).toEqual([]);
    });

    it('clears the previous message role guard when a new message_start arrives with an active guard', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'message_start', message: { id: 'a' } } },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi from a' } } },
        { type: 'stream_event', event: { type: 'message_start', message: { id: 'b' } } },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi from b' } } },
      ]);
      expect(events.map((e) => e.delta)).toEqual(['hi from a', 'hi from b']);
    });

    it('ignores a message_start with a non-record message (currentMessageId becomes null)', () => {
      const events = run([{ type: 'stream_event', event: { type: 'message_start' } }]);
      expect(events).toEqual([]);
    });

    it('uses a null-namespaced blockKey when no message is active', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'X' } } },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } } },
        { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
      ]);
      expect(events).toEqual([
        { type: 'tool_input_delta', id: 't', name: 'X', delta: '{}' },
        { type: 'tool_use', id: 't', name: 'X', input: {} },
      ]);
    });

    it('emits thinking_start when a thinking content block starts', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } },
      ]);
      expect(events).toEqual([{ type: 'thinking_start' }]);
    });

    it('captures inline `input` on content_block_start for a tool_use block (no deltas)', () => {
      const events = run([
        {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'inline1', name: 'Grep', input: { pattern: 'foo' } },
          },
        },
        { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
      ]);
      expect(events).toEqual([{ type: 'tool_use', id: 'inline1', name: 'Grep', input: { pattern: 'foo' } }]);
    });

    it('does not emit tool_input_delta when the block at that index is not a tool_use block', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } } },
      ]);
      expect(events).toEqual([]);
    });

    it('ignores an input_json_delta when no block state exists for that index', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'content_block_delta', index: 5, delta: { type: 'input_json_delta', partial_json: '{}' } } },
      ]);
      expect(events).toEqual([]);
    });

    it('ignores an unrecognized delta type', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'something_else' } } },
      ]);
      expect(events).toEqual([]);
    });

    it('silently swallows a malformed partial_json at content_block_stop (falls through, no tool_use emitted)', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'bad', name: 'X' } } },
        { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{not json' } } },
        { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
      ]);
      expect(events).toEqual([
        { type: 'tool_input_delta', id: 'bad', name: 'X', delta: '{not json' },
      ]);
    });

    it('no-ops content_block_stop when there is no recorded state for that index', () => {
      const events = run([{ type: 'stream_event', event: { type: 'content_block_stop', index: 9 } }]);
      expect(events).toEqual([]);
    });

    it('no-ops content_block_stop for a non-tool_use block with no accumulated input', () => {
      const events = run([
        { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
        { type: 'stream_event', event: { type: 'content_block_stop', index: 0 } },
      ]);
      expect(events).toEqual([]);
    });

    it('ignores stream_event records whose inner `event` is not a record', () => {
      const events = run([{ type: 'stream_event', event: 'not-a-record' }]);
      expect(events).toEqual([]);
    });

    it('ignores a top-level non-record object fed to handleObject', () => {
      const events = run([null]);
      expect(events).toEqual([]);
    });
  });
});
