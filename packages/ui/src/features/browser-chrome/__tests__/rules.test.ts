import { describe, expect, it } from 'vitest';
import {
  canGoBack,
  canGoForward,
  faviconUrl,
  formatAddressDisplay,
  formatAddressDisplayParts,
  historyStorageKey,
  hostnameFromUrl,
  initialNavigationState,
  isHistoryEntry,
  isHistoryUrl,
  labelFromUrl,
  mergeHistoryEntry,
  normalizeBrowserAddress,
  parseHistoryPayload,
  recordNavigation,
  resolveNavigationHistoryDelta,
  sameUrl,
  serializeHistoryPayload,
  updateCurrentNavigationTitle,
} from '../rules.js';
import { EMPTY_URL, HISTORY_LIMIT } from '../constants.js';
import type { BrowserHistoryEntry, BrowserNavigationState } from '../types.js';

describe('normalizeBrowserAddress', () => {
  it('returns EMPTY_URL for blank input', () => {
    expect(normalizeBrowserAddress({ rawAddress: '' })).toBe(EMPTY_URL);
    expect(normalizeBrowserAddress({ rawAddress: '   ' })).toBe(EMPTY_URL);
    expect(normalizeBrowserAddress({ rawAddress: EMPTY_URL })).toBe(EMPTY_URL);
  });

  it('passes through http(s)/file URLs unchanged', () => {
    expect(normalizeBrowserAddress({ rawAddress: 'https://example.com' })).toBe('https://example.com');
    expect(normalizeBrowserAddress({ rawAddress: 'http://example.com' })).toBe('http://example.com');
    expect(normalizeBrowserAddress({ rawAddress: 'file:///tmp/x.html' })).toBe('file:///tmp/x.html');
  });

  it('adds http:// for localhost and loopback addresses', () => {
    expect(normalizeBrowserAddress({ rawAddress: 'localhost:3000' })).toBe('http://localhost:3000');
    expect(normalizeBrowserAddress({ rawAddress: '127.0.0.1:8080/x' })).toBe('http://127.0.0.1:8080/x');
    expect(normalizeBrowserAddress({ rawAddress: '0.0.0.0' })).toBe('http://0.0.0.0');
  });

  it('falls back to file:// for a bare absolute path with no app-route match configured', () => {
    expect(normalizeBrowserAddress({ rawAddress: '/some/local/path' })).toBe(`file://${encodeURI('/some/local/path')}`);
  });

  it('resolves an absolute path against appOrigin when it matches an appRoutePrefixes entry', () => {
    const result = normalizeBrowserAddress({ rawAddress: '/api/widgets' }, {
      appOrigin: 'https://host.example',
      appRoutePrefixes: ['api', 'artifacts'],
    });
    expect(result).toBe('https://host.example/api/widgets');
  });

  it('does not resolve against appOrigin when the path does not match a configured prefix', () => {
    const result = normalizeBrowserAddress({ rawAddress: '/other/path' }, {
      appOrigin: 'https://host.example',
      appRoutePrefixes: ['api'],
    });
    expect(result).toBe(`file://${encodeURI('/other/path')}`);
  });

  it('adds https:// for bare domains', () => {
    expect(normalizeBrowserAddress({ rawAddress: 'example.com' })).toBe('https://example.com');
    expect(normalizeBrowserAddress({ rawAddress: 'sub.example.co/path' })).toBe('https://sub.example.co/path');
  });

  it('falls back to a Google search for anything else', () => {
    expect(normalizeBrowserAddress({ rawAddress: 'best design tools' })).toBe(
      `https://www.google.com/search?q=${encodeURIComponent('best design tools')}`,
    );
  });
});

describe('labelFromUrl', () => {
  it('returns the home label for the empty URL', () => {
    expect(labelFromUrl({ url: EMPTY_URL })).toBe('New Tab');
    expect(labelFromUrl({ url: EMPTY_URL }, { homeLabel: 'Home' })).toBe('Home');
  });

  it('strips www. from the hostname', () => {
    expect(labelFromUrl({ url: 'https://www.example.com/path' })).toBe('example.com');
  });

  it('falls back to the raw url when the parsed hostname is empty (e.g. a file: url)', () => {
    expect(labelFromUrl({ url: 'file:///a.html' })).toBe('file:///a.html');
  });

  it('returns the raw value for an unparsable URL', () => {
    expect(labelFromUrl({ url: 'not a url' })).toBe('not a url');
  });
});

describe('formatAddressDisplayParts / formatAddressDisplay', () => {
  it('returns an empty url for the empty URL', () => {
    expect(formatAddressDisplayParts({ url: EMPTY_URL })).toEqual({ url: '' });
    expect(formatAddressDisplay({ url: EMPTY_URL })).toBe('');
  });

  it('omits the title when it matches the hostname fallback', () => {
    expect(formatAddressDisplayParts({ url: 'https://example.com/' }, { title: 'example.com' })).toEqual({ url: 'https://example.com/' });
  });

  it('keeps a distinct title, trimming a trailing slash from the url', () => {
    expect(formatAddressDisplayParts({ url: 'https://example.com/' }, { title: 'Example Site' })).toEqual({
      url: 'https://example.com',
      title: 'Example Site',
    });
    expect(formatAddressDisplay({ url: 'https://example.com/' }, { title: 'Example Site' })).toBe('https://example.com / Example Site');
  });
});

describe('hostnameFromUrl / sameUrl / isHistoryUrl / faviconUrl', () => {
  it('extracts a www-stripped hostname', () => {
    expect(hostnameFromUrl({ url: 'https://www.example.com/a/b' })).toBe('example.com');
    expect(hostnameFromUrl({ url: 'not a url' })).toBe('not a url');
  });

  it('compares urls ignoring trailing slashes', () => {
    expect(sameUrl({ left: 'https://example.com/', right: 'https://example.com' })).toBe(true);
    expect(sameUrl({ left: 'https://example.com/a', right: 'https://example.com/b' })).toBe(false);
  });

  it('classifies history-worthy urls', () => {
    expect(isHistoryUrl({ url: 'https://example.com' })).toBe(true);
    expect(isHistoryUrl({ url: 'file:///a.html' })).toBe(true);
    expect(isHistoryUrl({ url: EMPTY_URL })).toBe(false);
    expect(isHistoryUrl({ url: 'not-a-url' })).toBe(false);
  });

  it('builds a favicon url only for http(s) urls', () => {
    expect(faviconUrl({ url: 'https://example.com/page' })).toBe('https://example.com/favicon.ico');
    expect(faviconUrl({ url: 'file:///a.html' })).toBeUndefined();
    expect(faviconUrl({ url: 'not a url' })).toBeUndefined();
  });

  it('returns undefined rather than throwing for a malformed-but-http-prefixed url', () => {
    // Passes the `^https?://` prefix check but `new URL(...)` itself throws
    // ("Invalid URL") because there's no host — exercises faviconUrl's catch.
    expect(faviconUrl({ url: 'https://' })).toBeUndefined();
  });
});

describe('isHistoryEntry', () => {
  it('accepts a well-formed entry', () => {
    const entry: BrowserHistoryEntry = { title: 'A', url: 'https://a.com', lastVisitedAt: 1, visitCount: 1 };
    expect(isHistoryEntry(entry)).toBe(true);
    expect(isHistoryEntry({ ...entry, iconUrl: 'https://a.com/i.png' })).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isHistoryEntry(null)).toBe(false);
    expect(isHistoryEntry([])).toBe(false);
    expect(isHistoryEntry({ title: 'A' })).toBe(false);
    expect(isHistoryEntry({ title: 'A', url: 'x', lastVisitedAt: 'x', visitCount: 1 })).toBe(false);
  });
});

describe('historyStorageKey / parseHistoryPayload / serializeHistoryPayload', () => {
  it('namespaces by scope key', () => {
    expect(historyStorageKey({ namespace: 'jini:browser-chrome:history', scopeKey: 'project-1' })).toBe('jini:browser-chrome:history:project-1');
  });

  it('round-trips a history list, sorted by most-recent-first and capped at the limit', () => {
    const history: BrowserHistoryEntry[] = [
      { title: 'A', url: 'https://a.com', lastVisitedAt: 1, visitCount: 1 },
      { title: 'B', url: 'https://b.com', lastVisitedAt: 5, visitCount: 2 },
    ];
    const raw = serializeHistoryPayload({ history });
    expect(parseHistoryPayload({ raw })).toEqual([history[1], history[0]]);
  });

  it('caps at the given limit', () => {
    const history: BrowserHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
      title: `E${i}`,
      url: `https://e${i}.com`,
      lastVisitedAt: i,
      visitCount: 1,
    }));
    expect(parseHistoryPayload({ raw: serializeHistoryPayload({ history }, { limit: 5 }) }, { limit: 3 })).toHaveLength(3);
  });

  it('returns [] for malformed JSON or a non-array payload', () => {
    expect(parseHistoryPayload({ raw: 'not json' })).toEqual([]);
    expect(parseHistoryPayload({ raw: JSON.stringify({ not: 'an array' }) })).toEqual([]);
  });

  it('drops entries that fail the isHistoryEntry shape check', () => {
    const raw = JSON.stringify([{ title: 'A', url: 'https://a.com', lastVisitedAt: 1, visitCount: 1 }, { bogus: true }]);
    expect(parseHistoryPayload({ raw })).toHaveLength(1);
  });
});

describe('mergeHistoryEntry', () => {
  it('inserts a new entry at the front', () => {
    const result = mergeHistoryEntry({ history: [], url: 'https://a.com' }, { meta: { title: 'A Site' }, options: {}, now: 100 });
    expect(result).toEqual([{ title: 'A Site', url: 'https://a.com', lastVisitedAt: 100, visitCount: 1, iconUrl: 'https://a.com/favicon.ico' }]);
  });

  it('bumps an existing entry to the front and increments visitCount', () => {
    const existing: BrowserHistoryEntry[] = [
      { title: 'B', url: 'https://b.com', lastVisitedAt: 1, visitCount: 1 },
      { title: 'A', url: 'https://a.com', lastVisitedAt: 2, visitCount: 3 },
    ];
    const result = mergeHistoryEntry({ history: existing, url: 'https://b.com' }, { meta: {}, options: {}, now: 500 });
    expect(result[0]).toMatchObject({ url: 'https://b.com', lastVisitedAt: 500, visitCount: 2 });
    expect(result[1]).toMatchObject({ url: 'https://a.com' });
  });

  it('does not bump lastVisitedAt/visitCount when countVisit is false', () => {
    const existing: BrowserHistoryEntry[] = [{ title: 'A', url: 'https://a.com', lastVisitedAt: 10, visitCount: 1 }];
    const result = mergeHistoryEntry({ history: existing, url: 'https://a.com' }, { meta: { title: 'Renamed' }, options: { countVisit: false }, now: 999 });
    expect(result[0]).toMatchObject({ lastVisitedAt: 10, visitCount: 1, title: 'Renamed' });
  });

  it('returns the same array reference when nothing changed', () => {
    const existing: BrowserHistoryEntry[] = [{ title: 'A', url: 'https://a.com', lastVisitedAt: 10, visitCount: 1, iconUrl: 'https://a.com/favicon.ico' }];
    const result = mergeHistoryEntry({ history: existing, url: 'https://a.com' }, { meta: { title: 'A' }, options: { countVisit: false }, now: 999 });
    expect(result).toBe(existing);
  });

  it('ignores non-history urls (e.g. about:blank)', () => {
    expect(mergeHistoryEntry({ history: [], url: EMPTY_URL })).toEqual([]);
  });

  it('drops an invalid iconUrl meta value in favor of the favicon fallback', () => {
    const result = mergeHistoryEntry({ history: [], url: 'https://a.com' }, { meta: { iconUrl: 'javascript:alert(1)' }, options: {}, now: 1 });
    expect(result[0]?.iconUrl).toBe('https://a.com/favicon.ico');
  });

  it('accepts a data:image/ iconUrl meta value as-is', () => {
    const result = mergeHistoryEntry({ history: [], url: 'https://a.com' }, { meta: { iconUrl: 'data:image/png;base64,abcd' }, options: {}, now: 1 });
    expect(result[0]?.iconUrl).toBe('data:image/png;base64,abcd');
  });

  it('omits iconUrl entirely when no meta/existing/favicon icon is available (e.g. a file: url)', () => {
    // New entry: no meta.iconUrl, no existing entry, and faviconUrl() returns
    // undefined for non-http(s) urls — nextIconUrl ends up undefined.
    const inserted = mergeHistoryEntry({ history: [], url: 'file:///a.html' }, { meta: {}, options: {}, now: 1 });
    expect(inserted[0]).not.toHaveProperty('iconUrl');

    // Existing entry, re-merged: same all-undefined sources, so the existing
    // (icon-less) entry's shape is preserved without adding an iconUrl key.
    const updated = mergeHistoryEntry({ history: inserted, url: 'file:///a.html' }, { meta: {}, options: {}, now: 2 });
    expect(updated[0]).not.toHaveProperty('iconUrl');
  });
});

describe('navigation stack', () => {
  it('initialNavigationState seeds a home entry for an empty/absent url', () => {
    expect(initialNavigationState({})).toEqual({
      addressValue: '',
      navigationIndex: 0,
      navigationStack: [{ title: 'New Tab', url: EMPTY_URL }],
      url: EMPTY_URL,
    });
  });

  it('initialNavigationState seeds a real entry for a valid initial url', () => {
    expect(initialNavigationState({}, { initialUrl: 'https://example.com', initialTitle: 'Example' })).toEqual({
      addressValue: 'https://example.com',
      navigationIndex: 0,
      navigationStack: [{ title: 'Example', url: 'https://example.com' }],
      url: 'https://example.com',
    });
  });

  it('initialNavigationState derives the title from the url when no initialTitle is given', () => {
    expect(initialNavigationState({}, { initialUrl: 'https://example.com' })).toEqual({
      addressValue: 'https://example.com',
      navigationIndex: 0,
      navigationStack: [{ title: 'example.com', url: 'https://example.com' }],
      url: 'https://example.com',
    });
  });

  it('recordNavigation appends a new entry and truncates forward history', () => {
    let state: BrowserNavigationState = { navigationStack: [{ title: 'Home', url: EMPTY_URL }], navigationIndex: 0 };
    state = recordNavigation({ state, url: 'https://a.com' }, { title: 'A' });
    state = recordNavigation({ state, url: 'https://b.com' }, { title: 'B' });
    expect(state.navigationStack.map((e) => e.url)).toEqual([EMPTY_URL, 'https://a.com', 'https://b.com']);
    expect(state.navigationIndex).toBe(2);

    // Going back then navigating somewhere new truncates the forward entry.
    const back = resolveNavigationHistoryDelta({ state, delta: -1 })!;
    state = recordNavigation({ state: back.state, url: 'https://c.com' }, { title: 'C' });
    expect(state.navigationStack.map((e) => e.url)).toEqual([EMPTY_URL, 'https://a.com', 'https://c.com']);
  });

  it('recordNavigation is a no-op for a non-empty, non-history url', () => {
    const state: BrowserNavigationState = { navigationStack: [{ title: 'A', url: 'https://a.com' }], navigationIndex: 0 };
    expect(recordNavigation({ state, url: 'not a url' })).toBe(state);
  });

  it('recordNavigation falls back through existing.title when a caller-supplied empty-string homeLabel makes nextTitle falsy', () => {
    // `options.homeLabel ?? DEFAULT...` only replaces a *nullish* homeLabel —
    // an explicit `''` survives as nextTitle, which is falsy, so updateEntry
    // must fall back to the existing entry's title rather than blanking it.
    const state: BrowserNavigationState = {
      navigationStack: [{ title: 'Custom Home', url: EMPTY_URL }],
      navigationIndex: 0,
    };
    const result = recordNavigation({ state, url: EMPTY_URL }, { title: undefined, options: { homeLabel: '' } });
    expect(result.navigationStack).toEqual([{ title: 'Custom Home', url: EMPTY_URL }]);
  });

  it('recordNavigation falls all the way through to labelFromUrl when both nextTitle and the existing entry title are falsy', () => {
    // Degenerate-but-reachable case (a malformed existing entry with title:
    // '', combined with an explicit empty homeLabel): exercises updateEntry's
    // final `labelFromUrl(url, options.homeLabel)` fallback rather than just
    // the `existing?.title` one above.
    const state: BrowserNavigationState = {
      navigationStack: [{ title: '', url: EMPTY_URL }],
      navigationIndex: 0,
    };
    const result = recordNavigation({ state, url: EMPTY_URL }, { title: undefined, options: { homeLabel: '' } });
    expect(result.navigationStack).toEqual([{ title: '', url: EMPTY_URL }]);
  });

  it('recordNavigation updates the current entry in place for the same url', () => {
    let state: BrowserNavigationState = { navigationStack: [{ title: 'A', url: 'https://a.com' }], navigationIndex: 0 };
    state = recordNavigation({ state, url: 'https://a.com/' }, { title: 'A renamed' });
    expect(state.navigationStack).toEqual([{ title: 'A renamed', url: 'https://a.com/' }]);
  });

  it('recordNavigation rejoins an adjacent back/forward entry instead of duplicating it', () => {
    const state: BrowserNavigationState = {
      navigationStack: [{ title: 'A', url: 'https://a.com' }, { title: 'B', url: 'https://b.com' }],
      navigationIndex: 1,
    };
    const back = resolveNavigationHistoryDelta({ state, delta: -1 })!;
    const result = recordNavigation({ state: back.state, url: 'https://a.com' });
    expect(result.navigationStack).toHaveLength(2);
    expect(result.navigationIndex).toBe(0);
  });

  it('recordNavigation rejoins the previous-index entry when its url matches, without going through resolveNavigationHistoryDelta first', () => {
    // Full 3-entry stack, current pointer sitting on the last entry (as if the
    // host's webview already rendered B) — a navigation event now reports a
    // url matching the entry one BEHIND the pointer (A), which should move the
    // pointer back onto A in place, not push a 4th stack entry.
    const state: BrowserNavigationState = {
      navigationStack: [
        { title: 'Home', url: EMPTY_URL },
        { title: 'A', url: 'https://a.com' },
        { title: 'B', url: 'https://b.com' },
      ],
      navigationIndex: 2,
    };
    const result = recordNavigation({ state, url: 'https://a.com' }, { title: 'A renamed' });
    expect(result.navigationStack).toHaveLength(3);
    expect(result.navigationIndex).toBe(1);
    expect(result.navigationStack[1]).toEqual({ title: 'A renamed', url: 'https://a.com' });
    // B (the entry that was current before this rejoin) survives untouched —
    // this is an in-place pointer move, not a truncation.
    expect(result.navigationStack[2]).toEqual({ title: 'B', url: 'https://b.com' });
  });

  it('recordNavigation rejoins the next-index entry when its url matches (e.g. navigating forward again after an out-of-band back)', () => {
    // Pointer sitting on Home (index 0) with the forward stack still intact —
    // as if the host went back once — and a navigation event now reports a
    // url matching the entry one AHEAD of the pointer (A). This should move
    // the pointer forward onto that same entry in place, not truncate B off
    // the stack the way a brand-new navigation to A would.
    const state: BrowserNavigationState = {
      navigationStack: [
        { title: 'Home', url: EMPTY_URL },
        { title: 'A', url: 'https://a.com' },
        { title: 'B', url: 'https://b.com' },
      ],
      navigationIndex: 0,
    };
    const result = recordNavigation({ state, url: 'https://a.com' }, { title: 'A renamed' });
    expect(result.navigationStack).toHaveLength(3);
    expect(result.navigationIndex).toBe(1);
    expect(result.navigationStack[1]).toEqual({ title: 'A renamed', url: 'https://a.com' });
    expect(result.navigationStack[2]).toEqual({ title: 'B', url: 'https://b.com' });
  });

  it('recordNavigation replaces the current entry in place when replacePendingTarget matches an optimistic pending url, even though the settled url differs', () => {
    // Mirrors the origin's navigateTo -> webview onNavigate flow: an
    // address-bar submit optimistically pushes a new stack entry for the
    // typed url (the "pending target"), then the real webview navigation
    // event reports back with the actual (redirected) url and asks to settle
    // into the SAME entry rather than push a second one. The settled url here
    // deliberately does NOT equal the current entry's url, so this only
    // passes through the `shouldReplacePending` branch, not the plain
    // same-url branch.
    const state: BrowserNavigationState = {
      navigationStack: [{ title: 'Home', url: EMPTY_URL }, { title: 'example.com', url: 'https://example.com' }],
      navigationIndex: 1,
    };
    const result = recordNavigation({ state, url: 'https://example.com/home' }, { title: 'Example Domain', options: {
      replacePendingTarget: true,
      pendingTarget: 'https://example.com',
    } });
    expect(result.navigationStack).toHaveLength(2);
    expect(result.navigationIndex).toBe(1);
    expect(result.navigationStack[1]).toEqual({ title: 'Example Domain', url: 'https://example.com/home' });
  });

  it('recordNavigation ignores replacePendingTarget when pendingTarget does not match the current entry', () => {
    const state: BrowserNavigationState = {
      navigationStack: [{ title: 'Home', url: EMPTY_URL }, { title: 'A', url: 'https://a.com' }],
      navigationIndex: 1,
    };
    // pendingTarget points somewhere other than the current entry, so this
    // should fall through to a normal append rather than an in-place update.
    const result = recordNavigation({ state, url: 'https://c.com' }, { title: 'C', options: {
      replacePendingTarget: true,
      pendingTarget: 'https://b.com',
    } });
    expect(result.navigationStack).toHaveLength(3);
    expect(result.navigationIndex).toBe(2);
  });

  it('recordNavigation titles a navigation to EMPTY_URL with the generic default when no homeLabel is supplied', () => {
    // 3-entry stack with the pointer on the LAST entry and no EMPTY_URL entry
    // adjacent to it, so this exercises a genuine append (not an
    // adjacent-entry rejoin) for the EMPTY_URL title-computation branch.
    const state: BrowserNavigationState = {
      navigationStack: [
        { title: 'Home', url: EMPTY_URL },
        { title: 'A', url: 'https://a.com' },
        { title: 'B', url: 'https://b.com' },
      ],
      navigationIndex: 2,
    };
    const result = recordNavigation({ state, url: EMPTY_URL });
    expect(result.navigationStack).toHaveLength(4);
    expect(result.navigationStack[3]).toEqual({ title: 'New Tab', url: EMPTY_URL });
  });

  it('recordNavigation honors a caller-supplied homeLabel for a navigation to EMPTY_URL (regression: this used to hardcode the generic default)', () => {
    const state: BrowserNavigationState = {
      navigationStack: [
        { title: 'Custom Home', url: EMPTY_URL },
        { title: 'A', url: 'https://a.com' },
        { title: 'B', url: 'https://b.com' },
      ],
      navigationIndex: 2,
    };
    const result = recordNavigation({ state, url: EMPTY_URL }, { title: undefined, options: { homeLabel: 'Custom Home' } });
    expect(result.navigationStack).toHaveLength(4);
    expect(result.navigationStack[3]).toEqual({ title: 'Custom Home', url: EMPTY_URL });
  });

  it('resolveNavigationHistoryDelta returns null at either end of the stack', () => {
    const state: BrowserNavigationState = { navigationStack: [{ title: 'A', url: 'https://a.com' }], navigationIndex: 0 };
    expect(resolveNavigationHistoryDelta({ state, delta: -1 })).toBeNull();
    expect(resolveNavigationHistoryDelta({ state, delta: 1 })).toBeNull();
  });

  it('canGoBack / canGoForward reflect the current index', () => {
    const state: BrowserNavigationState = {
      navigationStack: [{ title: 'A', url: 'a' }, { title: 'B', url: 'b' }, { title: 'C', url: 'c' }],
      navigationIndex: 1,
    };
    expect(canGoBack(state)).toBe(true);
    expect(canGoForward(state)).toBe(true);
    expect(canGoBack({ ...state, navigationIndex: 0 })).toBe(false);
    expect(canGoForward({ ...state, navigationIndex: 2 })).toBe(false);
  });

  it('updateCurrentNavigationTitle updates only the current entry', () => {
    const state: BrowserNavigationState = {
      navigationStack: [{ title: 'A', url: 'a' }, { title: 'B', url: 'b' }],
      navigationIndex: 1,
    };
    const result = updateCurrentNavigationTitle({ state }, { title: 'B renamed' });
    expect(result.navigationStack).toEqual([{ title: 'A', url: 'a' }, { title: 'B renamed', url: 'b' }]);
  });

  it('updateCurrentNavigationTitle is a no-op for a blank title', () => {
    const state: BrowserNavigationState = { navigationStack: [{ title: 'A', url: 'a' }], navigationIndex: 0 };
    expect(updateCurrentNavigationTitle({ state }, { title: '  ' })).toBe(state);
  });

  it('updateCurrentNavigationTitle is a no-op when navigationIndex points past the stack (defensive — a malformed state passed directly to this exported pure function)', () => {
    const state: BrowserNavigationState = { navigationStack: [], navigationIndex: 0 };
    expect(updateCurrentNavigationTitle({ state }, { title: 'X' })).toBe(state);
  });

  // recordNavigation is exported as a standalone pure function, so — unlike
  // useBrowserNavigationStack's fully-encapsulated internal state — any
  // caller can hand it a `BrowserNavigationState` with a `navigationIndex`
  // that doesn't actually correspond to a real stack entry. The following
  // cases exercise its defensive out-of-bounds handling directly.
  it('recordNavigation degrades gracefully when navigationIndex points past the end of the stack', () => {
    const state: BrowserNavigationState = {
      navigationStack: [{ title: 'A', url: 'https://a.com' }],
      navigationIndex: 5,
    };
    const result = recordNavigation({ state, url: 'https://z.com' }, { title: 'Z' });
    // previousIndex (4) has no real entry to rejoin, so this falls through to
    // an append, treating the out-of-range index as "past the end".
    expect(result.navigationStack.map((e) => e.url)).toEqual(['https://a.com', 'https://z.com']);
    expect(result.navigationIndex).toBe(1);
  });

  it('recordNavigation appends fresh (base []) when navigationIndex is negative and neither adjacent-index check matches', () => {
    const state: BrowserNavigationState = {
      navigationStack: [{ title: 'A', url: 'https://a.com' }],
      navigationIndex: -3,
    };
    const result = recordNavigation({ state, url: 'https://z.com' }, { title: 'Z' });
    expect(result.navigationStack).toEqual([{ title: 'Z', url: 'https://z.com' }]);
    expect(result.navigationIndex).toBe(0);
  });
});

it('HISTORY_LIMIT is a sane positive cap', () => {
  expect(HISTORY_LIMIT).toBeGreaterThan(0);
});

describe('normalizeBrowserAddress boundaries', () => {
  it('trims surrounding whitespace before classifying', () => {
    expect(normalizeBrowserAddress({ rawAddress: '  example.com  ' })).toBe('https://example.com');
  });

  it('matches the http(s)/file scheme case-insensitively', () => {
    expect(normalizeBrowserAddress({ rawAddress: 'HTTPS://Example.com' })).toBe('HTTPS://Example.com');
  });

  it('matches localhost case-insensitively and with a path', () => {
    expect(normalizeBrowserAddress({ rawAddress: 'LocalHost/x' })).toBe('http://LocalHost/x');
  });

  it('percent-encodes spaces in a file:// fallback path', () => {
    expect(normalizeBrowserAddress({ rawAddress: '/a b/c' })).toBe('file:///a%20b/c');
  });

  it('falls back to file:// when appOrigin is given without any appRoutePrefixes', () => {
    expect(normalizeBrowserAddress({ rawAddress: '/api/x' }, { appOrigin: 'https://host.example' })).toBe('file:///api/x');
  });

  it('falls back to file:// when appRoutePrefixes are given without an appOrigin', () => {
    expect(normalizeBrowserAddress({ rawAddress: '/api/x' }, { appRoutePrefixes: ['api'] })).toBe('file:///api/x');
  });

  it('resolves a bare prefix path with no trailing segment against appOrigin', () => {
    expect(normalizeBrowserAddress({ rawAddress: '/api' }, { appOrigin: 'https://host.example', appRoutePrefixes: ['api'] })).toBe(
      'https://host.example/api',
    );
  });

  it('does not treat a longer segment sharing the prefix as a match', () => {
    expect(normalizeBrowserAddress({ rawAddress: '/apix' }, { appOrigin: 'https://host.example', appRoutePrefixes: ['api'] })).toBe(
      'file:///apix',
    );
  });

  it('escapes regex metacharacters in a prefix so they match literally', () => {
    const options = { appOrigin: 'https://host.example', appRoutePrefixes: ['a.b'] };
    expect(normalizeBrowserAddress({ rawAddress: '/aXb/x' }, options)).toBe('file:///aXb/x');
  });

  it('matches a prefix containing a regex metacharacter literally', () => {
    const options = { appOrigin: 'https://host.example', appRoutePrefixes: ['a.b'] };
    expect(normalizeBrowserAddress({ rawAddress: '/a.b/x' }, options)).toBe('https://host.example/a.b/x');
  });

  it('treats a single-letter TLD as a search query', () => {
    expect(normalizeBrowserAddress({ rawAddress: 'foo.c' })).toBe('https://www.google.com/search?q=foo.c');
  });

  it('adds https:// to a bare domain with a port', () => {
    expect(normalizeBrowserAddress({ rawAddress: 'example.com:8080/p' })).toBe('https://example.com:8080/p');
  });
});

describe('formatAddressDisplay with a custom home label', () => {
  it('omits a title that equals the custom home label fallback for a host-less url', () => {
    expect(formatAddressDisplayParts({ url: 'file:///a.html' }, { title: 'file:///a.html', homeLabel: 'Home' })).toEqual({ url: 'file:///a.html' });
  });

  it('formats a distinct title with an explicit home label', () => {
    expect(formatAddressDisplay({ url: 'https://example.com/' }, { title: 'Site', homeLabel: 'Home' })).toBe('https://example.com / Site');
  });

  it('returns just the url when the title is blank', () => {
    expect(formatAddressDisplay({ url: 'https://example.com/' }, { title: '   ' })).toBe('https://example.com/');
  });
});

describe('mergeHistoryEntry boundaries', () => {
  it('keeps the existing title when the meta title is whitespace-only', () => {
    const existing: BrowserHistoryEntry[] = [{ title: 'Kept', url: 'https://a.com', lastVisitedAt: 1, visitCount: 1 }];
    expect(mergeHistoryEntry({ history: existing, url: 'https://a.com' }, { meta: { title: '   ' }, options: {}, now: 5 })[0]?.title).toBe('Kept');
  });

  it('trims a meta title', () => {
    expect(mergeHistoryEntry({ history: [], url: 'https://a.com' }, { meta: { title: '  T  ' }, options: {}, now: 5 })[0]?.title).toBe('T');
  });

  it('derives the title from the hostname when there is no meta or existing title', () => {
    expect(mergeHistoryEntry({ history: [], url: 'https://www.a.com/x' }, { meta: {}, options: {}, now: 5 })[0]?.title).toBe('a.com');
  });

  it('keeps the existing iconUrl when the meta iconUrl is invalid', () => {
    const existing: BrowserHistoryEntry[] = [
      { title: 'A', url: 'https://a.com', lastVisitedAt: 1, visitCount: 1, iconUrl: 'https://cdn.a.com/i.png' },
    ];
    const result = mergeHistoryEntry({ history: existing, url: 'https://a.com' }, { meta: { iconUrl: 'nope' }, options: {}, now: 5 });
    expect(result[0]?.iconUrl).toBe('https://cdn.a.com/i.png');
  });

  it('prefers a valid meta iconUrl over the existing one', () => {
    const existing: BrowserHistoryEntry[] = [
      { title: 'A', url: 'https://a.com', lastVisitedAt: 1, visitCount: 1, iconUrl: 'https://cdn.a.com/i.png' },
    ];
    const result = mergeHistoryEntry({ history: existing, url: 'https://a.com' }, { meta: { iconUrl: ' https://cdn.a.com/j.png ' }, options: {}, now: 5 });
    expect(result[0]?.iconUrl).toBe('https://cdn.a.com/j.png');
  });

  it('keeps an existing empty-string iconUrl when no other icon source exists (file: url)', () => {
    const existing: BrowserHistoryEntry[] = [{ title: 'F', url: 'file:///f', lastVisitedAt: 1, visitCount: 1, iconUrl: '' }];
    const result = mergeHistoryEntry({ history: existing, url: 'file:///f' }, { meta: {}, options: {}, now: 5 });
    expect(result[0]).toEqual({ title: 'F', url: 'file:///f', lastVisitedAt: 5, visitCount: 2, iconUrl: '' });
  });

  it('merges a trailing-slash variant into the existing entry, keeping the existing url', () => {
    const existing: BrowserHistoryEntry[] = [{ title: 'A', url: 'https://a.com/', lastVisitedAt: 1, visitCount: 1 }];
    const result = mergeHistoryEntry({ history: existing, url: 'https://a.com' }, { meta: {}, options: {}, now: 5 });
    expect(result).toEqual([
      { title: 'A', url: 'https://a.com/', lastVisitedAt: 5, visitCount: 2, iconUrl: 'https://a.com/favicon.ico' },
    ]);
  });

  it('returns a new array when only the iconUrl changes under countVisit false', () => {
    const existing: BrowserHistoryEntry[] = [{ title: 'A', url: 'https://a.com', lastVisitedAt: 1, visitCount: 1 }];
    const result = mergeHistoryEntry({ history: existing, url: 'https://a.com' }, { meta: { title: 'A' }, options: { countVisit: false }, now: 5 });
    expect(result).toEqual([
      { title: 'A', url: 'https://a.com', lastVisitedAt: 1, visitCount: 1, iconUrl: 'https://a.com/favicon.ico' },
    ]);
  });

  it('counts a revisit even when it lands on the same timestamp as the last visit', () => {
    const existing: BrowserHistoryEntry[] = [
      { title: 'A', url: 'https://a.com', lastVisitedAt: 5, visitCount: 1, iconUrl: 'https://a.com/favicon.ico' },
    ];
    expect(mergeHistoryEntry({ history: existing, url: 'https://a.com' }, { meta: {}, options: {}, now: 5 })[0]?.visitCount).toBe(2);
  });

  it('caps the merged list at HISTORY_LIMIT', () => {
    const existing: BrowserHistoryEntry[] = Array.from({ length: HISTORY_LIMIT }, (_, i) => ({
      title: `T${i}`,
      url: `https://s${i}.com`,
      lastVisitedAt: i,
      visitCount: 1,
    }));
    const result = mergeHistoryEntry({ history: existing, url: 'https://new.com' }, { meta: {}, options: {}, now: 5 });
    expect(result).toHaveLength(HISTORY_LIMIT);
  });

  it('puts the new entry first when capping at HISTORY_LIMIT', () => {
    const existing: BrowserHistoryEntry[] = Array.from({ length: HISTORY_LIMIT }, (_, i) => ({
      title: `T${i}`,
      url: `https://s${i}.com`,
      lastVisitedAt: i,
      visitCount: 1,
    }));
    const result = mergeHistoryEntry({ history: existing, url: 'https://new.com' }, { meta: {}, options: {}, now: 5 });
    expect(result[0]?.url).toBe('https://new.com');
  });
});

describe('recordNavigation boundaries', () => {
  const stackOf = (...urls: string[]): BrowserNavigationState => ({
    navigationStack: urls.map((url) => ({ title: url, url })),
    navigationIndex: urls.length - 1,
  });

  it('derives the title from the url when the given title is whitespace-only', () => {
    const result = recordNavigation({ state: stackOf('https://a.com'), url: 'https://www.b.com' }, { title: '   ' });
    expect(result.navigationStack[1]).toEqual({ title: 'b.com', url: 'https://www.b.com' });
  });

  it('trims a given title', () => {
    const result = recordNavigation({ state: stackOf('https://a.com'), url: 'https://b.com' }, { title: '  B  ' });
    expect(result.navigationStack[1]?.title).toBe('B');
  });

  it('replaces the current entry url with the new url when it matches only by trailing slash', () => {
    const result = recordNavigation({ state: stackOf('https://a.com/'), url: 'https://a.com' }, { title: 'A' });
    expect(result).toEqual({ navigationStack: [{ title: 'A', url: 'https://a.com' }], navigationIndex: 0 });
  });

  it('ignores a pendingTarget when replacePendingTarget is not set', () => {
    const result = recordNavigation({ state: stackOf('https://a.com'), url: 'https://b.com' }, { title: 'B', options: { pendingTarget: 'https://a.com' } });
    expect(result.navigationIndex).toBe(1);
  });

  it('ignores replacePendingTarget when there is no pendingTarget', () => {
    const result = recordNavigation({ state: stackOf('https://a.com'), url: 'https://b.com' }, { title: 'B', options: { replacePendingTarget: true } });
    expect(result.navigationIndex).toBe(1);
  });

  it('ignores replacePendingTarget with a null pendingTarget', () => {
    const result = recordNavigation({ state: stackOf('https://a.com'), url: 'https://b.com' }, { title: 'B', options: {
      replacePendingTarget: true,
      pendingTarget: null,
    } });
    expect(result.navigationIndex).toBe(1);
  });

  it('rejoins stack[0] from navigationIndex -1 via the next-index check', () => {
    const state: BrowserNavigationState = { navigationStack: [{ title: 'A', url: 'https://a.com' }], navigationIndex: -1 };
    expect(recordNavigation({ state, url: 'https://a.com' }, { title: 'A2' })).toEqual({
      navigationStack: [{ title: 'A2', url: 'https://a.com' }],
      navigationIndex: 0,
    });
  });

  it('caps the stack at HISTORY_LIMIT, dropping the oldest entry', () => {
    const urls = Array.from({ length: HISTORY_LIMIT }, (_, i) => `https://s${i}.com`);
    const result = recordNavigation({ state: stackOf(...urls), url: 'https://new.com' }, { title: 'N' });
    expect(result.navigationStack.map((e) => e.url)).toEqual([...urls.slice(1), 'https://new.com']);
  });

  it('points navigationIndex at the last entry after capping', () => {
    const urls = Array.from({ length: HISTORY_LIMIT }, (_, i) => `https://s${i}.com`);
    const result = recordNavigation({ state: stackOf(...urls), url: 'https://new.com' }, { title: 'N' });
    expect(result.navigationIndex).toBe(HISTORY_LIMIT - 1);
  });

  it('does not mutate the input stack when updating in place', () => {
    const state = stackOf('https://a.com');
    recordNavigation({ state, url: 'https://a.com' }, { title: 'Renamed' });
    expect(state.navigationStack[0]?.title).toBe('https://a.com');
  });

  it('labels a navigation to EMPTY_URL with the home label even when a title is given', () => {
    const result = recordNavigation({ state: stackOf('https://a.com'), url: EMPTY_URL }, { title: 'Ignored', options: { homeLabel: 'Start' } });
    expect(result.navigationStack[1]).toEqual({ title: 'Start', url: EMPTY_URL });
  });
});
