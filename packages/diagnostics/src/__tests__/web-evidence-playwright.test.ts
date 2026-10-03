import { test, expect } from 'vitest';
import { openPlaywrightSiteEvidenceBrowser, type PlaywrightLike } from '../web-evidence/playwright-browser.js';
import type { ObservePageRequest } from '../web-evidence/browser-port.js';
const request: ObservePageRequest = { url: 'https://example.com/', originBaseUrl: 'https://example.com', collectAccessibility: true, timeoutMs: 100, maxTextExcerptChars: 100, maxCookies: 2, maxRequests: 2, maxAccessibilityNodesPerCategory: 2, maxContrastSamples: 2 };
test('missing optional module and missing binary are explicit availability results', async () => {
 const missing = await openPlaywrightSiteEvidenceBrowser({}, { moduleLoader: { load: async () => { throw new Error('module absent'); } } });
 expect(missing.available).toBe(false);
 if (!missing.available) expect(missing.reason).toContain('module absent');
 const unavailable = await openPlaywrightSiteEvidenceBrowser({}, { moduleLoader: { load: async () => ({ chromium: { launch: async () => { throw new Error('binary absent'); } } }) } });
 expect(unavailable.available).toBe(false);
 if (!unavailable.available) expect(unavailable.reason).toContain('binary absent');
});
test('fresh context, read-only requests, cookie-value omission and teardown work without a browser install', async () => {
 let routeHandler: ((route: any) => Promise<void> | void) | undefined; const calls: string[] = [];
 const loader: PlaywrightLike = { chromium: { launch: async () => ({
  close: async () => { calls.push('browser-close'); },
  newContext: async options => {
   expect(options).toEqual({ ignoreHTTPSErrors: false }); calls.push('context');
   return { close: async () => { calls.push('context-close'); }, route: async (_pattern, handler) => { routeHandler = handler; },
    cookies: async () => [{ name: 'session', value: 'DO-NOT-EXPOSE', domain: 'example.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' }],
    newPage: async () => ({
     goto: async () => {
      for (const method of ['GET', 'POST']) await routeHandler!({ request: () => ({ method: () => method, url: () => 'https://example.com/a?token=hidden', resourceType: () => 'fetch' }), abort: async () => { calls.push('abort'); }, continue: async () => { calls.push('continue'); } });
      return { status: () => 200, url: () => request.url, headers: () => ({ 'content-type': 'text/html' }) };
     }, evaluate: async <T,>() => ({ title: 'Fixture', lang: 'en', textExcerpt: 'hello', textTruncated: false, accessibility: { landmarks: [], headings: [], images: [], formControls: [], contrastSamples: [], truncated: [] } }) as T,
     locator: () => { throw new Error('no consent action supplied'); }, waitForTimeout: async () => {}, title: async () => 'Fixture',
    }),
   };
  },
 }) } };
 const availability = await openPlaywrightSiteEvidenceBrowser({}, { moduleLoader: { load: async () => loader } });
 expect(availability.available).toBe(true); if (!availability.available) throw new Error(availability.reason);
 const result = await availability.browser.observe(request);
 expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.reason);
 expect(JSON.stringify(result.observation)).not.toContain('DO-NOT-EXPOSE');
 expect(result.observation.cookies[0]).toEqual({ name: 'session', domain: 'example.com', path: '/', expiresAt: null, secure: true, httpOnly: true, sameSite: 'Lax', firstParty: true, phase: 'before' });
 expect(result.observation.requests.map(r => [r.method, r.pathname, !!r.blockedReason])).toEqual([['GET', '/a', false], ['POST', '/a', true]]);
 await availability.browser.close({});
 expect(calls).toEqual(['context', 'continue', 'abort', 'context-close', 'browser-close']);
});
