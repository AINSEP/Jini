// @vitest-environment jsdom
/**
 * @file `useWebviewLoadFailure` rendered under jsdom with its timers injected, so the 8 s stall
 * guess is fired by hand.
 */
import assert from 'node:assert/strict';
import { act, renderHook as render } from '@testing-library/react';
import { test } from 'vitest';
import { useWebviewLoadFailure, type LoadFailureGuest } from '../use-webview-load-failure.js';

type GuestNode = HTMLElement & LoadFailureGuest;

/** The `current()` / `rerender()` / `unmount()` handle these cases were written against. */
function renderHook<T>(useHook: () => T) {
  const view = render(useHook);
  return { current: () => view.result.current, rerender: () => view.rerender(), unmount: () => view.unmount() };
}

function fakeTimers() {
  let next = 1;
  const pending = new Map<number, () => void>();
  return {
    pending,
    timers: {
      setTimeout: ((callback: () => void, ms: number) => { assert.equal(ms, 8000); pending.set(next, callback); return next++; }) as unknown as Window['setTimeout'],
      clearTimeout: ((handle: number) => { pending.delete(handle); }) as Window['clearTimeout'],
    },
    fireAll: () => { const callbacks = [...pending.values()]; pending.clear(); for (const callback of callbacks) callback(); },
  };
}

function loadEvent(type: string, fields: Record<string, unknown> = {}) {
  return Object.assign(new Event(type), fields);
}

function guestNode() {
  return document.createElement('div') as unknown as GuestNode;
}

test('useWebviewLoadFailure: ignores sub-frame and aborted failures, reports a real one, and a finished load clears both', () => {
  const clock = fakeTimers();
  let resetKey = 0;
  const hook = renderHook(() => useWebviewLoadFailure<GuestNode>({ resetKey }, { timers: clock.timers }));
  const guest = guestNode();
  assert.equal(clock.pending.size, 0, 'no guest, no stall timer');
  act(() => hook.current().guestRef(guest));
  assert.equal(hook.current().guest, guest);
  assert.equal(clock.pending.size, 1);
  act(() => { guest.dispatchEvent(loadEvent('did-fail-load', { isMainFrame: false, errorCode: -105 })); });
  act(() => { guest.dispatchEvent(loadEvent('did-fail-load', { isMainFrame: true, errorCode: -3 })); });
  assert.deepEqual([hook.current().failed, hook.current().stalled, hook.current().loaded], [false, false, false]);
  act(() => clock.fireAll());
  assert.equal(hook.current().stalled, true);
  act(() => { guest.dispatchEvent(loadEvent('did-fail-load', { isMainFrame: true, errorCode: -102 })); });
  assert.deepEqual([hook.current().failed, hook.current().stalled], [true, false], 'a fact withdraws the guess');

  resetKey = 1;
  hook.rerender();
  assert.deepEqual([hook.current().failed, hook.current().stalled, hook.current().loaded], [false, false, false]);
  assert.equal(clock.pending.size, 1, 'the reset re-arms one fresh stall timer');
  act(() => { guest.dispatchEvent(loadEvent('did-finish-load')); });
  assert.deepEqual([hook.current().failed, hook.current().stalled, hook.current().loaded], [false, false, true]);
  assert.equal(clock.pending.size, 0);

  act(() => hook.current().guestRef(null));
  act(() => { guest.dispatchEvent(loadEvent('did-fail-load', { isMainFrame: true, errorCode: -102 })); });
  assert.equal(hook.current().failed, false, 'a detached guest is no longer listened to');
});

test('useWebviewLoadFailure: a real failure cancels the pending stall guess so it can never fire later', () => {
  const clock = fakeTimers();
  const hook = renderHook(() => useWebviewLoadFailure<GuestNode>({ resetKey: 'k' }, { timers: clock.timers }));
  const guest = guestNode();
  act(() => hook.current().guestRef(guest));
  act(() => { guest.dispatchEvent(loadEvent('did-fail-load', { isMainFrame: true, errorCode: -105 })); });
  assert.deepEqual([hook.current().failed, clock.pending.size], [true, 0]);
});

test('useWebviewLoadFailure: a guest that answers clears an earlier failure and marks the admin loaded', () => {
  const clock = fakeTimers();
  const hook = renderHook(() => useWebviewLoadFailure<GuestNode>({ resetKey: 'k' }, { timers: clock.timers }));
  const guest = guestNode();
  act(() => hook.current().guestRef(guest));
  act(() => { guest.dispatchEvent(loadEvent('did-fail-load', { isMainFrame: true, errorCode: -102 })); });
  act(() => { guest.dispatchEvent(loadEvent('did-finish-load')); });
  assert.deepEqual([hook.current().failed, hook.current().stalled, hook.current().loaded], [false, false, true]);
});

test('useWebviewLoadFailure: unmounting clears a pending stall timer', () => {
  const clock = fakeTimers();
  const hook = renderHook(() => useWebviewLoadFailure<GuestNode>({ resetKey: 'k' }, { timers: clock.timers }));
  act(() => hook.current().guestRef(guestNode()));
  assert.equal(clock.pending.size, 1);
  hook.unmount();
  assert.equal(clock.pending.size, 0);
});

test('useWebviewLoadFailure: a guest that mounts after the first render is listened to from the moment it mounts', () => {
  // D-03. The guest arrives through state set by a callback ref, which is a dependency that actually
  // CHANGES when the element mounts; a `RefObject` is the same object forever, so a stopped tab whose
  // site came up (or the failure panel's own retry) mounted a guest no listener or stall timer ever reached.
  const clock = fakeTimers();
  const hook = renderHook(() => useWebviewLoadFailure<GuestNode>({ resetKey: 'k' }, { timers: clock.timers }));
  hook.rerender();
  assert.equal(clock.pending.size, 0);
  const late = guestNode();
  act(() => hook.current().guestRef(late));
  assert.equal(clock.pending.size, 1, 'the late guest arms its own stall timer');
  act(() => { late.dispatchEvent(loadEvent('did-fail-load', { isMainFrame: true, errorCode: -102 })); });
  assert.equal(hook.current().failed, true);
});

test('useWebviewLoadFailure: a replacement guest takes over the listeners and the one stall timer from the old one', () => {
  const clock = fakeTimers();
  const hook = renderHook(() => useWebviewLoadFailure<GuestNode>({ resetKey: 'k' }, { timers: clock.timers }));
  const first = guestNode();
  const second = guestNode();
  act(() => hook.current().guestRef(first));
  act(() => hook.current().guestRef(second));
  assert.equal(clock.pending.size, 1, 'replacement clears the old timer');
  act(() => { first.dispatchEvent(loadEvent('did-fail-load', { isMainFrame: true, errorCode: -102 })); });
  act(() => { first.dispatchEvent(loadEvent('did-finish-load')); });
  assert.deepEqual([hook.current().failed, hook.current().loaded], [false, false], 'the old guest is no longer listened to');
  act(() => { second.dispatchEvent(loadEvent('did-fail-load', { isMainFrame: true, errorCode: -102 })); });
  assert.equal(hook.current().failed, true, 'the new guest reports');
});

test('useWebviewLoadFailure: the failed guest unmounting keeps the failure, so the recovery panel cannot flicker away', () => {
  // Clearing the failure is a SEPARATE effect keyed on resetKey alone. Key that reset on the node
  // instead and unmounting the guest, which is what `failed` DOES (`running && !failed` swaps it for
  // the recovery panel), re-runs it with a null node and clears the very flag that unmounted it: the
  // guest remounts, fails again, and the panel flickers forever. The reset fires only when the
  // operator asks for a fresh judgment.
  const clock = fakeTimers();
  const hook = renderHook(() => useWebviewLoadFailure<GuestNode>({ resetKey: 'k' }, { timers: clock.timers }));
  const guest = guestNode();
  act(() => hook.current().guestRef(guest));
  act(() => { guest.dispatchEvent(loadEvent('did-fail-load', { isMainFrame: true, errorCode: -102 })); });
  act(() => hook.current().guestRef(null));
  assert.equal(hook.current().failed, true);
});

test('useWebviewLoadFailure: only did-finish-load marks the admin loaded, and every new load starts unloaded again', () => {
  // "The guest is mounted" is not "the admin is on screen": navigation events on the way to the
  // first content must not claim it, and a remount, view switch or soft load must not carry over a
  // previous navigation's finished state.
  const clock = fakeTimers();
  let resetKey = 0;
  const hook = renderHook(() => useWebviewLoadFailure<GuestNode>({ resetKey }, { timers: clock.timers }));
  const guest = guestNode();
  act(() => hook.current().guestRef(guest));
  for (const name of ['did-start-loading', 'dom-ready', 'did-navigate', 'did-stop-loading']) {
    act(() => { guest.dispatchEvent(loadEvent(name)); });
    assert.equal(hook.current().loaded, false, `${name} cannot finish the load`);
  }
  act(() => clock.fireAll());
  assert.deepEqual([hook.current().stalled, hook.current().loaded], [true, false]);
  act(() => { guest.dispatchEvent(loadEvent('did-finish-load')); });
  assert.deepEqual([hook.current().stalled, hook.current().loaded], [false, true]);
  resetKey = 1;
  hook.rerender();
  assert.equal(hook.current().loaded, false, 'the next load shows its loading state');
  assert.equal(clock.pending.size, 1, 'a soft navigation re-arms the stall timer');
  act(() => { guest.dispatchEvent(loadEvent('did-fail-load', { isMainFrame: true, errorCode: -102 })); });
  assert.deepEqual([hook.current().failed, hook.current().loaded], [true, false]);
});

test('a restarted site shows loading and gets a fresh stall judgment with the same navigation key', () => {
  const clock = fakeTimers();
  const hook = renderHook(() => useWebviewLoadFailure<GuestNode>({ resetKey: 'same-key' }, { timers: clock.timers }));
  const first = guestNode();
  act(() => hook.current().guestRef(first));
  act(() => { first.dispatchEvent(loadEvent('did-finish-load')); });
  assert.equal(hook.current().loaded, true);
  act(() => hook.current().guestRef(null));
  const second = guestNode();
  act(() => hook.current().guestRef(second));
  assert.deepEqual([hook.current().loaded, hook.current().stalled], [false, false]);
  act(() => clock.fireAll());
  assert.equal(hook.current().stalled, true);
  act(() => hook.current().guestRef(null));
  act(() => hook.current().guestRef(guestNode()));
  assert.deepEqual([hook.current().loaded, hook.current().stalled], [false, false]);
  assert.equal(clock.pending.size, 1);
});
