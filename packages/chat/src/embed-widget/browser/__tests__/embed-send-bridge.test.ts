import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmbedSendAgentControl, installEmbedSendBridge } from '../embed-send-bridge.js';

const NAMES = { requestEventName: 'example-send', readyMessageType: 'example-ready' } as const;
const doms: JSDOM[] = [];
afterEach(() => { for (const dom of doms.splice(0)) dom.window.close(); });

function fixture() {
  const dom = new JSDOM('<div id="mount"></div>', { url: 'https://site.test/embed' });
  doms.push(dom);
  const root = dom.window.document.getElementById('mount')!;
  const request = (text: unknown, done: unknown = undefined) => root.dispatchEvent(new dom.window.CustomEvent(NAMES.requestEventName, { detail: { text, done } }));
  const send = (text: string) => new Promise<string | undefined>(resolve => { request(text, resolve); });
  return { dom, root, request, send };
}

describe('installEmbedSendBridge', () => {
  it('disabled installs no listener and returns a no-op disposer', async () => {
    const f = fixture();
    let calls = 0;
    const dispose = installEmbedSendBridge({ root: f.root, enabled: false, ...NAMES, send: async () => { calls++; } });
    f.request('hello', () => { throw new Error('listener installed'); });
    await Promise.resolve();
    expect(calls).toBe(0);
    expect(f.root.dataset.compareReady).toBeUndefined();
    expect(() => dispose()).not.toThrow();
  });

  it('opens the widget, marks it ready and signals the parent once enabled', async () => {
    const f = fixture();
    const messages: unknown[] = [];
    f.dom.window.addEventListener('message', event => { messages.push(event.data); });
    let opened = 0;
    f.root.addEventListener('jini-chat-open', () => { opened++; });
    const texts: string[] = [];
    const dispose = installEmbedSendBridge({ root: f.root, enabled: true, ...NAMES, send: async ({ text }) => { texts.push(text); } });
    expect(f.root.dataset.compareReady).toBe('true');
    expect(await f.send('**exact prompt**')).toBeUndefined();
    expect(texts).toEqual(['**exact prompt**']);
    expect(opened).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(messages).toEqual([{ type: 'example-ready' }]);
    dispose();
  });

  it('a second request while one is in flight is refused with the busy sentence', async () => {
    const f = fixture();
    let complete!: () => void;
    const texts: string[] = [];
    const dispose = installEmbedSendBridge({ root: f.root, enabled: true, ...NAMES, send: ({ text }) => {
      texts.push(text); return new Promise<void>(resolve => { complete = resolve; });
    } });
    const first = f.send('first');
    await Promise.resolve();
    expect(await f.send('duplicate')).toBe('This pane is already replying.');
    expect(texts).toEqual(['first']);
    complete();
    expect(await first).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 0));
    const after = f.send('after');
    await Promise.resolve();
    complete();
    expect(await after).toBeUndefined();
    expect(texts).toEqual(['first', 'after']);
    dispose();
  });

  it('uses the host busy sentence when one is injected', async () => {
    const f = fixture();
    const dispose = installEmbedSendBridge({ root: f.root, enabled: true, ...NAMES, send: () => new Promise<void>(() => {}) }, { busyMessage: 'Busy.' });
    void f.send('first');
    await Promise.resolve();
    expect(await f.send('second')).toBe('Busy.');
    dispose();
  });

  it('malformed requests are ignored', async () => {
    const f = fixture();
    let calls = 0;
    const dispose = installEmbedSendBridge({ root: f.root, enabled: true, ...NAMES, send: async () => { calls++; } });
    f.root.dispatchEvent(new f.dom.window.CustomEvent(NAMES.requestEventName, { detail: null }));
    f.request(42, () => {});
    f.request('no callback', 'nope');
    await Promise.resolve();
    expect(calls).toBe(0);
    dispose();
  });

  it('a non-Error failure is reported as text, an Error by its message', async () => {
    const f = fixture();
    let dispose = installEmbedSendBridge({ root: f.root, enabled: true, ...NAMES, send: async () => { throw 'quota exhausted'; } });
    expect(await f.send('go')).toBe('quota exhausted');
    dispose();
    dispose = installEmbedSendBridge({ root: f.root, enabled: true, ...NAMES, send: async () => { throw new Error('Provider is unavailable.'); } });
    expect(await f.send('retry')).toBe('Provider is unavailable.');
    dispose();
  });

  it('the disposer removes the listener and the ready flag', async () => {
    const f = fixture();
    const dispose = installEmbedSendBridge({ root: f.root, enabled: true, ...NAMES, send: async () => {} });
    dispose();
    expect(f.root.dataset.compareReady).toBeUndefined();
    expect(() => f.request('removed', () => { throw new Error('listener leaked'); })).not.toThrow();
  });
});

describe('createEmbedSendAgentControl', () => {
  const control = (root: HTMLElement | null, enabled = true, optional = {}) =>
    createEmbedSendAgentControl({ root, enabled, invocationId: 'example-invocation', ...NAMES }, optional);

  it('returns no control when disabled or without a root', () => {
    expect(control(null)).toBeUndefined();
    expect(control(fixture().root, false)).toBeUndefined();
  });

  it('relays the exact prompt through the chat.send_message capability', async () => {
    const f = fixture();
    const agentControl = control(f.root)!;
    expect(agentControl.enabled).toBe(true);
    const actions: unknown[] = [];
    const dispose = agentControl.bridgeAccess!.subscribe(action => {
      actions.push(action);
      void agentControl.bridgeAccess!.respondSuccess(action.invocationId, { sent: true });
    });
    expect(await f.send('Show me the posts')).toBeUndefined();
    expect(actions).toEqual([{ invocationId: 'example-invocation', capabilityId: 'chat.send_message', input: { prompt: 'Show me the posts' } }]);
    dispose();
    expect(f.root.dataset.compareReady).toBeUndefined();
  });

  it('relays capability errors and honours an injected capability id', async () => {
    const f = fixture();
    const agentControl = control(f.root, true, { capabilityId: 'chat.other' })!;
    const seen: string[] = [];
    const dispose = agentControl.bridgeAccess!.subscribe(action => {
      seen.push(action.capabilityId);
      void agentControl.bridgeAccess!.respondError(action.invocationId, 'The agent refused.');
    });
    expect(await f.send('first')).toBe('The agent refused.');
    expect(seen).toEqual(['chat.other']);
    dispose();
  });

  it('hands the host busy sentence to the bridge it installs, refusing an overlapping send with it', async () => {
    const f = fixture();
    const agentControl = control(f.root, true, { busyMessage: 'Still answering.' })!;
    const actions: unknown[] = [];
    const dispose = agentControl.bridgeAccess!.subscribe(action => { actions.push(action); });
    void f.send('first');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await f.send('second')).toBe('Still answering.');
    expect(actions).toEqual([{ invocationId: 'example-invocation', capabilityId: 'chat.send_message', input: { prompt: 'first' } }]);
    dispose();
  });

  it('unmounting rejects a send still in flight; late responses are no-ops', async () => {
    const f = fixture();
    const agentControl = control(f.root, true, { unmountedMessage: 'Pane went away.' })!;
    const dispose = agentControl.bridgeAccess!.subscribe(() => {});
    const pending = f.send('never answered');
    await new Promise(resolve => setTimeout(resolve, 0));
    dispose();
    expect(await pending).toBe('Pane went away.');
    await agentControl.bridgeAccess!.respondSuccess('example-invocation', {});
    await agentControl.bridgeAccess!.respondError('example-invocation', 'late');
  });
});
