// @vitest-environment jsdom
/**
 * @file `useZoom` rendered under jsdom with the bridge and storage injected through the hook's
 * ports. The routing and persistence helpers have direct tests in `use-zoom.test.ts`; this file
 * asserts what the hook owns: the registered guests map, re-applying a remembered level, and
 * routing the menu command to the live target.
 */
import assert from 'node:assert/strict';
import { renderHook } from '@testing-library/react';
import { afterEach, test } from 'vitest';
import { useZoom, type ZoomableGuest, type ZoomBridge, type ZoomDirection } from '../use-zoom.js';

const keyPrefix = 'host:zoom:';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); window.localStorage.clear(); });

/** An in-memory `Storage`. */
function memoryStorage(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed));
  return { items, storage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) } };
}

/** A bridge whose zoom command subscription the test fires by hand; the top window starts at 0. */
function zoomBridge() {
  let command: ((direction: ZoomDirection) => void) | null = null;
  let top = 0;
  const log: string[] = [];
  const bridge: ZoomBridge = {
    onZoomCommand: ({ listener }) => { command = listener; log.push('subscribe'); return () => log.push('unsubscribe'); },
    getZoomLevel: () => top,
    setZoomLevel: ({ level }) => { top = level; },
  };
  return { bridge, log, fire: (direction: ZoomDirection) => command!(direction), top: () => top };
}

function guest(level = 0): ZoomableGuest & { level: number } {
  return {
    level,
    getZoomLevel() { return this.level; },
    setZoomLevel(next: number) { this.level = next; },
    addEventListener() {},
    removeEventListener() {},
  };
}

test('a registered guest takes its remembered level, and the menu zooms the visible guest and persists it', () => {
  const fake = zoomBridge();
  const store = memoryStorage({ 'host:zoom:/a': '1.5' });
  let active: string | null = '/a';
  const hook = renderHook(() => useZoom({ activeGuestId: active, bridge: fake.bridge, keyPrefix }, { storage: store.storage }));
  const a = guest();
  hook.result.current.registerGuest('/a', a);
  assert.equal(a.level, 1.5);
  fake.fire('in');
  assert.equal(a.level, 2);
  assert.equal(store.items.get('host:zoom:/a'), '2');
  assert.equal(fake.top(), 0, 'the shell window is untouched while a guest is on screen');

  active = null;
  hook.rerender();
  assert.deepEqual(fake.log, ['subscribe', 'unsubscribe', 'subscribe'], 'a new active target re-subscribes');
  fake.fire('out');
  assert.equal(fake.top(), -0.5, 'the window\'s own screen zooms the shell window');
  assert.equal(a.level, 2);
  hook.unmount();
});

test('a deregistered guest is no longer a target; the command falls back to the shell window', () => {
  const fake = zoomBridge();
  const store = memoryStorage();
  const hook = renderHook(() => useZoom({ activeGuestId: '/a', bridge: fake.bridge, keyPrefix }, { storage: store.storage }));
  const a = guest(1);
  hook.result.current.registerGuest('/a', a);
  assert.equal(a.level, 0, 'no remembered level: a fresh guest starts at actual size');
  hook.result.current.registerGuest('/a', null);
  fake.fire('in');
  assert.equal(a.level, 0);
  assert.equal(fake.top(), 0.5);
  hook.unmount();
});

test('with no bridge the hook subscribes to nothing, and defaults to the window\'s own localStorage', () => {
  window.localStorage.setItem('host:zoom:/b', '-1');
  const hook = renderHook(() => useZoom({ activeGuestId: '/b', bridge: undefined, keyPrefix }));
  const b = guest();
  hook.result.current.registerGuest('/b', b);
  assert.equal(b.level, -1);
  hook.unmount();
});

test('a window whose localStorage getter throws still renders, and zoom still works for the session', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  let reads = 0;
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { reads += 1; throw new Error('SecurityError: storage denied'); } });
  cleanups.push(() => { if (original) Object.defineProperty(window, 'localStorage', original); });
  const fake = zoomBridge();
  const hook = renderHook(() => useZoom({ activeGuestId: '/c', bridge: fake.bridge, keyPrefix }));
  assert.equal(reads, 0, 'rendering never touches storage');
  const c = guest(2);
  hook.result.current.registerGuest('/c', c);
  assert.equal(c.level, 0, 'nothing remembered is readable, so the guest starts at actual size');
  fake.fire('in');
  assert.equal(c.level, 0.5, 'the command still zooms the visible guest');
  assert.ok(reads >= 2, 'storage is resolved lazily at the read and the write, each failure swallowed');
  hook.unmount();
});

test('unmounting drops the zoom command subscription', () => {
  const fake = zoomBridge();
  const hook = renderHook(() => useZoom({ activeGuestId: '/a', bridge: fake.bridge, keyPrefix }, { storage: memoryStorage().storage }));
  assert.deepEqual(fake.log, ['subscribe']);
  hook.unmount();
  assert.deepEqual(fake.log, ['subscribe', 'unsubscribe']);
});
