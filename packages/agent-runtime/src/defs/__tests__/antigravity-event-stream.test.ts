import { describe, expect, it } from 'vitest';

import { type AntigravityStreamState, handleAntigravityEvent } from '../antigravity/event-stream.js';

function harness() {
  const events: Array<Record<string, unknown>> = [];
  const state: AntigravityStreamState = { textEmitted: false, toolUses: new Set(), toolResults: new Set() };
  const feed = (frame: unknown): boolean => handleAntigravityEvent({ frame, emit: (e) => events.push(e), state });
  return { events, state, feed };
}
const tool = (extra: Record<string, unknown>) => ({
  event: 'step_update',
  step_update: { step_type: 'tool', conversation_id: 'c1', step_index: 2, ...extra },
});

describe('handleAntigravityEvent', () => {
  it('reports init as a status with the model and swallows the frame', () => {
    const h = harness();
    expect(h.feed({ event: 'init', init: { model: 'agy-1' } })).toBe(true);
    expect(h.events).toEqual([{ type: 'status', label: 'initializing', model: 'agy-1' }]);
    const bare = harness();
    expect(bare.feed({ event: 'init' })).toBe(true);
    expect(bare.events).toEqual([{ type: 'status', label: 'initializing', model: undefined }]);
  });

  it('declines frames it does not own, including non-objects and arrays', () => {
    const h = harness();
    for (const frame of [null, 'text', 42, [1, 2], {}, { event: 'other' }]) expect(h.feed(frame)).toBe(false);
    expect(h.events).toEqual([]);
  });

  it('streams agent_response text and ignores empty or non-string deltas', () => {
    const h = harness();
    const step = (text_delta: unknown) => ({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta } });
    expect(h.feed(step('hello'))).toBe(true);
    h.feed(step(''));
    h.feed(step(7));
    h.feed({ event: 'step_update', step_update: { step_type: 'unknown' } });
    expect(h.events).toEqual([{ type: 'text_delta', delta: 'hello' }]);
    expect(h.state.textEmitted).toBe(true);
  });

  it('maps native tools to the shared audit shape: ACTIVE with parameters, then DONE receipt', () => {
    const h = harness();
    h.feed(tool({ state: 'ACTIVE', tool_info: { name: 'run_command', parameters: { CommandLine: 'ls -la' } } }));
    h.feed(tool({ state: 'DONE', tool_info: { name: 'run_command', parameters: { CommandLine: 'ls -la' }, output: 'a\nb' } }));
    h.feed(tool({ state: 'DONE', tool_info: { name: 'run_command', parameters: { CommandLine: 'ls -la' }, output: 'again' } }));
    expect(h.events).toEqual([
      { type: 'tool_use', id: 'c1:2', name: 'Bash', input: { command: 'ls -la' } },
      { type: 'tool_result', toolUseId: 'c1:2', content: 'a\nb', isError: false },
    ]);
  });

  it.each([
    ['write_to_file', 'Write'],
    ['replace_file_content', 'Edit'],
    ['multi_replace_file_content', 'Edit'],
  ])('records only the path for %s, never contents', (name, mapped) => {
    const h = harness();
    h.feed(tool({ state: 'ACTIVE', tool_info: { name, parameters: { TargetFile: '/a.ts', CodeContent: 'SECRET' } } }));
    expect(h.events).toEqual([{ type: 'tool_use', id: 'c1:2', name: mapped, input: { file_path: '/a.ts' } }]);
  });

  it('passes an unknown tool through with its raw parameters, reading the name from tool_name as a fallback', () => {
    const h = harness();
    h.feed(tool({ state: 'ACTIVE', tool_name: 'search_web', tool_info: { parameters: { q: 'x' } } }));
    expect(h.events).toEqual([{ type: 'tool_use', id: 'c1:2', name: 'search_web', input: { q: 'x' } }]);
  });

  it('waits for a receipt when an ACTIVE frame has only a tool name, then audits a DONE-only receipt', () => {
    const h = harness();
    h.feed(tool({ state: 'ACTIVE', tool_name: 'run_command' }));
    expect(h.events).toEqual([]);
    h.feed(tool({ state: 'DONE', tool_name: 'run_command' }));
    expect(h.events).toEqual([
      { type: 'tool_use', id: 'c1:2', name: 'Bash', input: { command: undefined } },
      { type: 'tool_result', toolUseId: 'c1:2', content: '', isError: false },
    ]);
  });

  it('prefers the error message as content and flags the result as an error', () => {
    const h = harness();
    h.feed(tool({ state: 'DONE', tool_info: { name: 'run_command', parameters: {}, error: { message: 'exit 1' }, output: 'ignored' } }));
    expect(h.events[1]).toEqual({ type: 'tool_result', toolUseId: 'c1:2', content: 'exit 1', isError: true });
  });

  it('treats a null error as no error and a non-string output as empty content', () => {
    const h = harness();
    h.feed(tool({ state: 'DONE', tool_info: { name: 'x', parameters: {}, error: null, output: { not: 'a string' } } }));
    expect(h.events[1]).toEqual({ type: 'tool_result', toolUseId: 'c1:2', content: '', isError: false });
  });

  it('uses a non-message error object as a flag with the output as content', () => {
    const h = harness();
    h.feed(tool({ state: 'DONE', tool_info: { name: 'x', parameters: {}, error: { code: 3 }, output: 'partial' } }));
    expect(h.events[1]).toEqual({ type: 'tool_result', toolUseId: 'c1:2', content: 'partial', isError: true });
  });

  it.each([
    ['missing conversation id', { conversation_id: undefined }],
    ['non-numeric step index', { step_index: '2' }],
    ['no tool name anywhere', { tool_info: { parameters: {} } }],
    ['non-string tool name', { tool_info: { name: 5, parameters: {} } }],
  ])('ignores a tool frame with %s', (_label, patch) => {
    const h = harness();
    expect(h.feed(tool({ state: 'DONE', tool_name: undefined, tool_info: { name: 'x', parameters: {} }, ...patch }))).toBe(true);
    expect(h.events).toEqual([]);
  });

  describe('terminal result', () => {
    it('emits the response when nothing streamed, then usage with renamed token fields', () => {
      const h = harness();
      h.feed({ event: 'result', result: { status: 'SUCCESS', response: 'done', usage: { input_tokens: 3, output_tokens: 4, thinking_tokens: 5, cache_read_tokens: 6 } } });
      expect(h.events).toEqual([
        { type: 'text_delta', delta: 'done' },
        { type: 'usage', usage: { input_tokens: 3, output_tokens: 4, thought_tokens: 5, cached_read_tokens: 6 } },
      ]);
    });

    it('does not repeat text that already streamed', () => {
      const h = harness();
      h.feed({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'hi' } });
      h.feed({ event: 'result', result: { status: 'SUCCESS', response: 'hi' } });
      expect(h.events).toEqual([{ type: 'text_delta', delta: 'hi' }]);
    });

    it('surfaces a failure message, or a default one when the error is not a string', () => {
      const h = harness();
      h.feed({ event: 'result', result: { status: 'FAILED', error: 'quota exceeded' } });
      h.feed({ event: 'result', result: { status: 'FAILED', error: { code: 1 } } });
      h.feed({ event: 'result', result: {} });
      expect(h.events).toEqual([
        { type: 'error', message: 'quota exceeded' },
        { type: 'error', message: 'Antigravity did not complete the turn.' },
        { type: 'error', message: 'Antigravity did not complete the turn.' },
      ]);
    });

    it('tolerates a usage value that is not an object', () => {
      const h = harness();
      h.feed({ event: 'result', result: { status: 'SUCCESS', usage: 'n/a' } });
      expect(h.events).toEqual([{ type: 'usage', usage: { input_tokens: undefined, output_tokens: undefined, thought_tokens: undefined, cached_read_tokens: undefined } }]);
    });
  });
});
