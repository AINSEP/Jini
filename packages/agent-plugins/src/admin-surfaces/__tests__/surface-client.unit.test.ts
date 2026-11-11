/**
 * @file Unit tests for the surface-side client paths the security suite leaves out: a call made
 * before the host's init waits for it, malformed messages and failure shapes are ignored, the
 * bootstrap envelope is read only while current, a silent host times out, and `ready` settles on init.
 * The parent window and message listener are typed fakes; timers are vitest's fake timers.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AdminSurfaceCallError, createAdminSurfaceClient, type AdminSurfaceIncomingMessage, type AdminSurfaceParentPort } from '../surface-client.js';

const HOST = 'https://host.example.com';
const BASE = { protocol: 'jini.admin-surface', version: 1 } as const;

afterEach(() => { vi.useRealTimers(); });

function harness(optional: { nowMs?: () => number; timeoutMs?: number } = {}) {
  const posted: Array<{ message: unknown; targetOrigin: string }> = [];
  const parent: AdminSurfaceParentPort = { postMessage: (message, targetOrigin) => { posted.push({ message, targetOrigin }); } };
  let deliver: (event: AdminSurfaceIncomingMessage) => void = () => undefined;
  const client = createAdminSurfaceClient({ parent, listen: (handler) => { deliver = handler; return () => { deliver = () => undefined; }; } }, optional);
  const send = (data: unknown) => deliver({ origin: HOST, source: parent, data });
  const init = (data: Record<string, unknown> = {}) => send({ ...BASE, kind: 'init', mountId: 'm-1', ...data });
  const respond = (data: Record<string, unknown>) => send({ ...BASE, kind: 'action-response', mountId: 'm-1', requestId: 'r1', ...data });
  return { posted, client, send, init, respond };
}

describe('before init', () => {
  test('a call made before init is posted once init arrives', async () => {
    const { posted, client, init, respond } = harness();
    const pending = client.call({ action: 'save', payload: { a: 1 } });
    await Promise.resolve();
    expect(posted).toEqual([]);
    init();
    await client.ready;
    await Promise.resolve();
    expect(posted).toEqual([{ message: { ...BASE, kind: 'action-request', mountId: 'm-1', requestId: 'r1', action: 'save', payload: { a: 1 } }, targetOrigin: HOST }]);
    respond({ ok: true, result: 'saved' });
    await expect(pending).resolves.toBe('saved');
  });

  test('ready resolves on the first init', async () => {
    const { client, init } = harness();
    init();
    await expect(client.ready).resolves.toBeUndefined();
  });

  test('an init without a string mountId is ignored', async () => {
    const { client, init, posted } = harness();
    init({ mountId: 7 });
    init();
    const opened = client.openLink({ url: 'https://docs.example.com/a' });
    await client.ready;
    await Promise.resolve();
    expect(posted[0]).toMatchObject({ message: { kind: 'open-link', mountId: 'm-1', url: 'https://docs.example.com/a' } });
    client.close();
    await expect(opened).rejects.toMatchObject({ code: 'closed' });
  });

  test.each([[null], ['init'], [42]])('a non-object message %j is ignored', async (data) => {
    const { client, send, init, respond } = harness();
    send(data);
    init();
    const pending = client.call({ action: 'save', payload: {} });
    await client.ready;
    await Promise.resolve();
    respond({ ok: true, result: 'ok' });
    await expect(pending).resolves.toBe('ok');
  });
});

describe('responses', () => {
  test.each([
    ['a string error', { ok: false, error: 'denied' }],
    ['a null error', { ok: false, error: null }],
    ['an error missing retryable', { ok: false, error: { code: 'denied', message: 'No.' } }],
    ['ok without a result', { ok: true }],
    ['a non-boolean ok', { ok: 'yes', result: 1 }],
  ])('%s does not settle the call', async (_label, data) => {
    const { client, init, respond } = harness();
    init();
    const pending = client.call({ action: 'save', payload: {} });
    await Promise.resolve();
    respond(data);
    client.close();
    await expect(pending).rejects.toMatchObject({ code: 'closed', message: 'The surface was closed before the host answered.', retryable: false });
  });

  test('a well-formed failure rejects with a typed call error', async () => {
    const { client, init, respond } = harness();
    init();
    const pending = client.call({ action: 'save', payload: {} });
    await Promise.resolve();
    respond({ ok: false, error: { code: 'invalid-input', message: 'Fix the name.', retryable: false } });
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdminSurfaceCallError);
    expect(error).toMatchObject({ name: 'AdminSurfaceCallError', code: 'invalid-input', message: 'Fix the name.', retryable: false });
  });

  test('a silent host times out as retryable after the configured time', async () => {
    vi.useFakeTimers();
    const { client, init } = harness({ timeoutMs: 500 });
    init();
    const pending = client.call({ action: 'save', payload: {} });
    const settled = pending.catch((caught: unknown) => caught);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(499);
    await vi.advanceTimersByTimeAsync(1);
    await expect(settled).resolves.toMatchObject({ code: 'timeout', message: 'The host did not answer in time. Try again.', retryable: true });
  });

  test('a response after the timeout is ignored', async () => {
    vi.useFakeTimers();
    const { client, init, respond } = harness({ timeoutMs: 500 });
    init();
    const settled = client.call({ action: 'save', payload: {} }).then((value) => ({ value }), (error: unknown) => ({ error }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    respond({ ok: true, result: 'late' });
    await expect(settled).resolves.toMatchObject({ error: { code: 'timeout' } });
  });

  test('defaults to a 30-second timeout', async () => {
    vi.useFakeTimers();
    const { client, init } = harness();
    init();
    const settled = client.call({ action: 'save', payload: {} }).catch((caught: unknown) => caught);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(29_999);
    let done = false;
    void settled.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(settled).resolves.toMatchObject({ code: 'timeout' });
  });
});

describe('bootstrap', () => {
  test('returns the data while the envelope is current', () => {
    const { client, init } = harness({ nowMs: () => 1_000 });
    init({ bootstrap: { expiresAt: 1_001, data: { sheet: 'A' } } });
    expect(client.bootstrap()).toEqual({ sheet: 'A' });
  });

  test('returns undefined once the envelope has expired', () => {
    const { client, init } = harness({ nowMs: () => 1_001 });
    init({ bootstrap: { expiresAt: 1_001, data: { sheet: 'A' } } });
    expect(client.bootstrap()).toBeUndefined();
  });

  test.each([['a string envelope', 'data'], ['a null envelope', null], ['an envelope without a numeric expiry', { expiresAt: '9', data: 1 }]])('returns undefined for %s', (_label, bootstrap) => {
    const { client, init } = harness({ nowMs: () => 0 });
    init({ bootstrap });
    expect(client.bootstrap()).toBeUndefined();
  });

  test('returns undefined before init', () => {
    expect(harness().client.bootstrap()).toBeUndefined();
  });

  test('reads the real clock by default', () => {
    const { client, init } = harness();
    init({ bootstrap: { expiresAt: Date.now() + 60_000, data: 'fresh' } });
    expect(client.bootstrap()).toBe('fresh');
  });
});

describe('browser-backed defaults (injected scope, no DOM)', () => {
  function fakeBrowser(optional: { withStyle?: boolean } = {}) {
    const observers: Array<{ kind: string; callback: () => void; observed: unknown[]; disconnected: boolean }> = [];
    const observer = (kind: string) => class {
      readonly entry: (typeof observers)[number];
      constructor(callback: () => void) { this.entry = { kind, callback, observed: [], disconnected: false }; observers.push(this.entry); }
      observe(_target: unknown, options?: Readonly<Record<string, boolean>>) { this.entry.observed.push(options ?? 'no-options'); }
      disconnect() { this.entry.disconnected = true; }
    };
    const listeners = new Map<string, () => void>();
    const body = {
      scrollHeight: 100, boxHeight: 100.4, margins: { marginTop: '8px', marginBottom: '' },
      getBoundingClientRect() { return { height: body.boxHeight }; },
      addEventListener(type: 'mouseover' | 'focusin', listener: () => void) { listeners.set(type, listener); },
      removeEventListener(type: 'mouseover' | 'focusin', listener: () => void) { if (listeners.get(type) === listener) listeners.delete(type); },
    };
    const styles: string[] = [];
    const root = { style: { setProperty: (name: string, value: string) => { styles.push(`${name}=${value}`); }, removeProperty: () => undefined }, setAttribute: (name: string, value: string) => { styles.push(`@${name}=${value}`); } };
    const browser = {
      document: { documentElement: root, body },
      ResizeObserver: observer('resize'), MutationObserver: observer('mutation'),
      ...(optional.withStyle === false ? {} : { getComputedStyle: () => body.margins }),
    };
    return { browser, body, listeners, observers, styles };
  }
  function start(browser: object) {
    const posted: unknown[] = [];
    let deliver: (event: AdminSurfaceIncomingMessage) => void = () => undefined;
    const parent: AdminSurfaceParentPort = { postMessage: (message) => { posted.push(message); } };
    const client = createAdminSurfaceClient({ parent, listen: (handler) => { deliver = handler; return () => undefined; } }, { browser });
    deliver({ origin: HOST, source: parent, data: { ...BASE, kind: 'init', mountId: 'm-1', theme: { scheme: 'dark', tokens: { '--jini-primary': '#000' } } } });
    return { client, heights: () => posted.map(message => (message as { height?: number }).height).filter(height => height !== undefined) };
  }

  test('measures the body (box height fraction and margins) on start, observers, hover and focus, and stops cleanly', () => {
    const fake = fakeBrowser();
    const { client, heights } = start(fake.browser);
    expect(heights()).toEqual([109]);
    expect(fake.observers.map(entry => [entry.kind, entry.observed])).toEqual([
      ['resize', ['no-options']], ['mutation', [{ subtree: true, childList: true, attributes: true, characterData: true }]],
    ]);
    fake.body.scrollHeight = 150;
    fake.body.margins = { marginTop: '', marginBottom: '2px' };
    fake.observers[0]!.callback();
    fake.body.scrollHeight = 160;
    fake.listeners.get('mouseover')!();
    fake.body.scrollHeight = 170;
    fake.listeners.get('focusin')!();
    expect(heights()).toEqual([109, 152, 162, 172]);
    client.close();
    expect(fake.observers.every(entry => entry.disconnected)).toBe(true);
    expect([...fake.listeners.keys()]).toEqual([]);
  });
  test('applies the init theme to the document root', () => {
    const fake = fakeBrowser();
    start(fake.browser);
    expect(fake.styles).toEqual(['--jini-primary=#000', 'color-scheme=dark', '@data-jini-scheme=dark']);
  });
  test('reports no height without a computed-style source, a body, or observers', () => {
    for (const browser of [fakeBrowser({ withStyle: false }).browser, { document: {} }, { document: { body: fakeBrowser().body } }, { document: { body: fakeBrowser().body }, ResizeObserver: fakeBrowser().browser.ResizeObserver }]) {
      expect(start(browser).heights()).toEqual([]);
    }
  });
  test('each missing browser piece alone (body, either observer, computed style) disables measuring', () => {
    const { browser } = fakeBrowser();
    const without = (key: 'ResizeObserver' | 'MutationObserver' | 'getComputedStyle') => { const copy: Record<string, unknown> = { ...browser }; delete copy[key]; return copy; };
    for (const partial of [without('ResizeObserver'), without('MutationObserver'), without('getComputedStyle'), { ...browser, document: { documentElement: browser.document.documentElement, body: null } }]) {
      expect(start(partial).heights()).toEqual([]);
    }
    expect(start(browser).heights()).toEqual([109]);
  });
});
