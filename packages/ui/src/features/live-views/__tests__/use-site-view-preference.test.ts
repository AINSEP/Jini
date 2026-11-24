// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { test } from 'vitest';
import { liveViewLimit, useSiteViewPreference, type LiveViewPreferenceBridge } from '../use-site-view-preference.js';

const bounds = { min: 1, max: 5, fallback: 1 } as const;

test('the live limit is a positive whole number, and anything else is the default of 1', () => {
  assert.equal(liveViewLimit({ value: 5, bounds }), 5);
  for (const value of [0, -1, 1.5, Number.NaN, '3', null, undefined]) assert.equal(liveViewLimit({ value, bounds }), 1, String(value));
});

test('a saved number past the bounds is clamped to them', () => {
  assert.equal(liveViewLimit({ value: 9, bounds }), 5);
  assert.equal(liveViewLimit({ value: 2, bounds: { min: 3, max: 5, fallback: 4 } }), 3);
});

test('useSiteViewPreference: a change event supersedes a later-arriving IPC snapshot, and cleanup detaches', async () => {
  let resolveRead: (value: unknown) => void = () => {};
  let listener: ((saved: unknown) => void) | undefined;
  let detached = 0;
  const bridge: LiveViewPreferenceBridge = {
    getMaximumLiveSiteViews: () => new Promise((resolve) => { resolveRead = resolve; }),
    onMaximumLiveSiteViewsChanged: ({ listener: next }) => { listener = next; return () => { detached += 1; }; },
  };
  const getBridge = () => bridge;
  const hook = renderHook(() => useSiteViewPreference({ getBridge, bounds }));
  assert.equal(hook.result.current.value, 1, 'the default until main answers');
  act(() => listener!(3));
  assert.equal(hook.result.current.value, 3);
  await act(async () => { resolveRead(2); await Promise.resolve(); });
  assert.equal(hook.result.current.value, 3, 'the stale snapshot does not overwrite the change');
  act(() => hook.result.current.setValue({ next: 4 }));
  assert.equal(hook.result.current.value, 4);
  hook.unmount();
  assert.equal(detached, 1);
});

test('useSiteViewPreference: without a bridge the default stands', () => {
  const getBridge = () => undefined;
  const hook = renderHook(() => useSiteViewPreference({ getBridge, bounds }));
  assert.equal(hook.result.current.value, 1);
  hook.unmount();
});
