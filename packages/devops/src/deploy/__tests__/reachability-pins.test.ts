import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkDeploymentUrl, waitForReachableDeploymentUrl,
  type DeploymentUrlGuard, type ReachabilityFetchPort,
} from '../reachability.js';

// Characterization pins written against the pre-refactor reachability.ts (SEC-003 probe
// surface). Every branch of the probe, the HEAD->GET fallback and the polling loop is pinned
// here so the refactor can prove identical behaviour.

const guard: DeploymentUrlGuard = { assertSafeUrl: ({ raw }) => new URL(raw) };

/** Records each transport call and answers from a per-call script. */
function scriptedFetch(answers: Array<(init: RequestInit) => Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: ReachabilityFetchPort = async ({ url }, { init } = {}) => {
    calls.push({ url, init: init! });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    return answer(init!);
  };
  return { fetch, calls };
}

const status = (code: number, body: string | null = null) => async () => new Response(body, { status: code });

/** A clock that returns scripted values, then repeats the last one; counts reads. */
function scriptedClock(values: number[]) {
  let reads = 0;
  const now = () => values[Math.min(reads++, values.length - 1)]!;
  return { now, reads: () => reads };
}

describe('probe (requestDeploymentUrl via checkDeploymentUrl)', () => {
  it('folds a non-Error guard throw into its string form without opening the transport', async () => {
    const { fetch, calls } = scriptedFetch([status(200)]);
    const throwingGuard: DeploymentUrlGuard = { assertSafeUrl: () => { throw 'policy says no'; } };
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard: throwingGuard })).toEqual({
      reachable: false, statusMessage: 'Public link is not reachable yet: policy says no',
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses a guard-approved http URL with the https message', async () => {
    const { fetch, calls } = scriptedFetch([status(200)]);
    expect(await checkDeploymentUrl({ url: 'http://site.example', fetch, guard })).toEqual({
      reachable: false, statusMessage: 'Public link is not reachable yet: deployment url must use https',
    });
    expect(calls).toHaveLength(0);
  });

  it('sends the guard-normalized URL with manual redirects and an abort signal', async () => {
    const { fetch, calls } = scriptedFetch([status(200)]);
    await checkDeploymentUrl({ url: 'site.example', fetch, guard });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://site.example/');
    expect(calls[0]!.init.method).toBe('HEAD');
    expect(calls[0]!.init.redirect).toBe('manual');
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]!.init.signal!.aborted).toBe(false);
  });

  it('probes the URL the guard returned, not the raw input', async () => {
    const { fetch, calls } = scriptedFetch([status(200)]);
    const rewriting: DeploymentUrlGuard = { assertSafeUrl: () => new URL('https://canonical.example/x') };
    await checkDeploymentUrl({ url: 'site.example', fetch, guard: rewriting });
    expect(calls[0]!.url).toBe('https://canonical.example/x');
  });

  it.each([200, 204, 301, 399])('treats HTTP %s as reachable on HEAD', async (code) => {
    const { fetch, calls } = scriptedFetch([status(code)]);
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard })).toEqual({ reachable: true, statusCode: code });
    expect(calls).toHaveLength(1);
  });

  it('treats HTTP 400 as the first unreachable status', async () => {
    const { fetch } = scriptedFetch([status(400)]);
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard })).toEqual({
      reachable: false, statusCode: 400, statusMessage: 'Public link returned HTTP 400.',
    });
  });

  it('does not read the body of a non-401 HEAD response nor call the detector', async () => {
    const text = vi.fn(async () => 'x');
    const detectProtected = vi.fn(() => true);
    const fetch: ReachabilityFetchPort = async ({ url: _url }, { init } = {}) => (init!.method === 'HEAD'
      ? { status: 404, text } as Partial<Response> as Response // partial fake: only status/text are read
      : new Response(null, { status: 404 }));
    await checkDeploymentUrl({ url: 'site.example', fetch, guard }, { detectProtected });
    expect(text).not.toHaveBeenCalled();
    expect(detectProtected).not.toHaveBeenCalled();
  });

  it('reads the body of a non-401 GET response but does not call the detector', async () => {
    const getText = vi.fn(async () => 'server error page');
    const detectProtected = vi.fn(() => true);
    const fetch: ReachabilityFetchPort = async (_r, { init } = {}) => (init!.method === 'HEAD'
      ? new Response(null, { status: 500 })
      : { status: 500, text: getText } as Partial<Response> as Response); // partial fake: only status/text are read
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard }, { detectProtected })).toEqual({
      reachable: false, statusCode: 500, statusMessage: 'Public link returned HTTP 500.',
    });
    expect(getText).toHaveBeenCalledTimes(1);
    expect(detectProtected).not.toHaveBeenCalled();
  });

  it('passes the 401 response and its body to the detector', async () => {
    const seen: Array<{ status: number; body: string }> = [];
    const { fetch } = scriptedFetch([status(401, 'wall'), status(401, 'wall')]);
    await checkDeploymentUrl({ url: 'site.example', fetch, guard }, {
      detectProtected: ({ resp, body }) => { seen.push({ status: resp.status, body }); return false; },
    });
    expect(seen).toEqual([{ status: 401, body: 'wall' }, { status: 401, body: 'wall' }]);
  });

  it('reports a 401 the detector rejects as plain HTTP 401 after the GET fallback', async () => {
    const { fetch, calls } = scriptedFetch([status(401, 'a'), status(401, 'b')]);
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard }, { detectProtected: () => false })).toEqual({
      reachable: false, statusCode: 401, statusMessage: 'Public link returned HTTP 401.',
    });
    expect(calls.map((c) => c.init.method)).toEqual(['HEAD', 'GET']);
  });

  it('reports a 401 as plain HTTP 401 when no detector is supplied', async () => {
    const { fetch } = scriptedFetch([status(401, 'a')]);
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard })).toEqual({
      reachable: false, statusCode: 401, statusMessage: 'Public link returned HTTP 401.',
    });
  });

  it('uses the default protected message when none is configured', async () => {
    const { fetch, calls } = scriptedFetch([status(401, 'wall')]);
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard }, { detectProtected: () => true })).toEqual({
      reachable: false, status: 'protected', statusCode: 401, statusMessage: 'Deployment is protected by the provider.',
    });
    expect(calls).toHaveLength(1);
  });

  it('only classifies 401 as protected, never 403', async () => {
    const { fetch } = scriptedFetch([status(403, 'wall')]);
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard }, { detectProtected: () => true })).toEqual({
      reachable: false, statusCode: 403, statusMessage: 'Public link returned HTTP 403.',
    });
  });

  it('folds a throwing detector into an unreachable result', async () => {
    const { fetch } = scriptedFetch([status(401, 'wall')]);
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard }, {
      detectProtected: () => { throw new Error('detector broke'); },
    })).toEqual({ reachable: false, statusMessage: 'Public link is not reachable yet: detector broke' });
  });

  it('folds a rejecting body read into an unreachable result', async () => {
    const fetch: ReachabilityFetchPort = async () => ({ status: 401, text: async () => { throw new Error('body reset'); } }) as Partial<Response> as Response; // partial fake
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard })).toEqual({
      reachable: false, statusMessage: 'Public link is not reachable yet: body reset',
    });
  });
});

describe('HEAD -> GET fallback (checkDeploymentUrl)', () => {
  it('returns a protected HEAD verdict without a GET', async () => {
    const { fetch, calls } = scriptedFetch([status(401, 'wall')]);
    const result = await checkDeploymentUrl({ url: 'site.example', fetch, guard }, { detectProtected: () => true, protectedMessage: 'gated' });
    expect(result).toEqual({ reachable: false, status: 'protected', statusCode: 401, statusMessage: 'gated' });
    expect(calls).toHaveLength(1);
  });

  it('falls back to GET after a HEAD transport error and returns the GET verdict', async () => {
    const { fetch, calls } = scriptedFetch([async () => { throw new Error('reset'); }, status(200)]);
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard })).toEqual({ reachable: true, statusCode: 200 });
    expect(calls.map((c) => c.init.method)).toEqual(['HEAD', 'GET']);
  });

  it('returns the GET failure, not the HEAD failure, after a HEAD transport error', async () => {
    const { fetch } = scriptedFetch([async () => { throw new Error('head reset'); }, status(404)]);
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard })).toEqual({
      reachable: false, statusCode: 404, statusMessage: 'Public link returned HTTP 404.',
    });
  });

  it('returns the GET transport error, not the HEAD status, after a HEAD 4xx', async () => {
    const { fetch } = scriptedFetch([status(404), async () => { throw new Error('get reset'); }]);
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard })).toEqual({
      reachable: false, statusMessage: 'Public link is not reachable yet: get reset',
    });
  });

  it('returns a protected GET verdict after a HEAD transport error', async () => {
    const { fetch } = scriptedFetch([async () => { throw new Error('reset'); }, status(401, 'wall')]);
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard }, { detectProtected: () => true, protectedMessage: 'gated' })).toEqual({
      reachable: false, status: 'protected', statusCode: 401, statusMessage: 'gated',
    });
  });

  it('runs the guard again for the GET probe', async () => {
    const assertSafeUrl = vi.fn(({ raw }: { raw: string; label: string }) => new URL(raw));
    const { fetch } = scriptedFetch([status(404), status(404)]);
    await checkDeploymentUrl({ url: 'site.example', fetch, guard: { assertSafeUrl } });
    expect(assertSafeUrl).toHaveBeenCalledTimes(2);
  });

  it('does not open the transport for GET when the guard refuses the second time', async () => {
    let n = 0;
    const flaky: DeploymentUrlGuard = { assertSafeUrl: ({ raw }) => { if (n++ > 0) throw new Error('now refused'); return new URL(raw); } };
    const { fetch, calls } = scriptedFetch([status(404)]);
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard: flaky })).toEqual({
      reachable: false, statusMessage: 'Public link is not reachable yet: now refused',
    });
    expect(calls).toHaveLength(1);
  });
});

describe('deadlines (fake timers)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('defaults the probe timeout to 8000ms and aborts the signal', async () => {
    const signals: AbortSignal[] = [];
    const fetch: ReachabilityFetchPort = (_r, { init } = {}) => { signals.push(init!.signal!); return new Promise<Response>(() => {}); };
    const promise = checkDeploymentUrl({ url: 'site.example', fetch, guard });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await promise).toEqual({ reachable: false, statusMessage: 'Public link is not reachable yet: probe timed out after 8000ms' });
    expect(signals[0]!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns the HEAD result without a GET once the shared budget is spent', async () => {
    const { calls, fetch: inner } = scriptedFetch([status(404)]);
    const fetch: ReachabilityFetchPort = async (r, o) => { vi.setSystemTime(Date.now() + 100); return inner(r, o); };
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard }, { timeoutMs: 100 })).toEqual({
      reachable: false, statusCode: 404, statusMessage: 'Public link returned HTTP 404.',
    });
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still runs GET with 1ms of budget left', async () => {
    const { calls, fetch: inner } = scriptedFetch([status(404), status(200)]);
    const fetch: ReachabilityFetchPort = async (r, o) => { if (calls.length === 0) vi.setSystemTime(Date.now() + 99); return inner(r, o); };
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard }, { timeoutMs: 100 })).toEqual({ reachable: true, statusCode: 200 });
    expect(calls).toHaveLength(2);
  });

  it('caps each polling probe at the default 8000ms when no timeoutMs is given', async () => {
    const fetch: ReachabilityFetchPort = () => new Promise<Response>(() => {});
    // A never-settling sleep ends the poll after one sweep, isolating the first probe's budget.
    const promise = waitForReachableDeploymentUrl({ urls: ['site.example'], fetch, guard, now: () => Date.now(), sleep: () => new Promise<void>(() => {}) }, { intervalMs: 60_000 });
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(52_000);
    expect(await promise).toEqual({
      status: 'link-delayed', url: 'https://site.example', statusMessage: 'Public link is not reachable yet: probe timed out after 8000ms',
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('polling loop (waitForReachableDeploymentUrl)', () => {
  const noSleep = async () => {};

  it('uses the default provider label when no candidate survives normalization', async () => {
    const { fetch, calls } = scriptedFetch([status(200)]);
    expect(await waitForReachableDeploymentUrl({ urls: [42, '  ', null], fetch, guard, now: () => 0, sleep: noSleep })).toEqual({
      status: 'link-delayed', url: '', statusMessage: 'Deployment provider did not return a public deployment URL.',
    });
    expect(calls).toHaveLength(0);
  });

  it('skips non-string candidates and probes the rest in order', async () => {
    const { fetch, calls } = scriptedFetch([status(200)]);
    const result = await waitForReachableDeploymentUrl({ urls: [42, ' a.example ', 'b.example'], fetch, guard, now: () => 5, sleep: noSleep });
    expect(result).toEqual({ status: 'ready', url: 'https://a.example', statusMessage: 'Public link is ready.', reachableAt: 5 });
    expect(calls[0]!.url).toBe('https://a.example/');
  });

  it('reports reachableAt from the clock read after the ready probe', async () => {
    const clock = scriptedClock([0, 1, 2, 77]);
    const { fetch } = scriptedFetch([status(200)]);
    const result = await waitForReachableDeploymentUrl({ urls: ['a.example'], fetch, guard, now: clock.now, sleep: noSleep });
    expect(result.reachableAt).toBe(77);
    expect(clock.reads()).toBe(4);
  });

  it('keeps the first protected candidate when several are protected', async () => {
    const { fetch } = scriptedFetch([status(401, 'wall')]);
    const result = await waitForReachableDeploymentUrl({ urls: ['a.example', 'b.example'], fetch, guard, now: () => 0, sleep: noSleep }, {
      detectProtected: () => true,
    });
    expect(result).toEqual({ status: 'protected', url: 'https://a.example', statusMessage: 'Deployment is protected by the provider.' });
  });

  it('reports the last candidate\'s failure message and the first candidate as url', async () => {
    let n = 0;
    const fetch: ReachabilityFetchPort = async ({ url }) => { n++; return new Response(null, { status: url.includes('a.') ? 404 : 503 }); };
    const clock = scriptedClock([0, 0, 0, 0, 100]);
    const result = await waitForReachableDeploymentUrl({ urls: ['a.example', 'b.example'], fetch, guard, now: clock.now, sleep: noSleep }, { timeoutMs: 100 });
    expect(result).toEqual({ status: 'link-delayed', url: 'https://a.example', statusMessage: 'Public link returned HTTP 503.' });
    expect(n).toBe(4);
    expect(clock.reads()).toBe(5);
  });

  it('sleeps min(intervalMs, remaining) between sweeps and re-reads the clock each step', async () => {
    const delays: number[] = [];
    const clock = scriptedClock([0, 0, 0, 10, 10, 10, 700, 700, 700, 1_000]);
    const { fetch } = scriptedFetch([status(404)]);
    const result = await waitForReachableDeploymentUrl({
      urls: ['a.example'], fetch, guard, now: clock.now, sleep: async ({ ms }) => { delays.push(ms); },
    }, { timeoutMs: 1_000, intervalMs: 500 });
    expect(result.status).toBe('link-delayed');
    expect(delays).toEqual([500, 300]);
    expect(clock.reads()).toBe(10);
  });

  it('stops before sleeping when the budget is spent right after a sweep', async () => {
    const sleep = vi.fn(async () => {});
    const clock = scriptedClock([0, 0, 0, 50]);
    const { fetch } = scriptedFetch([status(404)]);
    const result = await waitForReachableDeploymentUrl({ urls: ['a.example'], fetch, guard, now: clock.now, sleep }, { timeoutMs: 50 });
    expect(result).toEqual({ status: 'link-delayed', url: 'https://a.example', statusMessage: 'Public link returned HTTP 404.' });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('keeps the previous sweep\'s message when the next sweep is cut off before its first probe', async () => {
    const clock = scriptedClock([0, 0, 0, 10, 20, 100, 100]);
    const { fetch, calls } = scriptedFetch([status(404)]);
    const result = await waitForReachableDeploymentUrl({ urls: ['a.example'], fetch, guard, now: clock.now, sleep: noSleep }, { timeoutMs: 100, intervalMs: 1 });
    expect(result).toEqual({ status: 'link-delayed', url: 'https://a.example', statusMessage: 'Public link returned HTTP 404.' });
    expect(calls).toHaveLength(2);
    expect(clock.reads()).toBe(7);
  });

  it('passes min(options.timeoutMs, remaining) as each probe budget', async () => {
    vi.useFakeTimers();
    try {
      const clock = scriptedClock([0, 0, 70, 100]);
      const fetch: ReachabilityFetchPort = () => new Promise<Response>(() => {});
      const promise = waitForReachableDeploymentUrl({ urls: ['a.example'], fetch, guard, now: clock.now, sleep: noSleep }, { timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(100);
      expect(await promise).toEqual({
        status: 'link-delayed', url: 'https://a.example', statusMessage: 'Public link is not reachable yet: probe timed out after 30ms',
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards detector and message options to every probe', async () => {
    const detectProtected = vi.fn(() => true);
    const { fetch } = scriptedFetch([status(401, 'wall')]);
    const result = await waitForReachableDeploymentUrl({ urls: ['a.example'], fetch, guard, now: () => 0, sleep: noSleep }, {
      detectProtected, protectedMessage: 'gated', providerLabel: 'P',
    });
    expect(result).toEqual({ status: 'protected', url: 'https://a.example', statusMessage: 'gated' });
    expect(detectProtected).toHaveBeenCalledTimes(1);
  });

  it('ends with the generic message when the clock is already past the budget at start', async () => {
    const clock = scriptedClock([0, 100]);
    const { fetch, calls } = scriptedFetch([status(200)]);
    expect(await waitForReachableDeploymentUrl({ urls: ['a.example'], fetch, guard, now: clock.now, sleep: noSleep }, { timeoutMs: 100, providerLabel: 'P' })).toEqual({
      status: 'link-delayed', url: 'https://a.example', statusMessage: 'P returned a deployment URL, but it is not reachable yet.',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('security weaknesses (reported, not fixed)', () => {
  it('reads an arbitrarily large 401 body in full, bounded only by the probe timeout (reported, not fixed)', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    let seenLength = 0;
    const { fetch } = scriptedFetch([status(401, big)]);
    await checkDeploymentUrl({ url: 'site.example', fetch, guard }, { detectProtected: ({ body }) => { seenLength = body.length; return true; } });
    expect(seenLength).toBe(big.length);
  });

  it('treats any 3xx as ready without checking where it redirects (reported, not fixed)', async () => {
    const fetch: ReachabilityFetchPort = async () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/' } });
    expect(await checkDeploymentUrl({ url: 'site.example', fetch, guard })).toEqual({ reachable: true, statusCode: 302 });
  });

  it('leaves a reachable response body unconsumed and uncancelled (reported, not fixed)', async () => {
    const resp = new Response('page', { status: 200 });
    const fetch: ReachabilityFetchPort = async () => resp;
    await checkDeploymentUrl({ url: 'site.example', fetch, guard });
    expect(resp.bodyUsed).toBe(false);
  });
});
