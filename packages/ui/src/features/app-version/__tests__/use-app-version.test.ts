// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { test } from 'vitest';
import { useAppVersion, useUpdateCheck, type AppVersionLoaderPort, type UpdateCheckPort } from '../use-app-version.js';

function store<S>(initial: S) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    set: (next: S) => { snapshot = next; for (const listener of listeners) listener(); },
  };
}

test('useAppVersion: one loader per bridge, started on mount, stopped on unmount, and its snapshot rendered', () => {
  const log: string[] = [];
  const state = store({ version: null as string | null });
  const createLoader = ({ bridge }: { bridge: string }): AppVersionLoaderPort<{ version: string | null }> => {
    log.push(`create:${bridge}`);
    return { ...state, start: () => { log.push('start'); return () => log.push('stop'); } };
  };
  const hook = renderHook(() => useAppVersion({ bridge: 'b1', createLoader }));
  assert.equal(hook.result.current.version, null);
  act(() => state.set({ version: '1.2.3' }));
  assert.equal(hook.result.current.version, '1.2.3');
  hook.rerender();
  assert.deepEqual(log, ['create:b1', 'start'], 'a re-render with the same bridge reuses the loader');
  hook.unmount();
  assert.deepEqual(log, ['create:b1', 'start', 'stop']);
});

test('useUpdateCheck: the controller calls the latest onDone and report, and checkForUpdates is the controller\'s', async () => {
  const state = store({ available: true, checking: false });
  let ports: { onDone: () => void; report: (failure: { message: string }) => void } | undefined;
  let creates = 0;
  const checkForUpdates = async () => { state.set({ available: true, checking: true }); };
  const createCheck = (args: { bridge: string; onDone: () => void; report: (failure: { readonly message: string }) => void }): UpdateCheckPort<{ available: boolean; checking: boolean }> => {
    creates += 1;
    ports = args;
    return { ...state, checkForUpdates };
  };
  const calls: string[] = [];
  let tag = 'first';
  const hook = renderHook(() => useUpdateCheck({ bridge: 'b', createCheck, onDone: () => calls.push(`done:${tag}`), report: ({ message }) => calls.push(`report:${tag}:${message}`) }));
  assert.deepEqual([hook.result.current.available, hook.result.current.checking], [true, false]);
  tag = 'second';
  hook.rerender();
  assert.equal(creates, 1, 'an inline onDone does not rebuild the controller');
  ports!.onDone();
  ports!.report({ message: 'broken' });
  assert.deepEqual(calls, ['done:second', 'report:second:broken']);
  assert.equal(hook.result.current.checkForUpdates, checkForUpdates);
  await act(() => hook.result.current.checkForUpdates());
  assert.equal(hook.result.current.checking, true);
  hook.unmount();
});
