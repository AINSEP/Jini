// @vitest-environment jsdom
/**
 * @file Renders `useLiveViews` through the public `@jini-ai/ui/live-views` barrel with the limit
 * preference hook and every guest injected, so release decisions are observed end to end: which
 * tabs stay live, which get probed, and what a released tab leaves parked.
 */
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { test } from 'vitest';
import { useLiveViews, type LiveViewBounds, type LiveViewPreferenceBridge } from '../index.js';
import type { LiveGuest } from '../live-views.js';

const bounds: LiveViewBounds = { min: 1, max: 5, fallback: 1 };
const getBridge = (): LiveViewPreferenceBridge | undefined => undefined;

/** A limit preference the test sets directly; records what each call received. */
function fakePreference(initial: number) {
  const seen: unknown[] = [];
  let limit = initial;
  const useSiteViewPreference = (input: { getBridge: () => LiveViewPreferenceBridge | undefined; bounds: LiveViewBounds }) => {
    seen.push(input);
    return { value: limit, setValue: ({ next }: { next: number }) => { limit = next; } };
  };
  return { useSiteViewPreference, seen, set: (next: number) => { limit = next; } };
}

/** A guest whose probe answer is whatever the test hands it. */
function guest(answer: unknown) {
  const scripts: string[] = [];
  const node: LiveGuest = { executeJavaScript: async (code) => { scripts.push(code); return answer; } };
  return { node, scripts };
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

type Props = { openIds: readonly string[]; focusedId: string | null };

function mount(pref: ReturnType<typeof fakePreference>, initial: Props, probe = 'probe()') {
  return renderHook((props: Props) => useLiveViews({ ...props, useSiteViewPreference: pref.useSiteViewPreference, getBridge, bounds, probe }, { timeoutMs: 50 }), { initialProps: initial });
}

test('the focused tab is live and the limit preference is read with the host bridge and bounds', () => {
  const pref = fakePreference(2);
  const hook = mount(pref, { openIds: ['a', 'b'], focusedId: 'a' });
  assert.equal(hook.result.current.isLive({ id: 'a' }), true);
  assert.equal(hook.result.current.isLive({ id: 'b' }), false, 'b was never focused');
  assert.deepEqual(pref.seen[0], { getBridge, bounds });
  assert.deepEqual(hook.result.current.parked, {});
});

test('over the limit the least recently focused hidden guest is probed and, on a yes, released and parked', async () => {
  const pref = fakePreference(2);
  const hook = mount(pref, { openIds: ['a', 'b', 'c'], focusedId: 'a' });
  const a = guest({ release: true, url: 'http://127.0.0.1:4100/a', x: 1, y: 2, innerY: 3 });
  const b = guest({ release: true, url: 'http://127.0.0.1:4100/b', x: 0, y: 9, innerY: 0 });
  act(() => {
    hook.result.current.registerGuest('a', a.node);
    hook.result.current.registerGuest('b', b.node);
  });
  hook.rerender({ openIds: ['a', 'b', 'c'], focusedId: 'b' });
  await settle();
  assert.equal(hook.result.current.isLive({ id: 'a' }), true);
  hook.rerender({ openIds: ['a', 'b', 'c'], focusedId: 'c' });
  await settle();
  // Order is c, b, a with a limit of 2: a is least recently focused, so it is probed and released.
  assert.deepEqual(a.scripts, ['probe()']);
  assert.deepEqual(b.scripts, []);
  assert.equal(hook.result.current.isLive({ id: 'a' }), false);
  assert.equal(hook.result.current.isLive({ id: 'b' }), true);
  assert.equal(hook.result.current.isLive({ id: 'c' }), true);
  assert.deepEqual(hook.result.current.parked, { a: { url: 'http://127.0.0.1:4100/a', x: 1, y: 2, innerY: 3 } });

  // Closing a parked tab forgets its route.
  hook.rerender({ openIds: ['b', 'c'], focusedId: 'c' });
  await settle();
  assert.deepEqual(hook.result.current.parked, {});
});

test('a veto keeps the guest live, and a guest that leaves no route keeps an earlier parked one', async () => {
  const pref = fakePreference(1);
  const hook = mount(pref, { openIds: ['a', 'b'], focusedId: 'a' });
  const veto = guest({ release: false });
  act(() => hook.result.current.registerGuest('a', veto.node));
  hook.rerender({ openIds: ['a', 'b'], focusedId: 'b' });
  await settle();
  assert.deepEqual(veto.scripts, ['probe()']);
  assert.equal(hook.result.current.isLive({ id: 'a' }), true, 'a vetoed, so the shell stays over the limit');

  // Unregistered: a tab with no guest is released at once, with nothing to park.
  act(() => hook.result.current.registerGuest('a', null));
  hook.rerender({ openIds: ['a', 'b'], focusedId: null });
  hook.rerender({ openIds: ['a', 'b'], focusedId: 'b' });
  await settle();
  assert.equal(hook.result.current.isLive({ id: 'a' }), false);
  assert.deepEqual(hook.result.current.parked, {});
});

test('a released tab refocused and released again without a route keeps the earlier parked view', async () => {
  const pref = fakePreference(1);
  const hook = mount(pref, { openIds: ['a', 'b'], focusedId: 'a' });
  act(() => hook.result.current.registerGuest('a', guest({ release: true, url: 'https://example.test/a', x: 0, y: 5, innerY: 0 }).node));
  hook.rerender({ openIds: ['a', 'b'], focusedId: 'b' });
  await settle();
  assert.deepEqual(hook.result.current.parked, { a: { url: 'https://example.test/a', x: 0, y: 5, innerY: 0 } });

  // Refocused, its guest now answers yes but from an error page (no web url).
  act(() => hook.result.current.registerGuest('a', guest({ release: true, url: 'chrome-error://x' }).node));
  hook.rerender({ openIds: ['a', 'b'], focusedId: 'a' });
  await settle();
  assert.equal(hook.result.current.isLive({ id: 'b' }), false, 'b, now hidden, had no guest and was released');
  hook.rerender({ openIds: ['a', 'b'], focusedId: 'b' });
  await settle();
  assert.equal(hook.result.current.isLive({ id: 'a' }), false);
  assert.deepEqual(hook.result.current.parked, { a: { url: 'https://example.test/a', x: 0, y: 5, innerY: 0 } });
});

test('a focus change before a probe answers cancels that pass: its answer releases nothing', async () => {
  const pref = fakePreference(1);
  const hook = mount(pref, { openIds: ['a', 'b'], focusedId: 'a' });
  let answer: (value: unknown) => void = () => {};
  const slow: LiveGuest = { executeJavaScript: () => new Promise((resolve) => { answer = resolve; }) };
  act(() => hook.result.current.registerGuest('a', slow));
  hook.rerender({ openIds: ['a', 'b'], focusedId: 'b' });
  // Before a answers, the operator focuses a again: the pending pass is now stale.
  hook.rerender({ openIds: ['a', 'b'], focusedId: 'a' });
  await act(async () => { answer({ release: true, url: 'https://example.test/a' }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(hook.result.current.isLive({ id: 'a' }), true);
  assert.deepEqual(hook.result.current.parked, {});
});

test('the same open ids in a new array are no change', () => {
  const pref = fakePreference(5);
  const hook = mount(pref, { openIds: ['a', 'b'], focusedId: 'a' });
  const parked = hook.result.current.parked;
  hook.rerender({ openIds: ['a', 'b'], focusedId: 'a' });
  assert.equal(hook.result.current.parked, parked, 'state object is reused, not rebuilt');
});
