import { describe, expect, it } from 'vitest';
import * as browserChrome from '../index.js';

/**
 * A barrel-only smoke test: every other test in this feature imports from
 * the concrete module (`./rules.js`, `./dependencies.js`, etc.) rather than
 * `./index.js`, so nothing else actually loads/exercises this file's
 * re-export statements. Importing the barrel here both closes that coverage
 * gap and catches a real class of bug — a typo'd or missing re-export name
 * that unit tests hitting the concrete modules directly would never notice.
 */
describe('browser-chrome barrel (index.ts)', () => {
  it('re-exports the public constants', () => {
    expect(browserChrome.EMPTY_URL).toBe('about:blank');
    expect(browserChrome.HISTORY_LIMIT).toBeGreaterThan(0);
    expect(browserChrome.HISTORY_SAVE_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(browserChrome.DEFAULT_HISTORY_STORAGE_NAMESPACE).toEqual(expect.any(String));
    expect(browserChrome.DEFAULT_HOME_NAVIGATION_ENTRY).toEqual({ title: 'New Tab', url: 'about:blank' });
    expect(browserChrome.BROWSER_VIEWPORT_PRESETS.map((preset) => preset.id)).toEqual(['desktop', 'tablet', 'mobile']);
  });

  it('re-exports the pure rule functions', () => {
    expect(browserChrome.normalizeBrowserAddress({ rawAddress: 'example.com' })).toBe('https://example.com');
    expect(browserChrome.labelFromUrl({ url: 'https://example.com' })).toBe('example.com');
    expect(browserChrome.faviconUrl({ url: 'https://example.com' })).toBe('https://example.com/favicon.ico');
    expect(browserChrome.isHistoryUrl({ url: 'https://example.com' })).toBe(true);
    expect(browserChrome.sameUrl({ left: 'https://a.com/', right: 'https://a.com' })).toBe(true);
    expect(browserChrome.isHistoryEntry({ url: 'a', title: 'a', lastVisitedAt: 1, visitCount: 1 })).toBe(true);
    expect(browserChrome.historyStorageKey({ namespace: 'ns', scopeKey: 'scope' })).toBe('ns:scope');
    expect(browserChrome.hostnameFromUrl({ url: 'https://www.example.com' })).toBe('example.com');
    expect(browserChrome.formatAddressDisplay({ url: 'https://example.com' })).toBe('https://example.com');
    expect(browserChrome.formatAddressDisplayParts({ url: 'https://example.com' })).toEqual({ url: 'https://example.com' });
    expect(browserChrome.mergeHistoryEntry({ history: [], url: 'https://a.com' })).toHaveLength(1);
    expect(browserChrome.parseHistoryPayload({ raw: 'not json' })).toEqual([]);
    expect(browserChrome.serializeHistoryPayload({ history: [] })).toBe('[]');
    const initial = browserChrome.initialNavigationState({});
    expect(initial.navigationStack).toHaveLength(1);
    const recorded = browserChrome.recordNavigation(
      { state: { navigationStack: initial.navigationStack, navigationIndex: initial.navigationIndex }, url: 'https://a.com' },
    );
    expect(recorded.navigationStack).toHaveLength(2);
    expect(browserChrome.resolveNavigationHistoryDelta({ state: recorded, delta: -1 })).not.toBeNull();
    expect(browserChrome.updateCurrentNavigationTitle({ state: recorded }, { title: 'A' })).not.toBe(recorded);
    expect(browserChrome.canGoBack(recorded)).toBe(true);
    expect(browserChrome.canGoForward(recorded)).toBe(false);
  });

  it('re-exports the dependency factories and hooks/components as functions', () => {
    expect(typeof browserChrome.createBrowserHistoryStorage).toBe('function');
    expect(typeof browserChrome.createNoopBrowserBridgeRegistration).toBe('function');
    expect(typeof browserChrome.createDefaultBrowserChromeDependencies).toBe('function');
    expect(typeof browserChrome.useBrowserHistory).toBe('function');
    expect(typeof browserChrome.useWiredBrowserHistory).toBe('function');
    expect(typeof browserChrome.useBrowserNavigationStack).toBe('function');
    expect(typeof browserChrome.useBrowserBridgeRegistration).toBe('function');
    expect(typeof browserChrome.useWiredBrowserBridgeRegistration).toBe('function');
    expect(typeof browserChrome.BrowserViewportControls).toBe('function');
  });
});
