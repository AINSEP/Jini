import { describe, expect, it } from 'vitest';
import { resolveAgUiMessages, resolveAgUiRunInput, type AgUiRunBody } from '../run-input.js';

function ids() {
  let n = 0;
  return { newId: () => `id-${++n}` };
}
const parse = (body: AgUiRunBody, maxHistoryMessages = 40) => resolveAgUiRunInput({ body, maxHistoryMessages, ids: ids() });
const user = (content: string) => ({ role: 'user', content });

describe('resolveAgUiMessages', () => {
  it('keeps only non-empty user/assistant string turns; a non-array is empty', () => {
    const raw = [null, 3, { role: 'tool', content: 'x' }, { role: 'assistant', content: '' }, { role: 'user', content: ['x'] }, user('hi')];
    expect(resolveAgUiMessages({ raw, maxHistoryMessages: 40 })).toEqual([{ role: 'user', content: 'hi' }]);
    expect(resolveAgUiMessages({ raw: 'hi', maxHistoryMessages: 40 })).toEqual([]);
  });

  it('keeps the trailing messages when the history is over the host bound, and all of them at the bound', () => {
    const raw = ['a', 'b', 'c'].map(user);
    expect(resolveAgUiMessages({ raw, maxHistoryMessages: 2 }).map(m => m.content)).toEqual(['b', 'c']);
    expect(resolveAgUiMessages({ raw, maxHistoryMessages: 3 }).map(m => m.content)).toEqual(['a', 'b', 'c']);
  });
});

describe('resolveAgUiRunInput', () => {
  it('refuses a body with no messages, a non-array, or a history that does not end in a user turn', () => {
    expect(parse({})).toBeNull();
    expect(parse({ messages: 'hi' })).toBeNull();
    expect(parse({ messages: [user('hi'), { role: 'assistant', content: 'hello' }] })).toBeNull();
    expect(parse({ messages: [{ role: 'user', content: '' }] })).toBeNull();
  });

  it('echoes caller ids and mints only the request id', () => {
    expect(parse({ threadId: 't1', runId: 'r1', messages: [user('hi')] })).toEqual({
      threadId: 't1', runId: 'r1', requestId: 'id-1', agentId: undefined, frontendBindToken: undefined, frontendTabId: undefined,
      secretRedacted: false, messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('mints an absent, empty or non-string thread and run id, in the order thread, run, request', () => {
    for (const body of [{}, { threadId: '', runId: '' }, { threadId: 7, runId: null }]) {
      expect(parse({ ...body, messages: [user('hi')] })).toMatchObject({ threadId: 'id-1', runId: 'id-2', requestId: 'id-3' });
    }
  });

  it('reads the agent id, the tab binding and the redaction flag from forwardedProps only', () => {
    const parsed = parse({ messages: [user('hi')], forwardedProps: { agentId: 'writer', frontendBindToken: 'b'.repeat(256), frontendTabId: 'tab-1', secretRedacted: true, surfaceId: 'ignored' } });
    expect(parsed).toMatchObject({ agentId: 'writer', frontendBindToken: 'b'.repeat(256), frontendTabId: 'tab-1', secretRedacted: true });
    expect(Object.keys(parsed!)).not.toContain('surfaceId');
  });

  it('drops a malformed, empty or oversized forwarded field instead of refusing the run', () => {
    const forwardedProps = { agentId: '', frontendBindToken: 'b'.repeat(257), frontendTabId: 12, secretRedacted: 'true' };
    expect(parse({ messages: [user('hi')], forwardedProps })).toMatchObject({ agentId: undefined, frontendBindToken: undefined, frontendTabId: undefined, secretRedacted: false });
    for (const bad of [null, 'props', 4]) {
      expect(parse({ messages: [user('hi')], forwardedProps: bad })).toMatchObject({ agentId: undefined, secretRedacted: false });
    }
  });
});
