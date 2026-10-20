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
