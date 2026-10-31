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
  const controller = createVanillaChatController({ transport, agentId: 'visitor',
    ids: () => String(++serial), createAbortController: () => new AbortController(), onChange: () => {},
    session: { load: () => ({ open: true, messages: initialMessages }), save: ({ state }) => { persisted.push(structuredClone(state)); writes.push('save'); },
      clear: () => { writes.push('clear'); },},
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
  it('surfaces errors and never acts on a failed reply', async () => {
    const f = fixture();
    await f.controller.send({ text: 'hello' });
    f.callbacks().onError(new Error('Rate limited'));
    f.callbacks().onDone([directive('navigate', true)]);
    expect(f.controller.getState({})).toMatchObject({ busy: false, error: 'Rate limited' });
    expect(f.controller.getState({}).messages.at(-1)!.runStatus).toBe('failed');
    expect(f.writes).not.toContain('navigate');
  });
  it('settles a rejected start and remains usable for the next turn', async () => {
    let attempt = 0;
    const states: string[] = [];
    const controller = createVanillaChatController({ agentId: 'visitor',
      ids: () => String(++attempt), createAbortController: () => new AbortController(), onChange: ({ state }) => { states.push(String(state.busy)); },
      session: { load: () => ({ open: true, messages: [] }), save: () => {}, clear: () => {},},
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
    expect(f.controller.getState({})).toEqual({ open: true, messages: [], busy: false, error: null });
    expect(f.writes).not.toContain('navigate');
    f.controller.setOpen({ open: false });
    expect(f.controller.getState({}).open).toBe(false);
    expect(f.writes.at(-1)).toBe('save');
  });
});
