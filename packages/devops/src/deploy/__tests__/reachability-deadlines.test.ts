import { createNodeReachabilityPorts } from '../node.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDeploymentUrl, waitForReachableDeploymentUrl, type ReachabilityFetchPort } from '../reachability.js';

const { guard } = createNodeReachabilityPorts({});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });



it('keeps the request deadline active through a stalled protected-response body', async () => {
  const signals: AbortSignal[] = [];
  const fetch: ReachabilityFetchPort = async (_required, { init } = {}) => {
    signals.push(init!.signal!);
    return { status: 401, text: () => new Promise<string>(() => {}) } as Response;
  };
  const detectProtected = vi.fn(() => true);
  const promise = checkDeploymentUrl({ url: 'https://example.test', fetch, guard }, { timeoutMs: 100, detectProtected });
  await vi.advanceTimersByTimeAsync(100);
  expect(await promise).toEqual({ reachable: false, statusMessage: 'Public link is not reachable yet: probe timed out after 100ms' });
  expect(signals).toHaveLength(1);
  expect(signals[0]!.aborted).toBe(true);
  expect(detectProtected).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('shares the probe budget between HEAD and a stalled GET fallback', async () => {
  const methods: string[] = [];
  const fetch: ReachabilityFetchPort = async (_required, { init } = {}) => {
    methods.push(init!.method!);
    if (init!.method === 'HEAD') {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return new Response(null, { status: 405 });
    }
    return new Promise<Response>(() => {});
  };
  const promise = checkDeploymentUrl({ url: 'https://example.test', fetch, guard }, { timeoutMs: 100 });
  await vi.advanceTimersByTimeAsync(100);
  expect(await promise).toEqual({ reachable: false, statusMessage: 'Public link is not reachable yet: probe timed out after 20ms' });
  expect(methods).toEqual(['HEAD', 'GET']);
  expect(vi.getTimerCount()).toBe(0);
});

it('a completed protected body still returns the configured classification and releases its timer', async () => {
  const result = await checkDeploymentUrl({
    url: 'https://example.test', guard, fetch: async () => new Response('login required', { status: 401 }),
  }, { timeoutMs: 100, detectProtected: ({ body }) => body === 'login required', protectedMessage: 'Sign in at the provider.' });
  expect(result).toEqual({ reachable: false, status: 'protected', statusCode: 401, statusMessage: 'Sign in at the provider.' });
  expect(vi.getTimerCount()).toBe(0);
});

it('does not probe another candidate or sleep after the overall budget expires', async () => {
  const fetch = vi.fn<ReachabilityFetchPort>(() => new Promise<Response>(() => {}));
  const sleep = vi.fn(async () => {});
  const promise = waitForReachableDeploymentUrl({ urls: ['first.example', 'second.example'], fetch, guard, now: () => Date.now(), sleep }, { timeoutMs: 100 });
  await vi.advanceTimersByTimeAsync(100);
  expect(await promise).toEqual({ status: 'link-delayed', url: 'https://first.example', statusMessage: 'Public link is not reachable yet: probe timed out after 100ms' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});

it('clamps an injected sleep to the remaining polling budget', async () => {
  const delays: number[] = [];
  const fetch: ReachabilityFetchPort = async () => new Response(null, { status: 404 });
  const promise = waitForReachableDeploymentUrl({
    urls: ['example.test'], fetch, guard, now: () => Date.now(),
    sleep: async ({ ms }) => { delays.push(ms); await new Promise((resolve) => setTimeout(resolve, ms)); },
  }, { timeoutMs: 100, intervalMs: 2_000 });
  await vi.advanceTimersByTimeAsync(100);
  expect((await promise).status).toBe('link-delayed');
  expect(delays).toEqual([100]);
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds an injected sleep that never settles', async () => {
  const promise = waitForReachableDeploymentUrl({
    urls: ['example.test'], guard, fetch: async () => new Response(null, { status: 404 }),
    now: () => Date.now(), sleep: () => new Promise<void>(() => {}),
  }, { timeoutMs: 100, intervalMs: 20 });
  await vi.advanceTimersByTimeAsync(100);
  expect((await promise).status).toBe('link-delayed');
  expect(vi.getTimerCount()).toBe(0);
});
