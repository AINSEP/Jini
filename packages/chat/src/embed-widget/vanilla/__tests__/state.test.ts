import { describe, it, expect } from 'vitest';
import type { RunHandlers, ChatTransport } from '../../../core/transport.js';
import type { ChatMessage } from '../../../core/messages.js';
import type { AgentEvent } from '../../../core/events.js';
import { createVanillaChatController } from '../state.js';

function fixture(initialMessages: ChatMessage[] = []) {
  let handlers: RunHandlers | null = null;
  const writes: string[] = [];
  const persisted: Array<{ open: boolean; messages: ChatMessage[] }> = [];
  const requests: Parameters<ChatTransport['startRun']>[0][] = [];
  let serial = 0;
  const transport: ChatTransport = {
    async startRun(input, callbacks) { handlers = callbacks; requests.push(input); return { runId: 'run' }; },
    async reattachRun() {}, async fetchRunStatus() { return null; }, async stopRun() {},
  };
  const controller = createVanillaChatController({ transport, agentId: 'visitor', directiveEventName: 'client_directive',
    ids: () => String(++serial), createAbortController: () => new AbortController(), onChange: () => {},
    session: { load: () => ({ open: true, messages: initialMessages }), save: ({ state }) => { persisted.push(structuredClone(state)); writes.push('save'); },
      clear: () => { writes.push('clear'); }, enqueue: () => { writes.push('enqueue'); }, drain: () => null },
    pageActions: { allows: ({ action }) => action.target.path.startsWith('/') && !action.target.path.startsWith('//'),
      navigate: () => { writes.push('navigate'); return true; }, execute: ({ action }) => { writes.push(action.type); return true; }, clearHighlight: () => {} },
  });
  return { controller, writes, persisted, requests, callbacks: () => handlers! };
}
const directive = (type: 'navigate' | 'highlight' | 'scroll_to', auto = false, path = '/about'): AgentEvent => ({
  kind: 'ext', name: 'client_directive', data: { kind: 'page_action', action: { type, auto, target: { slug: 'about', title: 'About', path } } },
});
describe('vanilla visitor state', () => {
  it('sends bounded-host history, streams text, persists status and rejects concurrent/empty sends', async () => {
    const f = fixture([{ id: 'old', role: 'assistant', content: 'Welcome' }]);
    expect(await f.controller.send({ text: '  ' })).toBe(false);
    expect(await f.controller.send({ text: '  hello  ' })).toBe(true);
    expect(await f.controller.send({ text: 'duplicate' })).toBe(false);
    expect(f.requests[0]!.history.map(m => m.content)).toEqual(['Welcome', 'hello']);
    f.callbacks().onEvent({ kind: 'text', text: 'Hi ' });
    f.callbacks().onEvent({ kind: 'text', text: 'there' });
    expect(f.controller.getState({}).messages.at(-1)!.content).toBe('Hi there');
    expect(f.persisted).toEqual([]);
    f.callbacks().onDone([{ kind: 'text', text: 'Hi there' }]);
    expect(f.controller.getState({})).toMatchObject({ busy: false, error: null });
    expect(f.controller.getState({}).messages.at(-1)!.runStatus).toBe('succeeded');
    expect(f.persisted).toEqual([{ open: true, messages: f.controller.getState({}).messages }]);
  });
  it('does not replay restored navigation, and flushes queued treatment before live auto navigation exactly once', async () => {
    const f = fixture([{ id: 'restored', role: 'assistant', content: 'Done', runStatus: 'succeeded', events: [directive('navigate', true)] }]);
    expect(f.writes).toEqual([]);
    await f.controller.send({ text: 'Take me there' });
    f.callbacks().onEvent(directive('navigate', true));
    expect(f.writes).not.toContain('navigate');
    f.callbacks().onDone([directive('navigate', true), directive('highlight')]);
    expect(f.writes.slice(-3)).toEqual(['enqueue', 'save', 'navigate']);
    f.callbacks().onDone([directive('navigate', true)]);
    expect(f.writes.filter(w => w === 'navigate')).toHaveLength(1);
  });
  it('proposes navigation until consent and rejects unsafe targets', async () => {
    const f = fixture();
    await f.controller.send({ text: 'About?' });
    f.callbacks().onDone([directive('navigate'), directive('scroll_to')]);
    expect(f.writes).not.toContain('navigate');
    expect(f.controller.getState({}).proposal!.navigate.target.title).toBe('About');
    f.controller.acceptProposal({});
    expect(f.writes.slice(-3)).toEqual(['enqueue', 'save', 'navigate']);
    await f.controller.send({ text: 'More?' });
    f.callbacks().onDone([directive('navigate', true, '//evil.example')]);
    expect(f.writes.filter(w => w === 'navigate')).toHaveLength(1);
  });
  for (const type of ['highlight', 'scroll_to'] as const) it(`executes a standalone ${type} on the current page`, async () => {
    const f = fixture();
    await f.controller.send({ text: 'Show it' });
    f.callbacks().onDone([directive(type)]);
    expect(f.writes.at(-1)).toBe(type);
  });
  it('surfaces errors and never acts on a failed reply', async () => {
    const f = fixture();
    await f.controller.send({ text: 'hello' });
    f.callbacks().onError(new Error('Rate limited'));
    f.callbacks().onDone([directive('navigate', true)]);
    expect(f.controller.getState({})).toMatchObject({ busy: false, error: 'Rate limited', proposal: null });
    expect(f.controller.getState({}).messages.at(-1)!.runStatus).toBe('failed');
    expect(f.writes).not.toContain('navigate');
  });
  it('settles a rejected start and remains usable for the next turn', async () => {
    let attempt = 0;
    const states: string[] = [];
    const controller = createVanillaChatController({ agentId: 'visitor', directiveEventName: 'client_directive',
      ids: () => String(++attempt), createAbortController: () => new AbortController(), onChange: ({ state }) => { states.push(String(state.busy)); },
      session: { load: () => ({ open: true, messages: [] }), save: () => {}, clear: () => {}, enqueue: () => {}, drain: () => null },
      pageActions: { allows: () => true, navigate: () => true, execute: () => true, clearHighlight: () => {} },
      transport: { async startRun() { throw new Error('Offline'); }, async reattachRun() {}, async fetchRunStatus() { return null; }, async stopRun() {} },
    });
    await controller.send({ text: 'hello' });
    expect(controller.getState({})).toMatchObject({ busy: false, error: 'Offline' });
    expect(controller.getState({}).messages.at(-1)!.runStatus).toBe('failed');
    expect(await controller.send({ text: 'retry' })).toBe(true);
    expect(states.at(-1)).toBe('false');
  });
  it('cancellation prevents late directives from navigating', async () => {
    const f = fixture();
    await f.controller.send({ text: 'hello' });
    f.controller.cancel({});
    expect(f.requests[0]!.signal.aborted).toBe(true);
    f.callbacks().onDone([directive('navigate', true)]);
    expect(f.controller.getState({}).messages.at(-1)!.runStatus).toBe('canceled');
    expect(f.writes).not.toContain('navigate');
    f.controller.dispose({});
  });
  it('reset aborts and invalidates late chunks/directives; open state survives', async () => {
    const f = fixture();
    await f.controller.send({ text: 'hello' });
    const late = f.callbacks();
    f.controller.reset({});
    expect(f.requests[0]!.signal.aborted).toBe(true);
    late.onEvent({ kind: 'text', text: 'late' });
    late.onDone([directive('navigate', true)]);
    expect(f.controller.getState({})).toEqual({ open: true, messages: [], busy: false, error: null, proposal: null });
    expect(f.writes).not.toContain('navigate');
    f.controller.setOpen({ open: false });
    expect(f.controller.getState({}).open).toBe(false);
    expect(f.writes.at(-1)).toBe('save');
  });
});
