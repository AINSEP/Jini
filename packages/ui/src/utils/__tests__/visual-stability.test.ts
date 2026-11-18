// @vitest-environment node
//
// Runs under plain Node rather than this package's jsdom default so the
// `typeof window === 'undefined'` branch is genuinely exercised (jsdom
// always defines `window`) alongside the "window present" cases, which
// build a minimal hand-rolled localStorage double via `vi.stubGlobal`
// rather than switching environments per test — see notifications.test.ts's
// header comment for why this package avoids splitting one source file's
// tests across a jsdom file and a node-environment companion file.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VISUAL_STABILITY_STORAGE_KEY, isVisualStabilityMode } from '../visual-stability.js';

function fakeLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe('isVisualStabilityMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when window is entirely absent (Node default, no DOM at all)', () => {
    expect(isVisualStabilityMode({})).toBe(false);
  });

  it('returns false when the flag is unset', () => {
    vi.stubGlobal('window', { localStorage: fakeLocalStorage() });
    expect(isVisualStabilityMode({})).toBe(false);
  });

  it('returns true when the default key is set to "1"', () => {
    vi.stubGlobal('window', {
      localStorage: fakeLocalStorage({ [DEFAULT_VISUAL_STABILITY_STORAGE_KEY]: '1' }),
    });
    expect(isVisualStabilityMode({})).toBe(true);
  });

  it('returns false for any value other than exactly "1"', () => {
    vi.stubGlobal('window', {
      localStorage: fakeLocalStorage({ [DEFAULT_VISUAL_STABILITY_STORAGE_KEY]: 'true' }),
    });
    expect(isVisualStabilityMode({})).toBe(false);
  });

  it('honors a custom storage key', () => {
    vi.stubGlobal('window', { localStorage: fakeLocalStorage({ 'host:custom-key': '1' }) });
    expect(isVisualStabilityMode({}, { storageKey: 'host:custom-key' })).toBe(true);
    expect(isVisualStabilityMode({})).toBe(false);
  });

  it('returns false rather than throwing when localStorage access throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('access denied');
        },
      },
    });
    expect(isVisualStabilityMode({})).toBe(false);
  });
});
