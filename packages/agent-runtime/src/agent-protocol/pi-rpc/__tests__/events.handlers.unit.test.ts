/**
 * Direct unit tests for the exported per-event-kind handlers in events.ts
 * (the functions `mapPiRpcEvent`'s dispatch tables route to). The dispatch
 * itself, and each handler's observable effect through `mapPiRpcEvent`, is
 * already covered by `events.test.ts`; this file calls the handlers
 * directly so each is independently verifiable without going through the
 * `raw.type` / `ev.type` string-keyed lookup.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  handleAgentStart,
  handleAgentEnd,
  handleTurnStart,
  buildTokenUsage,
  emitTurnEndUsage,
  emitTurnEndErrorIfPresent,
  handleTurnEnd,
  handleAssistantTextDelta,
  handleAssistantThinkingDelta,
  handleAssistantThinkingStart,
  handleAssistantThinkingEnd,
  handleAssistantError,
  handleMessageUpdate,
  handleMessageEnd,
  handleToolExecutionStart,
  handleToolExecutionEnd,
  handleExtensionError,
  handleCompactionStart,
  handleAutoRetryStart,
  handleAutoRetryEnd,
  type PiRpcContext,
} from '../events.js';

function ctx(overrides: Partial<PiRpcContext> = {}): PiRpcContext {
  return { runStartedAt: 1_000, sentFirstToken: { value: false }, ...overrides };
}

describe('handleAgentStart', () => {
  it('sends a working status', () => {
    const send = vi.fn();
    expect(handleAgentStart({}, send)).toBeNull();
    expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'working' });
  });
});

describe('handleAgentEnd', () => {
  it('returns the agent_end sentinel and sends nothing', () => {
    expect(handleAgentEnd()).toBe('agent_end');
  });
});

describe('handleTurnStart', () => {
  it('sends a thinking status', () => {
    const send = vi.fn();
    expect(handleTurnStart({}, send)).toBeNull();
    expect(send).toHaveBeenCalledWith('agent', { type: 'status', label: 'thinking' });
  });
});

describe('buildTokenUsage', () => {
  it('extracts every known numeric field', () => {
    expect(
      buildTokenUsage({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10 }),
    ).toEqual({ input_tokens: 1, output_tokens: 2, cached_read_tokens: 3, cached_write_tokens: 4, total_tokens: 10 });
  });

  it('omits fields that are absent or non-numeric', () => {
    expect(buildTokenUsage({ input: 'nope' })).toEqual({});
    expect(buildTokenUsage({})).toEqual({});
  });
});

describe('emitTurnEndUsage', () => {
  it('sends nothing when the usage object has no known numeric fields', () => {
    const send = vi.fn();
    emitTurnEndUsage({}, send, ctx());
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a usage event with cost.total when present', () => {
    const send = vi.fn();
    emitTurnEndUsage({ input: 1, cost: { total: 0.5 } }, send, ctx({ runStartedAt: 1000 }));
    expect(send).toHaveBeenCalledWith('agent', {
      type: 'usage',
      usage: { input_tokens: 1 },
      costUsd: 0.5,
      durationMs: expect.any(Number),
    });
  });

  it('falls back to cost.totalCost when cost.total is absent', () => {
    const send = vi.fn();
    emitTurnEndUsage({ input: 1, cost: { totalCost: 0.25 } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ costUsd: 0.25 }));
  });

  it('sends costUsd: null when there is no cost object at all', () => {
    const send = vi.fn();
    emitTurnEndUsage({ input: 1 }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ costUsd: null }));
  });
});

describe('emitTurnEndErrorIfPresent', () => {
  it('sends nothing when stopReason is not "error"', () => {
    const send = vi.fn();
    emitTurnEndErrorIfPresent({ stopReason: 'stop' }, {}, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing when message is undefined', () => {
    const send = vi.fn();
    emitTurnEndErrorIfPresent(undefined, {}, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('uses errorMessage when present', () => {
    const send = vi.fn();
    const raw = { type: 'turn_end' };
    emitTurnEndErrorIfPresent({ stopReason: 'error', errorMessage: 'boom' }, raw, send);
    expect(send).toHaveBeenCalledWith('agent', { type: 'error', message: 'boom', raw });
  });

  it('falls back to a generic message when errorMessage is absent', () => {
    const send = vi.fn();
    emitTurnEndErrorIfPresent({ stopReason: 'error' }, {}, send);
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ message: 'Pi agent error' }));
  });
});

describe('handleTurnEnd', () => {
  it('emits both usage and error when both are present', () => {
    const send = vi.fn();
    handleTurnEnd(
      { message: { usage: { input: 1 }, stopReason: 'error', errorMessage: 'boom' } },
      send,
      ctx(),
    );
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'usage' }));
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ type: 'error', message: 'boom' }));
  });

  it('sends nothing when there is no message at all', () => {
    const send = vi.fn();
    expect(handleTurnEnd({}, send, ctx())).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('handleAssistantTextDelta', () => {
  it('sends nothing when delta is not a string', () => {
    const send = vi.fn();
    handleAssistantTextDelta({ delta: 7 }, send, ctx());
    expect(send).not.toHaveBeenCalled();
  });

  it('emits a streaming status once, then text_delta for every call', () => {
    const send = vi.fn();
    const c = ctx();
    handleAssistantTextDelta({ delta: 'a' }, send, c);
    handleAssistantTextDelta({ delta: 'b' }, send, c);
    expect(send).toHaveBeenNthCalledWith(1, 'agent', { type: 'status', label: 'streaming', ttftMs: expect.any(Number) });
    expect(send).toHaveBeenNthCalledWith(2, 'agent', { type: 'text_delta', delta: 'a' });
    expect(send).toHaveBeenNthCalledWith(3, 'agent', { type: 'text_delta', delta: 'b' });
  });

  it('does not re-emit the streaming status once sentFirstToken is already true', () => {
    const send = vi.fn();
    handleAssistantTextDelta({ delta: 'x' }, send, ctx({ sentFirstToken: { value: true } }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('agent', { type: 'text_delta', delta: 'x' });
  });
});

describe('handleAssistantThinkingDelta', () => {
  it('sends nothing when delta is not a string', () => {
    const send = vi.fn();
    handleAssistantThinkingDelta({ delta: 7 }, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('emits thinking_delta', () => {
    const send = vi.fn();
    handleAssistantThinkingDelta({ delta: 't' }, send);
    expect(send).toHaveBeenCalledWith('agent', { type: 'thinking_delta', delta: 't' });
  });
});

describe('handleAssistantThinkingStart / handleAssistantThinkingEnd', () => {
  it('emit thinking_start and thinking_end respectively', () => {
    const send = vi.fn();
    handleAssistantThinkingStart({}, send);
    handleAssistantThinkingEnd({}, send);
    expect(send).toHaveBeenNthCalledWith(1, 'agent', { type: 'thinking_start' });
    expect(send).toHaveBeenNthCalledWith(2, 'agent', { type: 'thinking_end' });
  });
});

describe('handleAssistantError', () => {
  it('prefers reason, then delta, then a generic message', () => {
    const send = vi.fn();
    const raw = { type: 'message_update' };
    handleAssistantError({ reason: 'r' }, send, ctx(), raw);
    expect(send).toHaveBeenCalledWith('agent', { type: 'error', message: 'r', raw });
    send.mockClear();
    handleAssistantError({ delta: 'd' }, send, ctx(), raw);
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ message: 'd' }));
    send.mockClear();
    handleAssistantError({}, send, ctx(), raw);
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ message: 'Agent error' }));
  });
});

describe('handleMessageUpdate', () => {
  it('returns null and sends nothing when assistantMessageEvent is missing or not a record', () => {
    const send = vi.fn();
    expect(handleMessageUpdate({}, send, ctx())).toBeNull();
    expect(handleMessageUpdate({ assistantMessageEvent: 'nope' }, send, ctx())).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('returns null and sends nothing for a non-string ev.type', () => {
    const send = vi.fn();
    handleMessageUpdate({ assistantMessageEvent: { type: 42 } }, send, ctx());
    expect(send).not.toHaveBeenCalled();
  });

  it('returns null and sends nothing for an unrecognised ev.type', () => {
    const send = vi.fn();
    handleMessageUpdate({ assistantMessageEvent: { type: 'unknown' } }, send, ctx());
    expect(send).not.toHaveBeenCalled();
  });

  it('dispatches to the matching sub-handler', () => {
    const send = vi.fn();
    handleMessageUpdate({ assistantMessageEvent: { type: 'thinking_start' } }, send, ctx());
    expect(send).toHaveBeenCalledWith('agent', { type: 'thinking_start' });
  });
});

describe('handleMessageEnd', () => {
  it('returns null and sends nothing', () => {
    expect(handleMessageEnd()).toBeNull();
  });
});

describe('handleToolExecutionStart', () => {
  it('sends a tool_use event, nullish-coalescing missing fields', () => {
    const send = vi.fn();
    handleToolExecutionStart({}, send);
    expect(send).toHaveBeenCalledWith('agent', { type: 'tool_use', id: null, name: null, input: null });
  });

  it('forwards the toolCallId, toolName, and args fields when present', () => {
    const send = vi.fn();
    handleToolExecutionStart({ toolCallId: 'c1', toolName: 'bash', args: { cmd: 'ls' } }, send);
    expect(send).toHaveBeenCalledWith('agent', { type: 'tool_use', id: 'c1', name: 'bash', input: { cmd: 'ls' } });
  });
});

describe('handleToolExecutionEnd', () => {
  it('joins an array of text content blocks with newlines', () => {
    const send = vi.fn();
    handleToolExecutionEnd({ toolCallId: 'c1', result: { content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] } }, send);
    expect(send).toHaveBeenCalledWith('agent', { type: 'tool_result', toolUseId: 'c1', content: 'line1\nline2', isError: false });
  });

  it('JSON-stringifies non-text content blocks', () => {
    const send = vi.fn();
    handleToolExecutionEnd({ result: { content: [{ type: 'image', data: 'x' }] } }, send);
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ content: JSON.stringify({ type: 'image', data: 'x' }) }));
  });

  it('uses a plain string content value directly', () => {
    const send = vi.fn();
    handleToolExecutionEnd({ result: { content: 'plain text' } }, send);
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ content: 'plain text' }));
  });

  it('sends empty content when result.content is absent or an unrecognised shape', () => {
    const send = vi.fn();
    handleToolExecutionEnd({}, send);
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ content: '' }));
  });

  it('reports isError only when raw.isError is exactly true', () => {
    const send = vi.fn();
    handleToolExecutionEnd({ isError: true }, send);
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ isError: true }));
    send.mockClear();
    handleToolExecutionEnd({ isError: 'true' }, send);
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ isError: false }));
  });
});

describe('handleExtensionError', () => {
  it('uses raw.error when it is a non-empty string', () => {
    const send = vi.fn();
    const raw = { error: 'boom' };
    handleExtensionError(raw, send);
    expect(send).toHaveBeenCalledWith('agent', { type: 'error', message: 'boom', raw });
  });

  it('falls back to a generic message when raw.error is absent or empty', () => {
    const send = vi.fn();
    handleExtensionError({}, send);
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ message: 'Extension error' }));
    send.mockClear();
    handleExtensionError({ error: '' }, send);
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ message: 'Extension error' }));
  });
});

describe('handleCompactionStart / handleAutoRetryStart', () => {
  it('emit compacting and retrying statuses respectively', () => {
    const send = vi.fn();
    handleCompactionStart({}, send);
    handleAutoRetryStart({}, send);
    expect(send).toHaveBeenNthCalledWith(1, 'agent', { type: 'status', label: 'compacting' });
    expect(send).toHaveBeenNthCalledWith(2, 'agent', { type: 'status', label: 'retrying' });
  });
});

describe('handleAutoRetryEnd', () => {
  it('sends nothing when success is not exactly false', () => {
    const send = vi.fn();
    expect(handleAutoRetryEnd({ success: true }, send)).toBeNull();
    expect(handleAutoRetryEnd({}, send)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('uses finalError when present', () => {
    const send = vi.fn();
    handleAutoRetryEnd({ success: false, finalError: 'gave up' }, send);
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ message: 'gave up' }));
  });

  it('falls back to a generic message when finalError is absent', () => {
    const send = vi.fn();
    handleAutoRetryEnd({ success: false }, send);
    expect(send).toHaveBeenCalledWith('agent', expect.objectContaining({ message: 'Auto-retry exhausted' }));
  });
});
