/**
 * @file Renders the four composed find hooks (`useFindBarState` -> `useFindFocusReclaim` ->
 * `useFindBarEffects` + `useFindInputBinding`) the way a host's find bar wires them, with the clock,
 * bridge and guest injected as hand-stepped fakes. Imports go through the feature barrel so the
 * public surface is the one under test.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FindInPageResult } from '@jini-ai/core/contracts/find-in-page';

import {
  FIND_FOCUS_RECLAIM_MS,
  FIND_QUERY_SETTLE_MS,
  createFindQueryScheduler,
  liveFindClock,
  useFindBarEffects,
  useFindBarState,
  useFindFocusReclaim,
  useFindInputBinding,
  type FindBridge,
  type FindFocusClock,
  type FindableGuest,
  type FindableGuestFoundEvent,
} from '../index.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A clock whose time, timers and animation frames only move when the test steps them. */
function fakeClock() {
  let time = 0;
  let nextId = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const frames = new Map<number, () => void>();
  const cancelledFrames: number[] = [];
  const cancelledTimers: unknown[] = [];
  const clock: FindFocusClock = {
    now: () => time,
    requestFrame: ({ callback }) => {
      nextId += 1;
      frames.set(nextId, callback);
      return nextId;
    },
    cancelFrame: ({ frame }) => {
      cancelledFrames.push(frame);
      frames.delete(frame);
    },
    schedule: ({ callback, delay }) => {
      nextId += 1;
      timers.set(nextId, { callback, delay });
      return nextId;
    },
    cancel: ({ timer }) => {
      cancelledTimers.push(timer);
      timers.delete(timer as number);
    },
  };
  const delays = () => [...timers.values()].map((t) => t.delay);
  const runTimers = (delay: number) => {
    for (const [id, t] of [...timers]) {
      if (t.delay !== delay) continue;
      timers.delete(id);
      t.callback();
    }
  };
  const runFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback();
  };
  return { clock, timers, frames, cancelledFrames, cancelledTimers, delays, runTimers, runFrames, advance: (ms: number) => { time += ms; } };
}

/** The desktop bridge: records searches, and lets the test fire Cmd+F and window results. */
function fakeBridge() {
  const calls: unknown[][] = [];
  let toggle: (() => void) | null = null;
  let resultListener: ((result: FindInPageResult) => void) | null = null;
  const bridge: FindBridge = {
    onFindToggle: ({ listener }) => {
      toggle = listener;
      return () => { toggle = null; };
    },
    findInPage: (query) => { calls.push(['findInPage', query]); },
    stopFindInPage: () => { calls.push(['stopFindInPage']); },
    onFindResult: ({ listener }) => {
      resultListener = listener;
      return () => { resultListener = null; };
    },
  };
  return {
    bridge,
    calls,
    toggle: () => toggle?.(),
    hasToggleListener: () => toggle !== null,
    report: (result: FindInPageResult) => resultListener?.(result),
    hasResultListener: () => resultListener !== null,
  };
}

/** A `<webview>` stand-in. */
function fakeGuest() {
  const calls: unknown[][] = [];
  const listeners = new Set<(event: FindableGuestFoundEvent) => void>();
  const guest: FindableGuest = {
    findInPage: (text, options) => { calls.push(['findInPage', text, options]); return 1; },
    stopFindInPage: (action) => { calls.push(['stopFindInPage', action]); },
    addEventListener: (_event, listener) => { listeners.add(listener); },
    removeEventListener: (_event, listener) => { listeners.delete(listener); },
  };
  return { guest, calls, listeners, found: (result: FindInPageResult) => { for (const l of [...listeners]) l({ result }); } };
}

type BarProps = { activeGuestId: string | null; bridge: FindBridge | undefined; clock: FindFocusClock; createQueryScheduler?: typeof createFindQueryScheduler };

function useFindBar({ activeGuestId, bridge, clock, createQueryScheduler }: BarProps) {
  const s = useFindBarState({ activeGuestId, clock, bridge }, createQueryScheduler ? { createQueryScheduler } : {});
  const reclaim = useFindFocusReclaim({ ...s, clock, bridge });
  useFindBarEffects({ ...s, ...reclaim, activeGuestId, bridge });
  const binding = useFindInputBinding({ ...s, ...reclaim, clock, bridge });
  return { ...s, ...reclaim, ...binding };
}

let api: ReturnType<typeof useFindBar>;
function Bar(props: BarProps) {
  api = useFindBar(props);
  return api.state.open
    ? <input aria-label="find" ref={api.inputRef} value={api.state.query} onChange={(e) => api.dispatch({ type: 'set-query', query: e.target.value })} />
    : null;
}

function mount(props: Partial<BarProps> = {}) {
  const c = fakeClock();
  const b = fakeBridge();
  const full: BarProps = { activeGuestId: null, bridge: b.bridge, clock: c.clock, ...props };
  const view = render(<Bar {...full} />);
  const rerender = (next: Partial<BarProps>) => view.rerender(<Bar {...full} {...next} />);
  return { c, b, view, rerender };
}

function input(): HTMLInputElement {
  const el = document.querySelector('input');
  if (!(el instanceof HTMLInputElement)) throw new Error('find input not mounted');
  return el;
}

/** Counts focus events the input receives from now on. */
function countFocus(el: HTMLInputElement) {
  const counter = { n: 0 };
  el.addEventListener('focus', () => { counter.n += 1; });
  return counter;
}

/** Opens the bar (whose empty query issues a stop, asserted on its own below) and types. */
function openAndType(b: ReturnType<typeof fakeBridge>, query: string) {
  act(() => b.toggle());
  b.calls.length = 0;
  act(() => api.dispatch({ type: 'set-query', query }));
}

describe('find bar hooks', () => {
  it('opens on the bridge Cmd+F, focuses the input, and a repeat Cmd+F reselects the existing query', () => {
    const { b } = mount();
    expect(api.state.open).toBe(false);
    expect(document.querySelector('input')).toBeNull();

    act(() => b.toggle());
    expect(api.state).toMatchObject({ open: true, focusNonce: 1 });
    // Opening with an empty query stops (rather than searches) the live target.
    expect(b.calls).toEqual([['stopFindInPage']]);
    expect(document.activeElement).toBe(input());

    act(() => api.dispatch({ type: 'set-query', query: 'abc' }));
    const el = input();
    el.setSelectionRange(3, 3);
    const focus = countFocus(el);
    act(() => b.toggle());
    expect(api.state.focusNonce).toBe(2);
    expect(focus.n).toBe(1);
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 3]);
  });

  it('unsubscribes from Cmd+F on unmount, and never subscribes without a bridge', () => {
    const { b, view } = mount();
    expect(b.hasToggleListener()).toBe(true);
    view.unmount();
    expect(b.hasToggleListener()).toBe(false);

    mount({ bridge: undefined });
    act(() => api.dispatch({ type: 'toggle' }));
    act(() => api.dispatch({ type: 'set-query', query: 'x' }));
    // No bridge and no guest: the target is `none`.
    expect(api.target).toEqual({ kind: 'none' });
  });

  it('waits for typing to settle, then issues a new top-level search and reclaims focus every frame until it reports', () => {
    const { c, b } = mount();
    openAndType(b, 'ab');
    expect(b.calls).toEqual([]);
    expect(c.delays()).toEqual([FIND_QUERY_SETTLE_MS]);

    const focus = countFocus(input());
    c.advance(5);
    act(() => c.runTimers(FIND_QUERY_SETTLE_MS));
    expect(b.calls).toEqual([['findInPage', { text: 'ab', forward: true, findNext: true }]]);
    expect(api.lastFindAt.current).toBe(5);
    expect(api.awaitingReport.current).toBe(true);
    // The immediate restore after a typed query; its own blur() is not mistaken for a theft.
    expect(focus.n).toBe(1);
    expect(c.delays()).toEqual([]);
    expect(c.frames.size).toBe(1);

    c.runFrames();
    expect(focus.n).toBe(2);
    expect(c.frames.size).toBe(1);

    act(() => b.report({ activeMatchOrdinal: 1, matches: 3 }));
    expect(api.state.result).toEqual({ activeMatchOrdinal: 1, matches: 3 });
    expect(api.awaitingReport.current).toBe(false);
    expect(focus.n).toBe(3);
    // The report ends the per-frame reclaim: the next tick stops without restoring or rescheduling.
    c.runFrames();
    expect(focus.n).toBe(3);
    expect(c.frames.size).toBe(0);
  });

  it('a step search (findNext false) neither restores at once nor starts the per-frame reclaim', () => {
    const { c, b } = mount();
    act(() => b.toggle());
    b.calls.length = 0;
    const focus = countFocus(input());
    act(() => api.issueFind('ab', { forward: false, findNext: false }));
    expect(b.calls).toEqual([['findInPage', { text: 'ab', forward: false, findNext: false }]]);
    expect(focus.n).toBe(0);
    expect(c.frames.size).toBe(0);
  });

  it('stops reclaiming once the reclaim window has passed', () => {
    const { c, b } = mount();
    openAndType(b, 'ab');
    act(() => c.runTimers(FIND_QUERY_SETTLE_MS));
    const focus = countFocus(input());
    c.advance(FIND_FOCUS_RECLAIM_MS);
    c.runFrames();
    expect(focus.n).toBe(0);
    expect(c.frames.size).toBe(0);
  });

  it('holds the search while an IME composition is in progress and runs it once composition ends', () => {
    const { c, b } = mount();
    act(() => b.toggle());
    b.calls.length = 0;
    const el = input();
    act(() => { el.dispatchEvent(new Event('compositionstart')); });
    expect(api.composing.current).toBe(true);
    act(() => api.dispatch({ type: 'set-query', query: 'か' }));
    act(() => c.runTimers(FIND_QUERY_SETTLE_MS));
    expect(b.calls).toEqual([]);
    expect(c.delays()).toEqual([FIND_QUERY_SETTLE_MS]);

    // A report while composing does not blur the input (that would end the composition).
    const focus = countFocus(el);
    act(() => b.report({ activeMatchOrdinal: 0, matches: 0 }));
    expect(focus.n).toBe(0);
    expect(api.state.result).toEqual({ activeMatchOrdinal: 0, matches: 0 });

    act(() => { el.dispatchEvent(new Event('compositionend')); });
    expect(api.composing.current).toBe(false);
    act(() => c.runTimers(FIND_QUERY_SETTLE_MS));
    expect(b.calls).toEqual([['findInPage', { text: 'か', forward: true, findNext: true }]]);
  });

  it('a typed query issued mid-composition skips the immediate restore', () => {
    const { b } = mount();
    act(() => b.toggle());
    b.calls.length = 0;
    const el = input();
    const focus = countFocus(el);
    act(() => { el.dispatchEvent(new Event('compositionstart')); });
    act(() => api.issueFind('a', { forward: true, findNext: true }));
    expect(b.calls).toEqual([['findInPage', { text: 'a', forward: true, findNext: true }]]);
    expect(focus.n).toBe(0);
  });

  it('clearing the query stops the search, cancels the pending reclaim frame and drops the subscription', () => {
    const { c, b } = mount();
    openAndType(b, 'ab');
    act(() => c.runTimers(FIND_QUERY_SETTLE_MS));
    const [frame] = [...c.frames.keys()];
    expect(b.hasResultListener()).toBe(true);

    act(() => api.dispatch({ type: 'set-query', query: '' }));
    expect(b.calls.at(-1)).toEqual(['stopFindInPage']);
    expect(c.cancelledFrames).toContain(frame);
    expect(c.frames.size).toBe(0);
    expect(api.awaitingReport.current).toBe(false);
    expect(api.reclaimFrame.current).toBeNull();
    expect(b.hasResultListener()).toBe(false);
  });

  it('reclaims focus after an outside blur shortly after a find, but lets a later click-away stick', () => {
    const { c, b } = mount();
    openAndType(b, 'ab');
    act(() => c.runTimers(FIND_QUERY_SETTLE_MS));
    const el = input();
    const focus = countFocus(el);

    act(() => { el.blur(); });
    expect(c.delays()).toEqual([0]);
    // A second blur replaces the pending reclaim rather than stacking another.
    const [firstTimer] = [...c.timers.keys()];
    act(() => { el.focus(); el.blur(); });
    expect(c.cancelledTimers).toContain(firstTimer);
    expect(c.delays()).toEqual([0]);
    focus.n = 0;
    act(() => c.runTimers(0));
    expect(focus.n).toBe(1);
    expect(api.reclaimTimer.current).toBeNull();

    c.advance(FIND_FOCUS_RECLAIM_MS);
    act(() => { el.blur(); });
    act(() => c.runTimers(0));
    expect(focus.n).toBe(1);
    expect(document.activeElement).not.toBe(el);
  });

  it('close stops the search, resets the bar and a reclaim still pending for it does nothing', () => {
    const { c, b } = mount();
    openAndType(b, 'ab');
    act(() => c.runTimers(FIND_QUERY_SETTLE_MS));
    const el = input();
    act(() => { el.blur(); });
    const [pendingTimer] = [...c.timers.keys()];

    act(() => api.close());
    expect(b.calls.at(-1)).toEqual(['stopFindInPage']);
    expect(api.state).toEqual({ open: false, query: '', result: null, focusNonce: 0 });
    expect(api.inputElement.current).toBeNull();
    expect(api.awaitingReport.current).toBe(false);
    expect(c.cancelledTimers).toContain(pendingTimer);
    expect(c.frames.size).toBe(0);
    // The unmounted input's listeners are gone: composition events no longer flip the flag.
    el.dispatchEvent(new Event('compositionstart'));
    expect(api.composing.current).toBe(false);
  });

  it('cancels pending timers and frames on unmount', () => {
    const { c, b, view } = mount();
    openAndType(b, 'ab');
    act(() => c.runTimers(FIND_QUERY_SETTLE_MS));
    act(() => { input().blur(); });
    expect(c.frames.size).toBe(1);
    expect(c.timers.size).toBe(1);
    view.unmount();
    expect(c.frames.size).toBe(0);
    expect(c.timers.size).toBe(0);
  });

  it('searches the visible guest, takes its results, and closes (stopping the outgoing guest) on a tab switch', () => {
    const { c, b, rerender } = mount();
    const g = fakeGuest();
    api.registerGuest('p1', g.guest);
    rerender({ activeGuestId: 'p1' });
    expect(api.target).toEqual({ kind: 'guest', element: g.guest });

    act(() => b.toggle());
    expect(g.calls).toEqual([['stopFindInPage', 'clearSelection']]);
    g.calls.length = 0;
    act(() => api.dispatch({ type: 'set-query', query: 'ab' }));
    expect(g.listeners.size).toBe(1);
    act(() => c.runTimers(FIND_QUERY_SETTLE_MS));
    expect(g.calls).toEqual([['findInPage', 'ab', { forward: true, findNext: true }]]);
    expect(b.calls).toEqual([]);

    act(() => g.found({ activeMatchOrdinal: 2, matches: 4 }));
    expect(api.state.result).toEqual({ activeMatchOrdinal: 2, matches: 4 });
    expect(api.awaitingReport.current).toBe(false);

    rerender({ activeGuestId: 'p2' });
    expect(g.calls.at(-1)).toEqual(['stopFindInPage', 'clearSelection']);
    expect(api.state.open).toBe(false);
    expect(g.listeners.size).toBe(0);
    expect(b.calls).toEqual([]);
  });

  it('a surface change while closed changes nothing, and unregistering a guest falls back to the top page', () => {
    const { b, rerender } = mount();
    const g = fakeGuest();
    api.registerGuest('p1', g.guest);
    rerender({ activeGuestId: 'p1' });
    rerender({ activeGuestId: null });
    expect(g.calls).toEqual([]);
    expect(b.calls).toEqual([]);

    api.registerGuest('p1', null);
    expect(api.guests.has('p1')).toBe(false);
    rerender({ activeGuestId: 'p1' });
    expect(api.target).toEqual({ kind: 'top' });
  });

  it('builds the typing scheduler through the injected factory with the injected clock', () => {
    const c = fakeClock();
    const factory = vi.fn(createFindQueryScheduler);
    render(<Bar activeGuestId={null} bridge={undefined} clock={c.clock} createQueryScheduler={factory} />);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith({}, { clock: c.clock });
    expect(api.queryScheduler).toBe(factory.mock.results[0]?.value);
  });
});

describe('liveFindClock', () => {
  it('reads performance.now and runs window timers', () => {
    vi.spyOn(performance, 'now').mockReturnValue(42);
    expect(liveFindClock.now()).toBe(42);

    vi.useFakeTimers();
    const fired: string[] = [];
    liveFindClock.schedule({ callback: () => fired.push('a'), delay: 10 });
    const cancelled = liveFindClock.schedule({ callback: () => fired.push('b'), delay: 10 });
    liveFindClock.cancel({ timer: cancelled });
    vi.advanceTimersByTime(9);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fired).toEqual(['a']);
  });

  it('drives the window animation-frame functions', () => {
    const request = vi.fn(() => 7);
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const callback = () => undefined;
    expect(liveFindClock.requestFrame({ callback })).toBe(7);
    expect(request).toHaveBeenCalledWith(callback);
    liveFindClock.cancelFrame({ frame: 7 });
    expect(cancel).toHaveBeenCalledWith(7);
  });
});
