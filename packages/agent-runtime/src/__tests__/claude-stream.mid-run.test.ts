import { describe, expect, it } from 'vitest';
import { createClaudeStreamHandler, type ClaudeStreamEvent } from '../claude-stream.js';

/** mri: stream usage survives a zeroed abort result; tool identity survives repeated wrappers. */
describe('Claude interrupted segments', () => {
  function harness() {
    const events: ClaudeStreamEvent[] = [];
    let time = 0;
    const handler = createClaudeStreamHandler({ onEvent: event => events.push(event) }, { nowMs: () => time });
    return { events, handler, at: (value: number) => { time = value; },
      feed: (obj: unknown) => handler.feed({ chunk: `${JSON.stringify(obj)}\n` }) };
  }

  it('uses per-message stream totals once, then resets for the next segment', () => {
    const h = harness();
    h.feed({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1', usage: { input_tokens: 100, output_tokens: 0 } } } });
    h.feed({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 200 }, delta: { stop_reason: null } } });
    h.feed({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 995 }, delta: { stop_reason: 'end_turn' } } });
    // Full assistant echoes and repeated cumulative deltas must not bill the message twice.
    h.feed({ type: 'assistant', message: { id: 'm1', content: [], usage: { input_tokens: 100, output_tokens: 995 } } });
    h.at(13_000);
    h.feed({ type: 'result', terminal_reason: 'aborted_streaming', usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0,
      modelUsage: { model: { costUSD: 0.03 } }, duration_ms: 0 });
    h.feed({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm2', usage: { input_tokens: 10 } } } });
    h.at(14_000);
    h.feed({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.0198, duration_ms: 1_000 });
    expect(h.events.filter(event => event.type === 'usage')).toEqual([
      { type: 'usage', usage: { input_tokens: 100, output_tokens: 995 }, costUsd: 0.03, durationMs: 13_000, stopReason: 'aborted_streaming' },
      { type: 'usage', usage: { input_tokens: 10, output_tokens: 5 }, costUsd: 0.0198, durationMs: 1_000, stopReason: 'end_turn' },
    ]);
  });

  it('sums distinct messages and keeps authoritative result totals without double counting', () => {
    const h = harness();
    for (const id of ['m1', 'm2']) {
      h.feed({ type: 'assistant', message: { id, content: [], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7 } } });
    }
    h.feed({ type: 'result', usage: { input_tokens: 30, output_tokens: 10, cache_read_input_tokens: 14 }, duration_ms: 100, total_cost_usd: 0.02 });
    expect(h.events.filter(event => event.type === 'usage')).toEqual([
      { type: 'usage', usage: { input_tokens: 30, output_tokens: 10, cache_read_input_tokens: 14 }, durationMs: 100, costUsd: 0.02, stopReason: null },
    ]);
  });

  it('flushes observed usage when hard cancellation produces no result at all', () => {
    const h = harness();
    h.feed({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1', usage: { input_tokens: 10 } } } });
    h.feed({ type: 'stream_event', event: { type: 'message_delta', delta: {}, usage: { output_tokens: 50 } } });
    h.at(2_000);
    h.handler.flush();
    h.handler.flush();
    expect(h.events.filter(event => event.type === 'usage')).toEqual([
      { type: 'usage', usage: { input_tokens: 10, output_tokens: 50 }, costUsd: null, durationMs: 2_000, stopReason: null },
    ]);
  });

  it('emits a full assistant tool call once across repeated wrappers and later partial echoes', () => {
    const h = harness();
    const block = { type: 'tool_use', id: 't1', name: 'web_screenshot_page', input: {} };
    for (let i = 0; i < 2; i++) h.feed({ type: 'assistant', message: { id: 'm1', content: [block], stop_reason: 'tool_use' } });
    h.feed({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: block } });
    h.feed({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
    h.feed({ type: 'assistant', message: { id: 'm2', content: [{ ...block, id: 't2' }], stop_reason: 'tool_use' } });
    expect(h.events.filter(event => event.type === 'tool_use')).toEqual([
      { type: 'tool_use', id: 't1', name: 'web_screenshot_page', input: {} },
      { type: 'tool_use', id: 't2', name: 'web_screenshot_page', input: {} },
    ]);
  });
});
