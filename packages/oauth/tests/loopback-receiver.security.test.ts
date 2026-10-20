/**
 * @file Security pins for the installed-app loopback receiver: it binds 127.0.0.1 only, checks
 * state in constant time, accepts exactly one callback (a wrong-state request does not use it up,
 * up to a bound), bounds what it reads, returns only
 * declared callback fields, never reflects input into its close page, closes on every terminal
 * outcome, and lets stray requests (wrong path, wrong Host, wrong method) through without
 * consuming the single slot. Every listener a test opens is closed in `afterEach`.
 */
import { request } from 'node:http';
import { Server } from 'node:http';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>();
  return { ...real, timingSafeEqual: vi.fn(real.timingSafeEqual) };
});

import { timingSafeEqual } from 'node:crypto';
import { startLoopbackAuthorizationReceiver, type LoopbackAuthorizationReceiver, type LoopbackReceiverTimers } from '../src/loopback-receiver.js';

const STATE = 's'.repeat(32);
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });

interface Reply { readonly status: number; readonly headers: Record<string, string | string[] | undefined>; readonly body: string }

/** A raw request so tests control Host, method, header size and body exactly. */
function send(requiredArgs: { readonly url: string }, optionalArgs: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string } = {}): Promise<Reply> {
  const target = new URL(requiredArgs.url);
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port: Number(target.port), path: `${target.pathname}${target.search}`,
      method: optionalArgs.method ?? 'GET', headers: { host: target.host, ...optionalArgs.headers }, agent: false,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(optionalArgs.body);
  });
}

async function start(optionalArgs: Parameters<typeof startLoopbackAuthorizationReceiver>[1] = {}): Promise<LoopbackAuthorizationReceiver> {
  const controller = new AbortController();
  const receiver = await startLoopbackAuthorizationReceiver({}, { signal: optionalArgs.signal ?? controller.signal, ...optionalArgs });
  cleanups.push(() => controller.abort());
  return receiver;
}

function callbackUrl(receiver: LoopbackAuthorizationReceiver, query: Record<string, string>): string {
  return `${receiver.redirectUri}?${new URLSearchParams(query).toString()}`;
}

async function expectClosed(receiver: LoopbackAuthorizationReceiver): Promise<void> {
  await expect(send({ url: receiver.redirectUri })).rejects.toMatchObject({ code: 'ECONNREFUSED' });
}

describe('binding', () => {
  test('listens on 127.0.0.1 with an ephemeral port and returns that redirect URI', async () => {
    const listen = vi.spyOn(Server.prototype, 'listen');
    const receiver = await start();
    expect(listen).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: 0 }), expect.any(Function));
    expect(receiver.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*\/callback$/);
  });
});

describe('state and single use', () => {
  test('compares state in constant time and resolves the code on a match', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    vi.mocked(timingSafeEqual).mockClear();
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'one-time' }) });
    await expect(result).resolves.toEqual({ code: 'one-time', fields: {} });
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });

  test('a mismatched state does not consume the slot: the real callback still succeeds', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: callbackUrl(receiver, { state: `${STATE.slice(0, -1)}x`, code: 'forged' }) });
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'one-time' }) });
    await expect(result).resolves.toEqual({ code: 'one-time', fields: {} });
  });

  test('a wrong-state request is answered 400 with the static failure page', async () => {
    const receiver = await start();
    receiver.receive({ expectedState: STATE }).catch(() => undefined);
    const reply = await send({ url: callbackUrl(receiver, { state: 'forged', code: 'one-time' }) });
    expect([reply.status, reply.body.includes('<h1>Sign-in did not finish</h1>')]).toEqual([400, true]);
  });

  test('fifteen wrong-state requests leave the slot armed', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    for (let attempt = 0; attempt < 15; attempt += 1) await send({ url: callbackUrl(receiver, { state: `forged-${attempt}`, code: 'x' }) });
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'one-time' }) });
    await expect(result).resolves.toEqual({ code: 'one-time', fields: {} });
  });

  test('the sixteenth wrong-state request ends the sign-in as invalid state and closes the listener', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    for (let attempt = 0; attempt < 16; attempt += 1) await send({ url: callbackUrl(receiver, { state: `forged-${attempt}`, code: 'x' }) });
    await expect(result).rejects.toMatchObject({ code: 'OAUTH_INVALID_STATE' });
    await expectClosed(receiver);
  });

  test('a refused callback is answered 400 with the static failure page', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    const reply = await send({ url: callbackUrl(receiver, { state: STATE, error: 'access_denied' }) });
    await result.catch(() => undefined);
    expect(reply.status).toBe(400);
    expect(reply.body).toContain('<h1>Sign-in did not finish</h1>');
  });

  test('an accepted callback is answered 200 with the static completion page', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    const reply = await send({ url: callbackUrl(receiver, { state: STATE, code: 'one-time' }) });
    await result;
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('<h1>Sign-in complete</h1>');
  });

  test('after one successful callback the listener is closed', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'one-time' }) });
    await result;
    await expectClosed(receiver);
  });

  test('a provider error with the matching state is a typed denial, not a code', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: callbackUrl(receiver, { state: STATE, error: 'access_denied' }) });
    await expect(result).rejects.toMatchObject({ code: 'OAUTH_ACCESS_DENIED', providerErrorCode: 'access_denied' });
  });

  test('a provider error with a wrong state fails the state check first and does not end the sign-in', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    const forged = await send({ url: callbackUrl(receiver, { state: 'forged', error: 'access_denied' }) });
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'one-time' }) });
    expect([forged.status, await result]).toEqual([400, { code: 'one-time', fields: {} }]);
  });
});

describe('stray requests do not consume the slot', () => {
  test('a wrong path is 404 and the real callback still succeeds', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    const stray = await send({ url: `${new URL(receiver.redirectUri).origin}/favicon.ico?state=${STATE}&code=x` });
    expect(stray.status).toBe(404);
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'real' }) });
    await expect(result).resolves.toMatchObject({ code: 'real' });
  });

  test('a foreign Host header is refused without consuming (DNS rebinding)', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    const rebound = await send({ url: callbackUrl(receiver, { state: 'forged', code: 'x' }) }, { headers: { host: 'attacker.example:80' } });
    expect(rebound.status).toBe(400);
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'real' }) });
    await expect(result).resolves.toMatchObject({ code: 'real' });
  });

  test('a non-GET request is 405 without consuming', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    const posted = await send({ url: callbackUrl(receiver, { state: 'forged', code: 'x' }) }, { method: 'POST' });
    expect(posted.status).toBe(405);
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'real' }) });
    await expect(result).resolves.toMatchObject({ code: 'real' });
  });

  test('a GET carrying a body is refused unread, without consuming', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    const withBody = await send({ url: callbackUrl(receiver, { state: 'forged', code: 'x' }) }, { body: 'x'.repeat(64), headers: { 'content-length': '64' } });
    expect(withBody.status).toBe(400);
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'real' }) });
    await expect(result).resolves.toMatchObject({ code: 'real' });
  });

  test('oversized headers are refused by the parser without consuming', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    const huge = await send({ url: callbackUrl(receiver, { state: 'forged', code: 'x' }) }, { headers: { 'x-pad': 'p'.repeat(20_000) } });
    expect(huge.status).toBe(431);
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'real' }) });
    await expect(result).resolves.toMatchObject({ code: 'real' });
  });

  test('a callback before receive() is armed is 404 without consuming', async () => {
    const receiver = await start();
    const early = await send({ url: callbackUrl(receiver, { state: STATE, code: 'early' }) });
    expect(early.status).toBe(404);
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'real' }) });
    await expect(result).resolves.toMatchObject({ code: 'real' });
  });
});

describe('declared callback fields', () => {
  test('returns only declared fields that are present', async () => {
    const receiver = await start({ callbackFields: ['picked_ids', 'absent_field'] });
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'c', picked_ids: 'a,b', scope: 'x', smuggled: 'y' }) });
    await expect(result).resolves.toEqual({ code: 'c', fields: { picked_ids: 'a,b' } });
  });

  test('a declared field longer than 4096 characters is an invalid request', async () => {
    const receiver = await start({ callbackFields: ['picked_ids'] });
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'c', picked_ids: 'p'.repeat(4097) }) });
    await expect(result).rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST' });
  });

  test('a repeated parameter is an invalid request rather than a silent first-wins', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: `${receiver.redirectUri}?state=${STATE}&code=a&code=b` });
    await expect(result).rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST' });
  });

  test('declaring a protocol parameter as a callback field is refused at start', async () => {
    await expect(start({ callbackFields: ['state'] })).rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST' });
  });

  test('the exported name rule other seams reuse refuses exactly what start refuses', async () => {
    const { isCallbackFieldName } = await import('../src/index.js');
    expect(['picked_ids', '_picked', '9picked', 'state', 'iss'].map(isCallbackFieldName)).toEqual([true, false, false, false, false]);
    await expect(start({ callbackFields: ['_picked'] })).rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST' });
  });
  test('declaring more than 16 callback fields is refused at start', async () => {
    const many = Array.from({ length: 17 }, (_, index) => `field_${index}`);
    await expect(start({ callbackFields: many })).rejects.toMatchObject({ code: 'OAUTH_INVALID_REQUEST' });
  });
});

describe('close page', () => {
  test('never reflects callback input and forbids active content and caching', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    const marker = '<script>alert(1)</script>';
    const reply = await send({ url: callbackUrl(receiver, { state: STATE, error: marker, error_description: marker }) });
    await result.catch(() => undefined);
    expect(reply.body).not.toContain('alert(1)');
    expect(reply.body).not.toContain('script');
    expect(reply.headers['content-security-policy']).toBe("default-src 'none'");
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('closes on cancel and expiry', () => {
  test('aborting rejects as cancelled and closes the listener', async () => {
    const controller = new AbortController();
    const receiver = await start({ signal: controller.signal });
    const result = receiver.receive({ expectedState: STATE });
    controller.abort();
    await expect(result).rejects.toMatchObject({
      code: 'OAUTH_AUTHORIZATION_CANCELLED', message: 'the sign-in was cancelled before the browser returned', operatorAction: 'Start the connection again when you are ready.',
    });
    await expectClosed(receiver);
  });

  test('the default timer expires the attempt after the configured time', async () => {
    const receiver = await startLoopbackAuthorizationReceiver({}, { timeoutMs: 25 });
    await expect(receiver.receive({ expectedState: STATE })).rejects.toMatchObject({ code: 'OAUTH_AUTHORIZATION_EXPIRED' });
    await expectClosed(receiver);
  });

  test('finishing removes the abort listener from the caller signal', async () => {
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, 'addEventListener');
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const receiver = await start({ signal: controller.signal });
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'c' }) });
    await result;
    expect(removed).toHaveBeenCalledWith('abort', added.mock.calls[0]![1]);
  });

  test('an already-aborted signal refuses to start', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(start({ signal: controller.signal })).rejects.toMatchObject({ code: 'OAUTH_AUTHORIZATION_CANCELLED' });
  });

  test('the injected expiry timer rejects as expired and closes the listener', async () => {
    let fire: (() => void) | undefined;
    const timers: LoopbackReceiverTimers = { after: ({ run, ms }) => { expect(ms).toBe(1234); fire = run; return () => { fire = undefined; }; } };
    const receiver = await start({ timers, timeoutMs: 1234 });
    const result = receiver.receive({ expectedState: STATE });
    fire!();
    await expect(result).rejects.toMatchObject({
      code: 'OAUTH_AUTHORIZATION_EXPIRED', message: 'the sign-in window expired before the browser returned', operatorAction: 'Start the connection again and finish it in the browser.',
    });
    await expectClosed(receiver);
  });

  test('success cancels the expiry timer', async () => {
    let cancelled = false;
    const timers: LoopbackReceiverTimers = { after: () => () => { cancelled = true; } };
    const receiver = await start({ timers });
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'c' }) });
    await result;
    expect(cancelled).toBe(true);
  });
});

describe('arming refusals', () => {
  const armOnce = { code: 'OAUTH_INVALID_REQUEST', message: 'the loopback receiver must be armed once with a non-empty state' };

  test('a second receive() is refused and the first attempt still completes', async () => {
    const receiver = await start();
    const first = receiver.receive({ expectedState: STATE });
    await expect(receiver.receive({ expectedState: 'other-state' })).rejects.toMatchObject(armOnce);
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'real' }) });
    await expect(first).resolves.toMatchObject({ code: 'real' });
  });

  test('an empty state cannot arm the listener', async () => {
    const receiver = await start();
    await expect(receiver.receive({ expectedState: '' })).rejects.toMatchObject(armOnce);
    const early = await send({ url: callbackUrl(receiver, { state: '', code: 'x' }) });
    expect(early.status).toBe(404);
  });

  test('a state longer than the sealed-state bound cannot arm the listener', async () => {
    const receiver = await start();
    await expect(receiver.receive({ expectedState: 's'.repeat(4097) })).rejects.toMatchObject(armOnce);
  });
});

describe('timeout configuration', () => {
  const badTimeout = { code: 'OAUTH_INVALID_REQUEST', message: 'the loopback timeout must be a whole number of milliseconds up to one hour' };

  test.each([0, -1, 1.5, 60 * 60 * 1000 + 1])('refuses a timeout of %s before opening a port', async (timeoutMs) => {
    const listen = vi.spyOn(Server.prototype, 'listen');
    await expect(start({ timeoutMs })).rejects.toMatchObject(badTimeout);
    expect(listen).not.toHaveBeenCalled();
  });

  test('accepts the one-hour maximum', async () => {
    let seen: number | undefined;
    const timers: LoopbackReceiverTimers = { after: ({ ms }) => { seen = ms; return () => undefined; } };
    await start({ timers, timeoutMs: 60 * 60 * 1000 });
    expect(seen).toBe(60 * 60 * 1000);
  });

  test('defaults to a ten-minute expiry', async () => {
    let seen: number | undefined;
    const timers: LoopbackReceiverTimers = { after: ({ ms }) => { seen = ms; return () => undefined; } };
    await start({ timers });
    expect(seen).toBe(10 * 60 * 1000);
  });
});

describe('first terminal outcome wins', () => {
  test('an expiry that fires after the callback finished does not change the result', async () => {
    let fire: (() => void) | undefined;
    // This timer ignores cancellation so the late fire really reaches the receiver.
    let cancels = 0;
    const timers: LoopbackReceiverTimers = { after: ({ run }) => { fire = run; return () => { cancels += 1; }; } };
    const receiver = await start({ timers });
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'real' }) });
    await expect(result).resolves.toEqual({ code: 'real', fields: {} });
    fire!();
    await expect(result).resolves.toEqual({ code: 'real', fields: {} });
    // Teardown ran once: the late expiry did not re-enter it.
    expect(cancels).toBe(1);
  });

  test('an abort after expiry keeps the expired outcome', async () => {
    let fire: (() => void) | undefined;
    const timers: LoopbackReceiverTimers = { after: ({ run }) => { fire = run; return () => undefined; } };
    const controller = new AbortController();
    const receiver = await start({ timers, signal: controller.signal });
    const result = receiver.receive({ expectedState: STATE });
    fire!();
    fire!();
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'OAUTH_AUTHORIZATION_EXPIRED' });
  });
});

describe('without a signal', () => {
  test('starts and completes when no abort signal is given', async () => {
    const receiver = await startLoopbackAuthorizationReceiver({});
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: callbackUrl(receiver, { state: STATE, code: 'real' }) });
    await expect(result).resolves.toEqual({ code: 'real', fields: {} });
    await expectClosed(receiver);
  });
});
