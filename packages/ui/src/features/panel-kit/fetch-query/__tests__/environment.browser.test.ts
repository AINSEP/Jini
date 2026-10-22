/**
 * Direct tests for the browser FetchQuery environment adapter: online state, online/offline and
 * focus/visibility subscriptions, and that every unsubscribe removes exactly what it added.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { browserFetchQueryEnvironment as env } from '../environment.browser.js';

const originalOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
const originalVisibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
function setOnLine(value: boolean) { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value }); }
function setVisibility(value: DocumentVisibilityState) { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value }); }

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).onLine;
  delete (document as unknown as Record<string, unknown>).visibilityState;
  expect(Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')).toEqual(originalOnLine);
  expect(Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')).toEqual(originalVisibility);
});

describe('browserFetchQueryEnvironment', () => {
  it('reads online state from navigator.onLine, treating only an explicit false as offline', () => {
    setOnLine(true);
    expect(env.isOnline()).toBe(true);
    setOnLine(false);
    expect(env.isOnline()).toBe(false);
  });

  it('reports online/offline window events until unsubscribed', () => {
    const seen: boolean[] = [];
    const unsubscribe = env.subscribeOnline({ listener: (online) => seen.push(online) });
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    unsubscribe();
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    expect(seen).toEqual([false, true]);
  });

  it('fires on window focus and on visibilitychange to visible only, until unsubscribed', () => {
    let calls = 0;
    const unsubscribe = env.subscribeFocus({ listener: () => { calls++; } });
    window.dispatchEvent(new Event('focus'));
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toBe(1);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toBe(2);
    unsubscribe();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toBe(2);
  });
});
