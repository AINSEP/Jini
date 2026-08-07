import { describe, expect, it, vi } from 'vitest';
import { mapPiRpcEvent, type PiRpcContext } from '../events.js';

function ctx(overrides: Partial<PiRpcContext> = {}): PiRpcContext {
  return { runStartedAt: Date.now(), sentFirstToken: { value: false }, ...overrides };
}

describe('mapPiRpcEvent', () => {
  it('agent_start emits a working status and returns null', () => {
    const send = vi.fn();
    expect(mapPiRpcEvent({ type: 'agent_start' }, send, ctx())).toBeNull();
    expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'working' });
  });

  it('agent_end returns "agent_end" and sends nothing', () => {
    const send = vi.fn();
    expect(mapPiRpcEvent({ type: 'agent_end' }, send, ctx())).toBe('agent_end');
    expect(send).not.toHaveBeenCalled();
  });

  it('turn_start emits a thinking status', () => {
    const send = vi.fn();
    expect(mapPiRpcEvent({ type: 'turn_start' }, send, ctx())).toBeNull();
    expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'thinking' });
  });

  it('turn_end with usage emits a usage event with cost.total', () => {
    const send = vi.fn();
    mapPiRpcEvent(
      {
        type: 'turn_end',
        message: { usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10, cost: { total: 0.5 } } },
      },
      send,
      ctx({ runStartedAt: 1000 }),
    );
    expect(send).toHaveBeenCalledWith('agent', {
      type: 'usage',
      usage: { input_tokens: 1, output_tokens: 2, cached_read_tokens: 3, cached_write_tokens: 4, total_tokens: 10 },
      costUsd: 0.5,
      durationMs: expect.any(Number),
    });
  });

  it('turn_end falls back to cost.totalCost when cost.total is absent', () => {
    const send = vi.fn();
    mapPiRpcEvent(
      { type: 'turn_end', message: { usage: { input: 1, cost: { totalCost: 0.25 } } } },
      send,
      ctx(),
    );
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ costUsd: 0.25 }));
  });

  it('turn_end with usage but no cost object sends costUsd: null', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'turn_end', message: { usage: { input: 1 } } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ costUsd: null }));
  });

  it('turn_end with a usage object that has no known numeric fields sends no usage event', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'turn_end', message: { usage: {} } }, send, ctx());
    expect(send).not.toHaveBeenCalled();
  });

  it('turn_end with no message sends nothing', () => {
    const send = vi.fn();
    expect(mapPiRpcEvent({ type: 'turn_end' }, send, ctx())).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('turn_end with stopReason "error" emits an error event using errorMessage', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'turn_end', message: { stopReason: 'error', errorMessage: 'boom' } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'error', message: 'boom', raw: expect.anything() });
  });

  it('turn_end with stopReason "error" but no errorMessage uses the fallback text', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'turn_end', message: { stopReason: 'error' } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ message: 'Pi agent error' }));
  });

  it('message_update text_delta emits streaming status once, then text_delta events', () => {
    const send = vi.fn();
    const c = ctx();
    mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'a' } }, send, c);
    mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'b' } }, send, c);
    expect(send).toHaveBeenNthCalledWith(1, 'agent', { type: 'status', label: 'streaming', ttftMs: expect.any(Number) });
    expect(send).toHaveBeenNthCalledWith(2, 'agent', { type: 'text_delta', delta: 'a' });
    expect(send).toHaveBeenNthCalledWith(3, 'agent', { type: 'text_delta', delta: 'b' });
  });

  it('message_update thinking_delta/thinking_start/thinking_end', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 't' } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'thinking_delta', delta: 't' });
    send.mockClear();
    mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'thinking_start' });
    send.mockClear();
    mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'thinking_end' });
  });

  it('message_update error event uses reason, falling back to delta, falling back to generic text', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 'error', reason: 'r' } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'error', message: 'r', raw: expect.anything() });
    send.mockClear();
    mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 'error', delta: 'd' } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ message: 'd' }));
    send.mockClear();
    mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 'error' } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ message: 'Agent error' }));
  });

  it('message_update with an unrecognised assistantMessageEvent type sends nothing', () => {
    const send = vi.fn();
    expect(
      mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 'unknown' } }, send, ctx()),
    ).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('message_update with a non-string assistantMessageEvent.type sends nothing', () => {
    const send = vi.fn();
    expect(
      mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 42 } }, send, ctx()),
    ).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('message_update text_delta with a non-string delta sends nothing', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 7 } }, send, ctx());
    expect(send).not.toHaveBeenCalled();
  });

  it('message_update thinking_delta with a non-string delta sends nothing', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 7 } }, send, ctx());
    expect(send).not.toHaveBeenCalled();
  });

  it('message_update with a non-record assistantMessageEvent sends nothing (falls through)', () => {
    const send = vi.fn();
    expect(mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: 'nope' }, send, ctx())).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not re-emit the streaming status on a second text_delta', () => {
    const send = vi.fn();
    const c = ctx();
    c.sentFirstToken.value = true;
    mapPiRpcEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'x' } }, send, c);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('agent', { type: 'text_delta', delta: 'x' });
  });

  it('message_end sends nothing', () => {
    const send = vi.fn();
    expect(mapPiRpcEvent({ type: 'message_end' }, send, ctx())).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('tool_execution_start emits a tool_use event', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'Write', args: { a: 1 } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'tool_use', id: 'tc-1', name: 'Write', input: { a: 1 } });
  });

  it('tool_execution_start with no id/name/args defaults to null', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'tool_execution_start' }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'tool_use', id: null, name: null, input: null });
  });

  it('tool_execution_end joins text content blocks from an array', () => {
    const send = vi.fn();
    mapPiRpcEvent(
      {
        type: 'tool_execution_end',
        toolCallId: 'tc-1',
        result: { content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] },
        isError: false,
      },
      send,
      ctx(),
    );
    expect(send).toHaveBeenCalledWith('agent', {
      type: 'tool_result',
      toolUseId: 'tc-1',
      content: 'line1\nline2',
      isError: false,
    });
  });

  it('tool_execution_end defaults to "" when a text-type block has no text field', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'tool_execution_end', result: { content: [{ type: 'text' }] } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ content: '' }));
  });

  it('tool_execution_end JSON-stringifies a non-text content block', () => {
    const send = vi.fn();
    mapPiRpcEvent(
      { type: 'tool_execution_end', result: { content: [{ type: 'other', data: 1 }] } },
      send,
      ctx(),
    );
    expect(send).toHaveBeenCalledWith(
      'agent',
      expect.objectContaining({ content: JSON.stringify({ type: 'other', data: 1 }) }),
    );
  });

  it('tool_execution_end uses a plain string content directly', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'tool_execution_end', result: { content: 'plain text' } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ content: 'plain text' }));
  });

  it('tool_execution_end with no usable content sends an empty string', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'tool_execution_end', result: {} }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ content: '' }));
  });

  it('tool_execution_end with no result at all sends an empty string and isError false', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'tool_execution_end' }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'tool_result', toolUseId: null, content: '', isError: false });
  });

  it('extension_error uses raw.error, or a fallback when absent/empty', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'extension_error', error: 'boom' }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'error', message: 'boom', raw: expect.anything() });
    send.mockClear();
    mapPiRpcEvent({ type: 'extension_error', error: '' }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ message: 'Extension error' }));
  });

  it('compaction_start and auto_retry_start emit status events', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'compaction_start' }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'compacting' });
    send.mockClear();
    mapPiRpcEvent({ type: 'auto_retry_start' }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'retrying' });
  });

  it('auto_retry_end with success !== false sends nothing', () => {
    const send = vi.fn();
    expect(mapPiRpcEvent({ type: 'auto_retry_end', success: true }, send, ctx())).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('auto_retry_end with success: false emits an error using finalError or a fallback', () => {
    const send = vi.fn();
    mapPiRpcEvent({ type: 'auto_retry_end', success: false, finalError: 'exhausted' }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'error', message: 'exhausted', raw: expect.anything() });
    send.mockClear();
    mapPiRpcEvent({ type: 'auto_retry_end', success: false }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ message: 'Auto-retry exhausted' }));
  });

  it('returns null and sends nothing for a completely unrecognised event type', () => {
    const send = vi.fn();
    expect(mapPiRpcEvent({ type: 'something_else' }, send, ctx())).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('returns null and sends nothing for a non-string event type', () => {
    const send = vi.fn();
    expect(mapPiRpcEvent({ type: 99 }, send, ctx())).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
