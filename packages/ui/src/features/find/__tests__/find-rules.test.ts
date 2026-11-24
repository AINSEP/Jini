/**
 * @file Behavioural tests for the find feature's plain exports: the reducer, which target a search
 * routes to, and the (deliberately backwards) `findNext` semantics `runFind`/`stopFind` apply, each
 * called directly with fake guests/bridges. The composed hooks are rendered by the host's own
 * find-hook tests, with the bridge and clock injected.
 */
// @vitest-environment node
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { findBarReducer, formatFindMatchCount, initialFindBarState, shouldCloseOnGuestChange, type FindBarState } from '../find-bar-state.js';
import type { FindInPageResult } from '@jini-ai/core/contracts/find-in-page';
import { resolveFindTarget, runFind, stopFind, subscribeToFindResults, type FindableGuest, type FindBridge, type AnchorSelection } from '../find-target.js';
import { restoreFindInputFocus, shouldKeepReclaimingFindFocus, shouldReclaimFindFocus, FIND_FOCUS_RECLAIM_MS } from '../find-input-focus.js';

/** A `<webview>` stand-in that records every imperative call. */
function fakeGuest(options: { notAttached?: boolean } = {}): FindableGuest & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const ready = () => {
    if (options.notAttached) throw new Error('The WebView must be attached to the DOM');
  };
  return {
    calls,
    findInPage: (...args: unknown[]) => {
      ready();
      calls.push(['findInPage', ...args]);
      return 1;
    },
    stopFindInPage: (...args: unknown[]) => {
      ready();
      calls.push(['stopFindInPage', ...args]);
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

/** A host preload-bridge stand-in narrowed to the find slice. */
function fakeBridge(): FindBridge & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    onFindToggle: () => () => {},
    findInPage: async (query) => {
      calls.push(['findInPage', query]);
    },
    stopFindInPage: async () => {
      calls.push(['stopFindInPage']);
    },
    onFindResult: () => () => {},
  };
}

test('toggle opens the bar and bumps focusNonce, even when already open', () => {
  const opened = findBarReducer(initialFindBarState, { type: 'toggle' });
  assert.equal(opened.open, true);
  assert.equal(opened.focusNonce, 1);

  const reopened = findBarReducer(opened, { type: 'toggle' });
  assert.equal(reopened.open, true);
  assert.equal(reopened.focusNonce, 2, 'a repeat Cmd+F while already open must still bump the focus signal');
});

test('set-query to non-empty text keeps the last result; clearing to "" drops it', () => {
  const withResult: FindBarState = { open: true, query: 'foo', result: { activeMatchOrdinal: 2, matches: 5 }, focusNonce: 1 };

  const retyped = findBarReducer(withResult, { type: 'set-query', query: 'foobar' });
  assert.equal(retyped.query, 'foobar');
  assert.deepEqual(retyped.result, { activeMatchOrdinal: 2, matches: 5 });

  const cleared = findBarReducer(withResult, { type: 'set-query', query: '' });
  assert.equal(cleared.query, '');
  assert.equal(cleared.result, null);
});

test('result records whatever the target reported; close resets to the initial state', () => {
  const found = findBarReducer(initialFindBarState, { type: 'result', result: { activeMatchOrdinal: 1, matches: 3 } });
  assert.deepEqual(found.result, { activeMatchOrdinal: 1, matches: 3 });

  const closed = findBarReducer(found, { type: 'close' });
  assert.deepEqual(closed, initialFindBarState);
});

test('resolveFindTarget prefers the active guest when it is actually mounted', () => {
  const guest = fakeGuest();
  const target = resolveFindTarget({ activeGuestId: 'site-1', guests: new Map([['site-1', guest]]), bridge: fakeBridge() });
  assert.equal(target.kind, 'guest');
  assert.equal((target as { kind: 'guest'; element: FindableGuest }).element, guest);
});

test('resolveFindTarget falls back to top when the active guest id has no mounted element', () => {
  const target = resolveFindTarget({ activeGuestId: 'site-missing', guests: new Map(), bridge: fakeBridge() });
  assert.equal(target.kind, 'top');
});

test('resolveFindTarget is top with no active tab, and none with no bridge either', () => {
  assert.equal(resolveFindTarget({ activeGuestId: null, guests: new Map(), bridge: fakeBridge() }).kind, 'top');
  assert.equal(resolveFindTarget({ activeGuestId: null, guests: new Map(), bridge: undefined }).kind, 'none');
  assert.equal(resolveFindTarget({ activeGuestId: 'site-1', guests: new Map(), bridge: undefined }).kind, 'none');
});

test('shouldCloseOnGuestChange: true only when the bar is open AND the visible surface actually changed', () => {
  assert.equal(shouldCloseOnGuestChange({ previousGuestId: 'a', activeGuestId: 'a', open: true }), false, 'same tab, no-op');
  assert.equal(shouldCloseOnGuestChange({ previousGuestId: 'a', activeGuestId: 'b', open: true }), true, 'switched tabs while open');
  assert.equal(shouldCloseOnGuestChange({ previousGuestId: null, activeGuestId: 'a', open: true }), true, 'top-level page -> a tab, while open');
  assert.equal(shouldCloseOnGuestChange({ previousGuestId: 'a', activeGuestId: null, open: true }), true, 'a tab -> top-level page, while open');
  assert.equal(shouldCloseOnGuestChange({ previousGuestId: 'a', activeGuestId: 'b', open: false }), false, 'switched while already closed: nothing to close');
});

test('runFind on a guest target calls the guest directly, never the bridge', () => {
  const guest = fakeGuest();
  const bridge = fakeBridge();
  runFind({ target: { kind: 'guest', element: guest }, bridge, text: 'hello', options: { forward: true, findNext: true } });
  assert.deepEqual(guest.calls, [['findInPage', 'hello', { forward: true, findNext: true }]]);
  assert.deepEqual(bridge.calls, []);
});

test('runFind on a guest not yet attached to the DOM is swallowed, not thrown', () => {
  const guest = fakeGuest({ notAttached: true });
  assert.doesNotThrow(() => runFind({ target: { kind: 'guest', element: guest }, bridge: fakeBridge(), text: 'x', options: { forward: true, findNext: true } }));
});

test('runFind on the top target calls the bridge with the query merged into the options', () => {
  const bridge = fakeBridge();
  runFind({ target: { kind: 'top' }, bridge, text: 'hello', options: { forward: false, findNext: false } });
  assert.deepEqual(bridge.calls, [['findInPage', { text: 'hello', forward: false, findNext: false }]]);
});

/** Records the ORDER of a top-level find's two effects, since ordering is the whole point: the
 *  selection has to be gone by the time Chromium reads it. */
function orderedTopFind(): { bridge: FindBridge; selection: AnchorSelection; order: string[] } {
  const order: string[] = [];
  return {
    order,
    bridge: {
      onFindToggle: () => () => {},
      findInPage: async () => {
        order.push('findInPage');
      },
      stopFindInPage: async () => {
        order.push('stopFindInPage');
      },
      onFindResult: () => () => {},
    },
    selection: {
      removeAllRanges: () => {
        order.push('removeAllRanges');
      },
    },
  };
}

test('runFind on the top target clears the document selection BEFORE searching', () => {
  const { bridge, selection, order } = orderedTopFind();
  runFind({ target: { kind: 'top' }, bridge, text: 'hello', options: { forward: true, findNext: false } }, { selection });
  assert.deepEqual(order, ['removeAllRanges', 'findInPage'], 'a selection still present when Chromium reads it re-anchors the search on the find bar itself');
});

test('runFind on a guest target ALSO clears the host selection first', () => {
  const { selection, order } = orderedTopFind();
  const guest = fakeGuest();
  runFind({ target: { kind: 'guest', element: guest }, bridge: undefined, text: 'hello', options: { forward: true, findNext: false } }, { selection });
  // Not belt-and-braces: Chromium serves a guest's find from the WINDOW's find manager once that
  // manager exists, and a rerouted search anchors on THIS frame's selection — the find bar's own
  // caret. See `find-target.ts`'s header for the measurement.
  assert.deepEqual(order, ['removeAllRanges'], 'the host selection must be gone before a guest search too');
  assert.deepEqual(guest.calls, [['findInPage', 'hello', { forward: true, findNext: false }]]);
});

test('runFind on the top target with no bridge does not clear the selection either', () => {
  const { selection, order } = orderedTopFind();
  runFind({ target: { kind: 'top' }, bridge: undefined, text: 'hello', options: { forward: true, findNext: false } }, { selection });
  assert.deepEqual(order, [], 'no search to anchor, so nothing to clear');
});

test('restoreFindInputFocus blurs THEN focuses the input on every call, and tolerates a closed bar', () => {
  const calls: string[] = [];
  const input = {
    blur: () => calls.push('blur'),
    focus: () => calls.push('focus'),
  };
  // Every reported result means Chromium moved focus somewhere: ClearFocusedElement blurred the
  // host input for a top-level match, or SetFocusedFrame moved keyboard focus into the guest frame
  // for a guest match. Both need the identical restore.
  //
  // The blur is the load-bearing half. After a guest match the host input is STILL this document's
  // activeElement (and document.hasFocus() is still true), so a bare focus() is a no-op inside Blink
  // and never tells the browser to route keys back to this frame — measured live with real OS
  // keystrokes: typing "the" left "t" in the bar and the rest went into the guest. blur() first
  // makes the focus() a genuine focus change the browser hears about.
  restoreFindInputFocus({ input });
  assert.deepEqual(calls, ['blur', 'focus']);
  restoreFindInputFocus({ input });
  assert.deepEqual(calls, ['blur', 'focus', 'blur', 'focus'], 'every reported result restores focus, not just the first');
  assert.doesNotThrow(() => restoreFindInputFocus({ input: null }), 'the bar can be closed by the time a result lands');
});

test('restoreFindInputFocus raises `restoring` for exactly its own blur, so the blur listener cannot loop on it', () => {
  const restoring = { current: false };
  const seen: string[] = [];
  const input = {
    blur: () => seen.push(`blur restoring=${restoring.current}`),
    focus: () => seen.push(`focus restoring=${restoring.current}`),
  };
  restoreFindInputFocus({ input }, { restoring });
  assert.deepEqual(seen, ['blur restoring=true', 'focus restoring=false']);
  assert.equal(restoring.current, false, 'lowered again afterwards');

  const throwing = {
    blur: () => {
      throw new Error('boom');
    },
    focus: () => {},
  };
  assert.throws(() => restoreFindInputFocus({ input: throwing }, { restoring }), /boom/);
  assert.equal(restoring.current, false, 'lowered even when blur throws, or every later real theft would be ignored');
});

test('runFind/stopFind on none, or on top with no bridge, are no-ops', () => {
  const bridge = fakeBridge();
  const { selection, order } = orderedTopFind();
  assert.doesNotThrow(() => runFind({ target: { kind: 'none' }, bridge, text: 'x', options: { forward: true, findNext: true } }, { selection }));
  assert.deepEqual(order, [], 'none must not change the selection');
  assert.doesNotThrow(() => runFind({ target: { kind: 'top' }, bridge: undefined, text: 'x', options: { forward: true, findNext: true } }));
  assert.doesNotThrow(() => stopFind({ target: { kind: 'none' }, bridge }));
  assert.deepEqual(bridge.calls, [], 'none must neither search nor stop through the supplied bridge');
  assert.doesNotThrow(() => stopFind({ target: { kind: 'top' }, bridge: undefined }));
});

test('stopFind clears the guest with clearSelection, or stops the bridge search', () => {
  const guest = fakeGuest();
  stopFind({ target: { kind: 'guest', element: guest }, bridge: fakeBridge() });
  assert.deepEqual(guest.calls, [['stopFindInPage', 'clearSelection']]);

  const bridge = fakeBridge();
  stopFind({ target: { kind: 'top' }, bridge });
  assert.deepEqual(bridge.calls, [['stopFindInPage']]);
});

test('stopFind on a guest not yet attached is swallowed, not thrown', () => {
  const guest = fakeGuest({ notAttached: true });
  assert.doesNotThrow(() => stopFind({ target: { kind: 'guest', element: guest }, bridge: fakeBridge() }));
});

test('formatFindMatchCount: blank until a result exists, the injected no-results copy for zero matches, "N of M" otherwise', () => {
  const labels = { noResults: 'No results', matchOf: ({ ordinal, total }: { ordinal: number; total: number }) => `${ordinal} of ${total}` };
  assert.equal(formatFindMatchCount({ result: null, labels }), '');
  assert.equal(formatFindMatchCount({ result: { activeMatchOrdinal: 0, matches: 0 }, labels }), 'No results');
  assert.equal(formatFindMatchCount({ result: { activeMatchOrdinal: 3, matches: 17 }, labels }), '3 of 17');
});

/** A guest whose `found-in-page` listeners a test can fire, and a bridge whose relayed window
 *  results a test can fire — the two sources a search can be reported on. */
function twoSourceFakes() {
  const guestListeners = new Set<(event: { result: FindInPageResult }) => void>();
  const windowListeners = new Set<(result: FindInPageResult) => void>();
  const guest: FindableGuest = {
    findInPage: () => 1,
    stopFindInPage: () => {},
    // Cast because a real `<webview>`'s listener methods are an OVERLOAD SET over every webview
    // event; this fake only ever receives `'found-in-page'`, whose payload is the one shape below.
    addEventListener: ((_event: string, listener: (event: { result: FindInPageResult }) => void) => void guestListeners.add(listener)) as FindableGuest['addEventListener'],
    removeEventListener: ((_event: string, listener: (event: { result: FindInPageResult }) => void) => void guestListeners.delete(listener)) as FindableGuest['removeEventListener'],
  };
  const bridge: FindBridge = {
    onFindToggle: () => () => {},
    findInPage: async () => {},
    stopFindInPage: async () => {},
    onFindResult: ({ listener }, _options = {}) => {
      windowListeners.add(listener);
      return () => void windowListeners.delete(listener);
    },
  };
  return {
    guest,
    bridge,
    guestCount: () => guestListeners.size,
    windowCount: () => windowListeners.size,
    emitGuest: (result: FindInPageResult) => guestListeners.forEach((l) => l({ result })),
    emitWindow: (result: FindInPageResult) => windowListeners.forEach((l) => l(result)),
  };
}

test('subscribeToFindResults: a GUEST target reports on both sources, and a result on the GUEST\'s own event also restores focus — a guest find moves keyboard focus into the guest', () => {
  const fakes = twoSourceFakes();
  const results: FindInPageResult[] = [];
  let reportedCount = 0;
  const unsubscribe = subscribeToFindResults({ target: { kind: 'guest', element: fakes.guest }, bridge: fakes.bridge, handlers: {
    onResult: ({ result }) => results.push(result),
    onReported: () => {
      reportedCount += 1;
    },
  } });
  assert.equal(fakes.guestCount(), 1, "the guest's own event");
  assert.equal(fakes.windowCount(), 1, "the window's relayed event — the source that reports once its find manager exists");

  fakes.emitGuest({ activeMatchOrdinal: 1, matches: 98 });
  assert.deepEqual(results, [{ activeMatchOrdinal: 1, matches: 98 }]);
  // A cold window (no find run yet) serves a guest find from the guest's OWN find manager, and
  // Chromium's TextFinder::FindInternal runs SetFocusedFrame on the guest frame unconditionally —
  // the same focus theft ClearFocusedElement does for a host-document match. This is the bug: that
  // event used to restore nothing, so the bar accepted exactly one character.
  assert.equal(reportedCount, 1, "a guest-reported result also moved keyboard focus into the guest, so it must restore focus too");

  fakes.emitWindow({ activeMatchOrdinal: 2, matches: 98 });
  assert.deepEqual(results.at(-1), { activeMatchOrdinal: 2, matches: 98 }, 'a rerouted guest find still reaches the counter');
  assert.equal(reportedCount, 2, 'a window-reported result blurred the input and must restore focus too');

  unsubscribe();
  assert.equal(fakes.guestCount(), 0);
  assert.equal(fakes.windowCount(), 0, 'both listeners come off together');
});

test('subscribeToFindResults: a TOP target listens to the window alone', () => {
  const fakes = twoSourceFakes();
  const results: FindInPageResult[] = [];
  let reportedCount = 0;
  const unsubscribe = subscribeToFindResults({ target: { kind: 'top' }, bridge: fakes.bridge, handlers: {
    onResult: ({ result }) => results.push(result),
    onReported: () => {
      reportedCount += 1;
    },
  } });
  assert.equal(fakes.guestCount(), 0, 'no guest element to listen to');
  fakes.emitWindow({ activeMatchOrdinal: 3, matches: 12 });
  assert.deepEqual(results, [{ activeMatchOrdinal: 3, matches: 12 }]);
  assert.equal(reportedCount, 1);
  unsubscribe();
  assert.equal(fakes.windowCount(), 0);
});

test('subscribeToFindResults: no bridge (outside a desktop window) still subscribes a guest, restores focus on its own event, and unsubscribing is safe', () => {
  const fakes = twoSourceFakes();
  let reportedCount = 0;
  const unsubscribe = subscribeToFindResults({ target: { kind: 'guest', element: fakes.guest }, bridge: undefined, handlers: {
    onResult: () => {},
    onReported: () => {
      reportedCount += 1;
    },
  } });
  assert.equal(fakes.guestCount(), 1);
  fakes.emitGuest({ activeMatchOrdinal: 1, matches: 1 });
  assert.equal(reportedCount, 1, 'no bridge to relay a window result, but the guest still took focus and still needs it restored');
  assert.doesNotThrow(unsubscribe);
  assert.equal(fakes.guestCount(), 0);
  assert.doesNotThrow(() => subscribeToFindResults({ target: { kind: 'none' }, bridge: undefined, handlers: { onResult: () => {}, onReported: () => {} } })());
});

test('shouldReclaimFindFocus: only while open and within FIND_FOCUS_RECLAIM_MS of the last issued find', () => {
  assert.equal(
    shouldReclaimFindFocus({ open: true, lastFindAt: 1000, now: 1000 + FIND_FOCUS_RECLAIM_MS - 1 }),
    true,
    'still within the reclaim window',
  );
  assert.equal(
    shouldReclaimFindFocus({ open: true, lastFindAt: 1000, now: 1000 + FIND_FOCUS_RECLAIM_MS }),
    false,
    'the window has passed — a genuine click away from the bar should not be undone',
  );
  assert.equal(shouldReclaimFindFocus({ open: false, lastFindAt: 1000, now: 1000 }), false, 'the bar is closed');
  assert.equal(
    shouldReclaimFindFocus({ open: true, lastFindAt: null, now: 1000 }),
    false,
    'no find has been issued yet — a user click-away must not be undone',
  );
});

test('shouldKeepReclaimingFindFocus: every frame from issuing a find until it reports, never mid-composition', () => {
  const base = { open: true, lastFindAt: 1000, now: 1100, awaitingReport: true, composing: false };
  // The guest takes the keys when it selects its FIRST match, long before its found-in-page (which
  // waits for the full match count) — and nothing fires on the host when it does. Measured live:
  // a key typed in that gap reached the input's keydown and was inserted into the guest instead.
  assert.equal(shouldKeepReclaimingFindFocus(base), true, 'issued, not yet reported');
  assert.equal(shouldKeepReclaimingFindFocus({ ...base, awaitingReport: false }), false, 'reported — the report restores focus itself');
  assert.equal(shouldKeepReclaimingFindFocus({ ...base, composing: true }), false, 'a blur would end an IME composition');
  assert.equal(shouldKeepReclaimingFindFocus({ ...base, open: false }), false, 'the bar closed');
  assert.equal(
    shouldKeepReclaimingFindFocus({ ...base, now: 1000 + FIND_FOCUS_RECLAIM_MS }),
    false,
    'a find that never reports cannot pin focus forever',
  );
});
