import { afterEach, describe, expect, it, vi } from 'vitest';
import { startOAuthCallbackListener, type OAuthCallbackOutcome } from '../oauth-callback-server.js';

function get(url: string): Promise<{ status: number; body: string }> {
  return fetch(url).then(async (res) => ({ status: res.status, body: await res.text() }));
}

describe('startOAuthCallbackListener', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a matching callback, invokes onCallback, and self-closes', async () => {
    const outcomes: OAuthCallbackOutcome[] = [];
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: (outcome) => {
        outcomes.push(outcome);
      } });
    const base = `http://${listener.address.host}:${listener.address.port}`;
    const { status, body } = await get(`${base}/callback?code=abc&state=state-1`);
    expect(status).toBe(200);
    expect(body).toContain('Authorized');
    // give the async onCallback a tick to run before asserting
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outcomes).toEqual([{ kind: 'ok', code: 'abc', state: 'state-1' }]);

    // The listener already self-closed; a second hit should fail to connect.
    await expect(get(`${base}/callback?code=x&state=state-1`)).rejects.toThrow();
  });

  it('rejects a state mismatch without consuming the listener, then still accepts the real callback', async () => {
    const outcomes: OAuthCallbackOutcome[] = [];
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: (outcome) => {
        outcomes.push(outcome);
      } });
    const base = `http://${listener.address.host}:${listener.address.port}`;
    const mismatch = await get(`${base}/callback?code=abc&state=WRONG`);
    expect(mismatch.status).toBe(400);
    expect(outcomes).toHaveLength(0);

    const ok = await get(`${base}/callback?code=abc&state=state-1`);
    expect(ok.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outcomes).toEqual([{ kind: 'ok', code: 'abc', state: 'state-1' }]);
  });

  it('serves a 400 for a bare request with no code/state/error, without consuming the listener', async () => {
    // No explicit `?error=` param, so per the "stale/malformed request"
    // policy this does not consume the listener or notify onCallback — the
    // real callback (or a later retry) can still land.
    const outcomes: OAuthCallbackOutcome[] = [];
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: (outcome) => {
        outcomes.push(outcome);
      } });
    const base = `http://${listener.address.host}:${listener.address.port}`;
    const result = await get(`${base}/callback`);
    expect(result.status).toBe(400);
    expect(result.body).toContain('Sign-in failed');
    expect(outcomes).toHaveLength(0);
    const ok = await get(`${base}/callback?code=abc&state=state-1`);
    expect(ok.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outcomes).toEqual([{ kind: 'ok', code: 'abc', state: 'state-1' }]);
  });

  it('consumes on an explicit provider error with no state', async () => {
    const outcomes: OAuthCallbackOutcome[] = [];
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: (outcome) => {
        outcomes.push(outcome);
      } });
    const base = `http://${listener.address.host}:${listener.address.port}`;
    const result = await get(`${base}/callback?error=access_denied`);
    expect(result.status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outcomes).toEqual([{ kind: 'error', error: 'access_denied' }]);
    // Listener consumed itself — a follow-up request should fail to connect.
    await expect(get(`${base}/callback?code=x&state=state-1`)).rejects.toThrow();
  });

  it('consumes on an explicit provider error with a matching state', async () => {
    const outcomes: OAuthCallbackOutcome[] = [];
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: (outcome) => {
        outcomes.push(outcome);
      } });
    const base = `http://${listener.address.host}:${listener.address.port}`;
    const result = await get(`${base}/callback?error=access_denied&state=state-1`);
    expect(result.status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(outcomes).toEqual([{ kind: 'error', error: 'access_denied', state: 'state-1' }]);
  });

  it('does not consume the listener on an error with a mismatched state', async () => {
    const outcomes: OAuthCallbackOutcome[] = [];
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: (outcome) => {
        outcomes.push(outcome);
      } });
    const base = `http://${listener.address.host}:${listener.address.port}`;
    const result = await get(`${base}/callback?error=access_denied&state=OTHER`);
    expect(result.status).toBe(400);
    expect(outcomes).toHaveLength(0);
    const ok = await get(`${base}/callback?code=abc&state=state-1`);
    expect(ok.status).toBe(200);
    await listener.stop();
  });

  it('ignores requests to any path other than the configured callback path', async () => {
    const outcomes: OAuthCallbackOutcome[] = [];
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: (outcome) => {
        outcomes.push(outcome);
      } });
    const base = `http://${listener.address.host}:${listener.address.port}`;
    const favicon = await get(`${base}/favicon.ico`);
    expect(favicon.status).toBe(404);
    expect(outcomes).toHaveLength(0);
    await listener.stop();
  });

  it('logs and continues when onCallback itself throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: () => {
        throw new Error('handler boom');
      } });
    const base = `http://${listener.address.host}:${listener.address.port}`;
    const result = await get(`${base}/callback?code=abc&state=state-1`);
    expect(result.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(errSpy).toHaveBeenCalledWith('[oauth-callback-server] onCallback failed:', expect.any(Error));
  });

  it('can be stopped early before any callback arrives', async () => {
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: () => {} });
    await listener.stop();
    await expect(get(`http://${listener.address.host}:${listener.address.port}/callback?code=x&state=state-1`)).rejects.toThrow();
    // stop() is idempotent.
    await expect(listener.stop()).resolves.toBeUndefined();
  });

  it('swallows a throwing closeAllConnections() during the post-close reaper', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const http = await import('node:http');
    const spy = vi
      .spyOn(http.Server.prototype, 'closeAllConnections')
      .mockImplementation(() => {
        throw new Error('boom');
      });
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: () => {} });
    const stopping = listener.stop();
    // Advance past the 100ms reaper timeout that calls closeAllConnections().
    await vi.advanceTimersByTimeAsync(150);
    await expect(stopping).resolves.toBeUndefined();
    spy.mockRestore();
    vi.useRealTimers();
  });

  it('times out and reports an error after timeoutMs', async () => {
    const outcomes: OAuthCallbackOutcome[] = [];
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: (outcome) => {
        outcomes.push(outcome);
      } }, { timeoutMs: 20 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(outcomes).toEqual([{ kind: 'error', error: 'OAuth timed out — sign in again' }]);
    await expect(
      get(`http://${listener.address.host}:${listener.address.port}/callback?code=x&state=state-1`),
    ).rejects.toThrow();
  });

  it('rejects with a descriptive error when the port is already in use', async () => {
    const first = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 's1', onCallback: () => {} });
    await expect(
      startOAuthCallbackListener({ host: '127.0.0.1', port: first.address.port, path: '/callback', expectedState: 's2', onCallback: () => {} }),
    ).rejects.toThrow(/already in use/);
    await first.stop();
  });

  it('rejects a malformed request URL without crashing the listener', async () => {
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: () => {} });
    // Node's HTTP parser accepts an absolute-form request-target (normally
    // for proxies, but not rejected by a plain server either) - an invalid
    // bracketed host inside it makes `new URL(req.url, base)` throw once it
    // reaches our handler, which fetch() itself has no way to send.
    const net = await import('node:net');
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(listener.address.port, listener.address.host, () => {
        socket.write('GET http://[not-valid HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
      });
      let data = '';
      socket.on('data', (chunk) => {
        data += chunk.toString();
      });
      socket.on('close', () => resolve(data));
      socket.on('error', reject);
    });
    expect(response).toMatch(/^HTTP\/1\.1 400/);
    expect(response).toContain('Bad request.');
    await listener.stop();
  });

  it('serves a 410 for a request that arrives after the listener already consumed itself', async () => {
    const listener = await startOAuthCallbackListener({ host: '127.0.0.1', port: 0, path: '/callback', expectedState: 'state-1', onCallback: () => {} });
    // Two full HTTP/1.1 requests pipelined on one keep-alive socket, sent in
    // a single write: the server processes them in order on the same
    // connection, so the second is handled after `consumed` has already
    // flipped true from the first (server.close() only stops accepting NEW
    // connections; it doesn't tear down this one mid-pipeline).
    const net = await import('node:net');
    const req = (state: string) =>
      `GET /callback?code=abc&state=${state} HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n`;
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(listener.address.port, listener.address.host, () => {
        socket.write(req('state-1') + req('state-1'));
      });
      let data = '';
      socket.on('data', (chunk) => {
        data += chunk.toString();
        if ((data.match(/HTTP\/1\.1/g) ?? []).length >= 2) {
          socket.end();
        }
      });
      socket.on('close', () => resolve(data));
      socket.on('error', reject);
      setTimeout(() => resolve(data), 500);
    });
    expect(response).toContain('HTTP/1.1 200');
    expect(response).toContain('HTTP/1.1 410');
    expect(response).toContain('Listener already consumed.');
  });

  it('rejects with the raw listen error when it is not EADDRINUSE', async () => {
    await expect(
      startOAuthCallbackListener({ host: '256.256.256.256', port: 12345, path: '/callback', expectedState: 's1', onCallback: () => {} }),
    ).rejects.toThrow();
  });
});
