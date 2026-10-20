/**
 * @file Security pins for the installed-app loopback receiver: it binds 127.0.0.1 only, checks
 * state in constant time, accepts exactly one callback, bounds what it reads, returns only
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
    const receiver = await start({ path: '/oauth/done' });
    expect(listen).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: 0 }), expect.any(Function));
    expect(receiver.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*\/oauth\/done$/);
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

  test('a mismatched state rejects as invalid state and consumes the single slot', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: callbackUrl(receiver, { state: `${STATE.slice(0, -1)}x`, code: 'one-time' }) });
    await expect(result).rejects.toMatchObject({ code: 'OAUTH_INVALID_STATE' });
    await expectClosed(receiver);
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

  test('a provider error with a wrong state fails the state check first', async () => {
    const receiver = await start();
    const result = receiver.receive({ expectedState: STATE });
    await send({ url: callbackUrl(receiver, { state: 'forged', error: 'access_denied' }) });
    await expect(result).rejects.toMatchObject({ code: 'OAUTH_INVALID_STATE' });
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
    await expect(result).rejects.toMatchObject({ code: 'OAUTH_AUTHORIZATION_CANCELLED' });
    await expectClosed(receiver);
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
    await expect(result).rejects.toMatchObject({ code: 'OAUTH_AUTHORIZATION_EXPIRED' });
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
