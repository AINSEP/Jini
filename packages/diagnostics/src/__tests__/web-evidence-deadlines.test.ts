import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPageEvidence, SITE_EVIDENCE_LIMITS } from '../web-evidence/collect-page-evidence.js';
import { openPlaywrightSiteEvidenceBrowser, type PlaywrightLike } from '../web-evidence/playwright-browser.js';
import type { ObservePageRequest, PageObservation } from '../web-evidence/browser-port.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });



const observation: PageObservation = {
  document: { httpStatus: 200, finalUrl: 'https://example.test/', redirected: false, title: 'Fixture', lang: 'en', headers: [], textExcerpt: '', textTruncated: false },
  cookies: [], requests: [], notes: [],
};
const request: ObservePageRequest = {
  url: 'https://example.test/', originBaseUrl: 'https://example.test', collectAccessibility: true,
  timeoutMs: 100, maxTextExcerptChars: 100, maxCookies: 2, maxRequests: 2,
  maxAccessibilityNodesPerCategory: 2, maxContrastSamples: 2,
};

it('a page timeout permits the next page and bounds stalled browser cleanup', async () => {
  const observe = vi.fn(async (request: ObservePageRequest) => request.url.endsWith('/slow')
    ? new Promise<never>(() => {})
    : { ok: true as const, observation });
  const close = vi.fn(() => new Promise<void>(() => {}));
  const promise = collectPageEvidence({
    workspaceId: 'workspace', paths: ['/slow', '/'],
    originRegistry: { canonicalOrigin: async () => ({ scheme: 'https', host: 'example.test', verifiedAt: '', source: 'host' }) },
    openBrowser: async () => ({ available: true, browser: { observe, close } }),
    observationPolicy: { redactObservation: ({ observation }) => observation, redactMessage: ({ message }) => message },
  });
  await vi.advanceTimersByTimeAsync(SITE_EVIDENCE_LIMITS.maxTotalMs);
  const result = await promise;
  expect(result.pages.map(({ path }) => path)).toEqual(['/']);
  expect(result.skipped).toEqual([{ path: '/slow', reason: 'navigation-failed', message: 'page work timed out after 15000ms' }]);
  expect(observe).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('caps a stalled adapter by the remaining call budget and skips subsequent pages', async () => {
  const close = vi.fn(async () => {});
  const observe = vi.fn((_request: ObservePageRequest) => new Promise<never>(() => {}));
  const startedAt = Date.now();
  const resultPromise = collectPageEvidence({
    workspaceId: 'workspace', paths: ['/slow', '/later'],
    originRegistry: { canonicalOrigin: async () => ({ scheme: 'https', host: 'example.test', verifiedAt: '', source: 'host' }) },
    openBrowser: async () => {
      vi.setSystemTime(startedAt + SITE_EVIDENCE_LIMITS.maxTotalMs - 100);
      return { available: true, browser: { observe, close } };
    },
    observationPolicy: { redactObservation: ({ observation }) => observation, redactMessage: ({ message }) => message },
  });
  await vi.advanceTimersByTimeAsync(100);
  const result = await resultPromise;
  expect(observe).toHaveBeenCalledTimes(1);
  expect(observe.mock.calls[0]?.[0]?.timeoutMs).toBe(100);
  expect(result.pages).toEqual([]);
  expect(result.skipped.map(({ path, reason }) => [path, reason])).toEqual([['/slow', 'deadline'], ['/later', 'deadline']]);
  expect(close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['goto', 'evaluate', 'cookies', 'count', 'click', 'settle'] as const)(
  'bounds stalled %s work and closes its context without returning partial evidence', async (stalled) => {
    const close = vi.fn(async () => {});
    const pending = () => new Promise<never>(() => {});
    const locator = { first: () => locator, count: async () => stalled === 'count' ? pending() : 1, click: async () => stalled === 'click' ? pending() : undefined };
    const loader: PlaywrightLike = { chromium: { launch: async () => ({
      close: async () => {},
      newContext: async () => ({
        close, route: async () => {}, cookies: async () => stalled === 'cookies' ? pending() : [],
        newPage: async () => ({
          goto: async () => stalled === 'goto' ? pending() : { status: () => 200, url: () => request.url, headers: () => ({}) },
          evaluate: async <T,>() => stalled === 'evaluate' ? pending() : ({ ...observation.document }) as T,
          locator: () => locator, waitForTimeout: async () => stalled === 'settle' ? pending() : undefined, title: async () => 'Fixture',
        }),
      }),
    }) } };
    const available = await openPlaywrightSiteEvidenceBrowser({}, { moduleLoader: { load: async () => loader } });
    if (!available.available) throw new Error(available.reason);
    const resultPromise = available.browser.observe(request, ['count', 'click', 'settle'].includes(stalled) ? { consentAcceptSelector: '#accept' } : {});
    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('partial evidence escaped the timeout');
    expect(result.reason).toContain('100ms');
    expect(close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('charges navigation and evaluation against the consent click budget', async () => {
  const clickTimeouts: number[] = [];
  const close = vi.fn(async () => {});
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const locator = { first: () => locator, count: async () => 1, click: async (options?: { timeout?: number }) => { clickTimeouts.push(options!.timeout!); } };
  const loader: PlaywrightLike = { chromium: { launch: async () => ({ close: async () => {}, newContext: async () => ({
    close, route: async () => {}, cookies: async () => [], newPage: async () => ({
      goto: async () => { await delay(60); return { status: () => 200, url: () => request.url, headers: () => ({}) }; },
      evaluate: async <T,>() => { await delay(20); return { ...observation.document } as T; },
      locator: () => locator, waitForTimeout: delay, title: async () => 'Fixture',
    }),
  }) }) } };
  const available = await openPlaywrightSiteEvidenceBrowser({}, { moduleLoader: { load: async () => loader } });
  if (!available.available) throw new Error(available.reason);
  const promise = available.browser.observe(request, { consentAcceptSelector: '#accept' });
  await vi.advanceTimersByTimeAsync(100);
  const result = await promise;
  expect(clickTimeouts).toEqual([20]);
  expect(result.ok).toBe(false);
  expect(close).toHaveBeenCalledTimes(1);
});

it('releases a context that finishes opening after its page deadline', async () => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  const close = vi.fn(async () => {});
  const loader: PlaywrightLike = { chromium: { launch: async () => ({ close: async () => {}, newContext: async () => {
    await ready;
    return { close, route: async () => {}, cookies: async () => [], newPage: async () => { throw new Error('expired work must not create a page'); } };
  } }) } };
  const available = await openPlaywrightSiteEvidenceBrowser({}, { moduleLoader: { load: async () => loader } });
  if (!available.available) throw new Error(available.reason);
  const promise = available.browser.observe(request);
  await vi.advanceTimersByTimeAsync(100);
  expect(await promise).toEqual({ ok: false, reason: 'page capture failed before load: page work timed out after 100ms' });
  expect(close).not.toHaveBeenCalled();
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
