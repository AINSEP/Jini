/** Cookie exchange, validity probe, partition naming and header arming against fake Electron ports. */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  armExactUrlHeader,
  exchangeSessionJson,
  exchangeSessionRequest,
  hasSessionCookie,
  persistentPartitionName,
  probeSession,
  type HeaderArmingSession,
  type SessionBodyRequest,
  type SessionRequestOptions,
} from '../index.js';

type FakeRequest = EventEmitter & { end: () => void };
type FakeBodyRequest = FakeRequest & { setHeader: (name: string, value: string) => void; write: (body: string) => void };
type FakeResponse = EventEmitter & { statusCode: number };
type RecordedCall = SessionRequestOptions<unknown> & { body?: string; headers: Record<string, string>; order: string[] };

/** Answers every request with `statusCode` and records the request, its header/body and call order. */
function fakeNet(statusCode: number) {
  const calls: RecordedCall[] = [];
  return {
    calls,
    request(options: SessionRequestOptions<unknown>) {
      const call: RecordedCall = { ...options, headers: {}, order: [] };
      calls.push(call);
      const request = new EventEmitter() as FakeBodyRequest;
      request.setHeader = (name, value) => { call.order.push('setHeader'); call.headers[name.toLowerCase()] = value; };
      request.write = (body) => { call.order.push('write'); call.body = body; };
      request.end = () => {
        call.order.push(`end:${request.listenerCount('response')}/${request.listenerCount('error')}`);
        const response = new EventEmitter() as FakeResponse;
        response.statusCode = statusCode;
        request.emit('response', response);
        queueMicrotask(() => response.emit('end'));
      };
      return request;
    },
  };
}

/** Errors come from the request, before any HTTP response is available. */
function failingNet(message: string) {
  return {
    request(): SessionBodyRequest {
      const request = new EventEmitter() as EventEmitter & SessionBodyRequest;
      request.setHeader = () => {};
      request.write = () => {};
      request.end = () => queueMicrotask(() => request.emit('error', new Error(message)));
      return request;
    },
  };
}

/** End is withheld until the test ends the stream; without a data listener it never drains. */
function streamingNet(statusCode: number) {
  const response = Object.assign(new PassThrough(), { statusCode });
  const calls: SessionRequestOptions<unknown>[] = [];
  const net = {
    request(options: SessionRequestOptions<unknown>): SessionBodyRequest {
      calls.push(options);
      const request = new EventEmitter() as EventEmitter & SessionBodyRequest;
      request.setHeader = () => {};
      request.write = () => {};
      request.end = () => request.emit('response', response);
      return request;
    },
  };
  return { net, response, calls };
}

function fakeSession(cookies: unknown[]) {
  const calls: { name: string }[] = [];
  return { calls, cookies: { get(filter: { name: string }) { calls.push(filter); return Promise.resolve(cookies); } } };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const URL_REDEEM = 'http://127.0.0.1:3001/redeem';
const URL_PROBE = 'http://127.0.0.1:3001/me';
const SESSION = { id: 'fake' };
const ONE_COOKIE = [{ name: 'host_session', value: 'opaque' }];
const streams: PassThrough[] = [];
afterEach(() => { for (const stream of streams.splice(0)) stream.destroy(); });

/** The test host's transport-error text: Jini hands the caught error to the host, which formats it. */
const describeError = ({ error }: { error: Error }): string => error.message;

describe('exchangeSessionJson', () => {
  const input = { session: SESSION, url: URL_REDEEM, body: '{"token":"tok-abc"}', label: 'redeem', describeError };

  it('a 200 reports success', async () => {
    expect(await exchangeSessionJson({ ...input, net: fakeNet(200) })).toEqual({ ok: true, status: 200 });
  });

  it.each([401, 403])('a %i RESOLVES as not-ok with the host label rather than throwing', async (status) => {
    expect(await exchangeSessionJson({ ...input, net: fakeNet(status) })).toEqual({ ok: false, status, reason: `redeem responded ${status}` });
  });

  it('posts the body through the session cookie jar, header first, listeners before write/end', async () => {
    // Without `useSessionCookies` Chromium never STORES the cookie: a silent no-op.
    const net = fakeNet(200);
    await exchangeSessionJson({ ...input, net });
    expect(net.calls).toHaveLength(1);
    const call = net.calls[0]!;
    expect(call).toMatchObject({ method: 'POST', url: URL_REDEEM, session: SESSION, useSessionCookies: true, body: '{"token":"tok-abc"}' });
    expect(call.headers).toEqual({ 'content-type': 'application/json' });
    expect(call.order).toEqual(['setHeader', 'write', 'end:1/1']);
  });

  it('a transport error resolves with its cause so the host can load its login form', async () => {
    expect(await exchangeSessionJson({ ...input, net: failingNet('ECONNRESET during redemption') })).toEqual({ ok: false, reason: 'ECONNRESET during redemption' });
  });

  it('drains a chunked response and waits for end before reporting the session bound', async () => {
    const transport = streamingNet(200);
    streams.push(transport.response);
    let settled = false;
    const pending = exchangeSessionJson({ ...input, net: transport.net }).then((result) => { settled = true; return result; });
    transport.response.write('{"user":');
    await tick();
    expect(settled, 'headers and a partial body must not complete the exchange').toBe(false);
    transport.response.end('{"id":1}}');
    expect(await pending).toEqual({ ok: true, status: 200 });
    expect(transport.response.readableEnded).toBe(true);
  });

  it('a failed exchange part-way through a body never reports the session as bound', async () => {
    const transport = streamingNet(500);
    streams.push(transport.response);
    const pending = exchangeSessionJson({ ...input, net: transport.net });
    transport.response.write('partial');
    await tick();
    transport.response.end();
    expect(await pending).toEqual({ ok: false, status: 500, reason: 'redeem responded 500' });
  });
});

describe('exchangeSessionRequest', () => {
  const input = { session: SESSION, url: 'http://127.0.0.1:3001/logout', method: 'POST' as const, label: 'logout', describeError };

  it('a 200 reports success, through the session cookie jar, with no header or body', async () => {
    const net = fakeNet(200);
    expect(await exchangeSessionRequest({ ...input, net })).toEqual({ ok: true, status: 200 });
    expect(net.calls[0]).toMatchObject({ method: 'POST', url: input.url, session: SESSION, useSessionCookies: true, headers: {}, order: ['end:1/1'] });
    expect(net.calls[0]!.body).toBeUndefined();
  });

  it('drains an error response and reports the HTTP failure after end', async () => {
    const transport = streamingNet(503);
    streams.push(transport.response);
    let settled = false;
    const pending = exchangeSessionRequest({ ...input, net: transport.net }).then((result) => { settled = true; return result; });
    transport.response.write('service unavailable');
    await tick();
    expect(settled).toBe(false);
    transport.response.end();
    expect(await pending).toEqual({ ok: false, status: 503, reason: 'logout responded 503' });
    expect(transport.response.readableEnded).toBe(true);
  });

  it('a transport error resolves with its cause instead of blocking the caller', async () => {
    expect(await exchangeSessionRequest({ ...input, net: failingNet('ECONNREFUSED during logout') })).toEqual({ ok: false, reason: 'ECONNREFUSED during logout' });
  });

  it('hands the raw transport error to the host describer and stores its text as the reason', async () => {
    const seen: Error[] = [];
    const outcome = await exchangeSessionRequest({
      ...input, net: failingNet('ECONNREFUSED during logout'),
      describeError: ({ error }) => { seen.push(error); return 'host text'; },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Error);
    expect(seen[0]!.message).toBe('ECONNREFUSED during logout');
    expect(outcome).toEqual({ ok: false, reason: 'host text' });
  });
});

describe('hasSessionCookie', () => {
  it('is false for an empty jar and true when the named cookie is present', async () => {
    expect(await hasSessionCookie({ session: fakeSession([]), cookieName: 'host_session' })).toBe(false);
    expect(await hasSessionCookie({ session: fakeSession(ONE_COOKIE), cookieName: 'host_session' })).toBe(true);
  });

  it('looks the cookie up by NAME only — a port-scoped filter would never match a reused partition', async () => {
    const session = fakeSession([]);
    await hasSessionCookie({ session, cookieName: 'host_session' });
    expect(session.calls).toEqual([{ name: 'host_session' }]);
  });
});

describe('probeSession', () => {
  const input = { url: URL_PROBE, cookieName: 'host_session' };

  it('is false for a cookie the server no longer honours, asking with the session cookies', async () => {
    const net = fakeNet(401);
    expect(await probeSession({ ...input, session: fakeSession(ONE_COOKIE), net })).toBe(false);
    expect(net.calls[0]).toMatchObject({ method: 'GET', url: URL_PROBE, useSessionCookies: true });
  });

  it('is true only when the server itself confirms the session', async () => {
    expect(await probeSession({ ...input, session: fakeSession(ONE_COOKIE), net: fakeNet(200) })).toBe(true);
  });

  it('asks the server nothing when there is no cookie to ask about', async () => {
    const net = fakeNet(200);
    expect(await probeSession({ ...input, session: fakeSession([]), net })).toBe(false);
    expect(net.calls).toEqual([]);
  });

  it('treats an unreachable server as not-authenticated rather than rejecting', async () => {
    expect(await probeSession({ ...input, session: fakeSession(ONE_COOKIE), net: failingNet('ECONNREFUSED') })).toBe(false);
  });

  it('drains the principal body before reporting the server answer', async () => {
    for (const statusCode of [200, 401]) {
      const transport = streamingNet(statusCode);
      streams.push(transport.response);
      const session = { cookies: { get: async () => ONE_COOKIE } };
      let settled = false;
      const pending = probeSession({ ...input, net: transport.net, session }).then((result) => { settled = true; return result; });
      await tick();
      transport.response.write('principal body');
      await tick();
      expect(settled).toBe(false);
      expect(transport.calls[0]?.session).toBe(session);
      transport.response.end();
      expect(await pending).toBe(statusCode === 200);
      expect(transport.response.readableEnded).toBe(true);
    }
  });
});

describe('persistentPartitionName', () => {
  it('is stable per key, distinct across keys, and shaped persist:<prefix><32 hex>', () => {
    const a = persistentPartitionName({ prefix: 'host-site-', key: '/sites/alpha' });
    expect(a).toBe(persistentPartitionName({ prefix: 'host-site-', key: '/sites/alpha' }));
    expect(a).not.toBe(persistentPartitionName({ prefix: 'host-site-', key: '/sites/beta' }));
    expect(a).toMatch(/^persist:host-site-[0-9a-f]{32}$/);
  });

  it('does not leak the key into the partition name', () => {
    expect(persistentPartitionName({ prefix: 'p-', key: '/Users/someone/Secret Client Work/site' })).not.toContain('Secret');
  });
});

describe('armExactUrlHeader', () => {
  it('adds the header only for the exact armed URLs', () => {
    type Listener = Parameters<HeaderArmingSession['webRequest']['onBeforeSendHeaders']>[1];
    let filter: { urls: string[] } | undefined;
    let listener: Listener | undefined;
    const session: HeaderArmingSession = { webRequest: { onBeforeSendHeaders: (value, handler) => { filter = value; listener = handler; } } };
    const urls = ['http://127.0.0.1:3001/a', 'http://127.0.0.1:3001/b'];
    armExactUrlHeader({ session, urls, header: 'X-Host-Capability', value: 'secret' });
    expect(filter).toEqual({ urls });
    for (const url of [...urls, 'http://127.0.0.1:3002/a', 'http://evil.example/a', 'http://127.0.0.1:3001/a?x=1']) {
      let headers: Record<string, string> | undefined;
      listener!({ url, requestHeaders: { Accept: 'application/json' } }, (response) => { headers = response.requestHeaders; });
      expect(headers).toEqual(urls.includes(url) ? { Accept: 'application/json', 'X-Host-Capability': 'secret' } : { Accept: 'application/json' });
    }
  });
});
