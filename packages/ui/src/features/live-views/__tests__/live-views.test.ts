import assert from 'node:assert/strict';
import { test, vi, afterEach } from 'vitest';

import {
  liveViewOrder,
  parseReleaseProbe,
  probeRelease,
  releaseCandidates,
  releaseExcessViews,
  restoreParkedScroll,
  scrollScript,
} from '../../../core.js';

const script = 'guest release probe';
const innerScroller = '#scroll-content';

afterEach(() => vi.useRealTimers());

test('the focused tab leads the live order, closed tabs drop out, the rest keep their recency', () => {
  assert.deepEqual(liveViewOrder({ order: ['b', 'a', 'c'], focusedId: 'c', openIds: ['a', 'b', 'c'] }), ['c', 'b', 'a']);
  assert.deepEqual(liveViewOrder({ order: ['b', 'a'], focusedId: 'd', openIds: ['a', 'b', 'd'] }), ['d', 'b', 'a'], 'a newly focused tab joins at the front');
  assert.deepEqual(liveViewOrder({ order: ['b', 'a'], focusedId: null, openIds: ['a'] }), ['a'], 'outside Websites nothing is focused; b was closed');
  assert.deepEqual(liveViewOrder({ order: [], focusedId: 'gone', openIds: ['a'] }), [], 'a focus on a tab that is not open is no tab');
});

test('nothing is released at or under the limit; over it, hidden tabs are offered least recently focused first', () => {
  assert.deepEqual(releaseCandidates({ order: ['b', 'a'], focusedId: 'b', limit: 2 }), { candidates: [], excess: 0 });
  assert.deepEqual(releaseCandidates({ order: ['c', 'b', 'a'], focusedId: 'c', limit: 2 }), { candidates: ['a', 'b'], excess: 1 });
  assert.deepEqual(releaseCandidates({ order: ['c', 'b', 'a'], focusedId: null, limit: 1 }), { candidates: ['a', 'b', 'c'], excess: 2 }, 'with nothing on screen every tab is hidden');
});

test('only an explicit yes releases, and only a web url is kept as the route to restore', () => {
  for (const value of [null, undefined, 'yes', 1, {}, { release: 'true' }, { release: false, url: 'http://127.0.0.1:4100/' }]) {
    assert.deepEqual(parseReleaseProbe({ value }), { release: false, parked: null }, JSON.stringify(value));
  }
  assert.deepEqual(parseReleaseProbe({ value: { release: true, url: 'http://127.0.0.1:4100/admin/posts', x: 1, y: 2, innerY: 3 } }), {
    release: true, parked: { url: 'http://127.0.0.1:4100/admin/posts', x: 1, y: 2, innerY: 3 },
  });
  assert.deepEqual(parseReleaseProbe({ value: { release: true, url: 'http://127.0.0.1:4100/', y: 'far', innerY: Number.POSITIVE_INFINITY } }), {
    release: true, parked: { url: 'http://127.0.0.1:4100/', x: 0, y: 0, innerY: 0 },
  }, 'a scroll that is not a finite number restores to the top');
  for (const url of ['chrome-error://chromewebdata/', 'javascript:alert(1)', 'not a url', 42]) {
    assert.deepEqual(parseReleaseProbe({ value: { release: true, url } }), { release: true, parked: null }, String(url));
  }
});

const guestAnswering = (answer: () => Promise<unknown>) => ({ executeJavaScript: answer });

test('a tab with no guest is released at once; a guest that throws, rejects or never answers is kept', async () => {
  assert.deepEqual(await probeRelease({ guest: null, script }), { release: true, parked: null });
  assert.deepEqual(await probeRelease({ guest: guestAnswering(() => { throw new Error('not attached'); }), script }), { release: false, parked: null });
  assert.deepEqual(await probeRelease({ guest: guestAnswering(() => Promise.reject(new Error('gone'))), script }), { release: false, parked: null });
  vi.useFakeTimers();
  const pending = probeRelease({ guest: guestAnswering(() => new Promise(() => {})), script }, { timeoutMs: 50 });
  vi.advanceTimersByTime(50);
  assert.deepEqual(await pending, { release: false, parked: null });
});

test('the probe is the supplied script, and its yes comes back with the route', async () => {
  vi.useFakeTimers();
  const scripts: string[] = [];
  const guest = { executeJavaScript: async (code: string) => { scripts.push(code); return { release: true, url: 'http://127.0.0.1:4100/about' }; } };
  assert.deepEqual(await probeRelease({ guest, script }), { release: true, parked: { url: 'http://127.0.0.1:4100/about', x: 0, y: 0, innerY: 0 } });
  assert.deepEqual(scripts, [script]);
  assert.equal(vi.getTimerCount(), 0);
});

test('releasing stops once enough agreed, and a veto moves on to the next candidate', async () => {
  const asked: string[] = [];
  const guestOf = ({ id }: { id: string }) => ({
    executeJavaScript: async () => { asked.push(id); return { release: id !== 'a' }; },
  });
  assert.deepEqual(await releaseExcessViews({ candidates: ['a', 'b', 'c'], excess: 1, guestOf, script }), [{ id: 'b', parked: null }]);
  assert.deepEqual(asked, ['a', 'b'], 'c was never asked: one release was enough');
});

test('the scroll script carries only numbers', () => {
  const script = scrollScript({ innerScroller, parked: { url: 'http://127.0.0.1:4100/', x: 5, y: Number.NaN, innerY: 300 } });
  assert.match(script, /window\.scrollTo\(5, 0\)/);
  assert.match(script, /inner\.scrollTop = 300;/);
  assert.doesNotMatch(script, /NaN/);
  assert.ok(script.includes(`document.querySelector(${JSON.stringify(innerScroller)})`));
  assert.match(script, /\+\+tries < 30/);
  assert.match(script, /setTimeout\(step, 100\)/);
});

test('a restored guest gets its scroll back on its first finished load only, and a teardown detaches it', () => {
  const listeners = new Map<string, () => void>();
  const scripts: string[] = [];
  const guest = {
    addEventListener: (event: string, listener: () => void) => { listeners.set(event, listener); },
    removeEventListener: (event: string, listener: () => void) => { if (listeners.get(event) === listener) listeners.delete(event); },
    executeJavaScript: async (code: string) => { scripts.push(code); },
  };
  const parked = { url: 'http://127.0.0.1:4100/admin/posts', x: 0, y: 0, innerY: 120 };
  assert.equal(restoreParkedScroll({ guest: null, parked, innerScroller }), undefined);
  assert.equal(restoreParkedScroll({ guest, parked: undefined, innerScroller }), undefined);
  const teardown = restoreParkedScroll({ guest, parked, innerScroller });
  listeners.get('did-finish-load')!();
  assert.equal(listeners.has('did-finish-load'), false);
  assert.deepEqual(scripts, [scrollScript({ parked, innerScroller })]);
  restoreParkedScroll({ guest, parked, innerScroller });
  assert.ok(listeners.has('did-finish-load'));
  teardown?.();
  assert.ok(listeners.has('did-finish-load'), 'a stale teardown does not detach a newer listener');
});

test('a failed scroll restore is reported, except when the guest was closed mid-restore', async () => {
  const parked = { url: 'http://127.0.0.1:4100/a', x: 0, y: 10, innerY: 0 };
  const run = async (error: unknown) => {
    let onLoad: (() => void) | undefined;
    const guest = {
      executeJavaScript: () => Promise.reject(error),
      addEventListener: (_type: 'did-finish-load', listener: () => void) => { onLoad = listener; },
      removeEventListener: () => { onLoad = undefined; },
    };
    const reported: unknown[] = [];
    restoreParkedScroll({ guest, parked, innerScroller: 'main' }, { report: ({ error: e }) => reported.push(e) });
    onLoad?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return reported;
  };
  const failure = new Error('script threw');
  assert.deepEqual(await run(failure), [failure]);
  assert.deepEqual(await run('plain string'), ['plain string']);
  assert.deepEqual(await run(new Error('WebContents was destroyed')), []);
  assert.deepEqual(await run(new Error('The WebView is Not Attached to the DOM')), []);
});
