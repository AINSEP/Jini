// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { useMemo, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FetchQueryAdapter } from '@jini-ai/core/fetch';
import type { MediaPickerPort } from '../../../../contracts/media-picker.js';
import { useJiniMediaPicker, type JiniMediaPickerArgs, type JiniMediaPickerRow } from '../JiniMediaPicker.hooks.js';

/** A loader that is stable across renders, as the real fetch-query loader is (the effect depends on it). */
function useStableLoader<T>({ fetch }: { key: readonly (string | number)[]; fetch?: (() => Promise<T>) | undefined }) {
  return useMemo(() => ({ peek: () => undefined, load: () => fetch!(), replace: () => {} }), [fetch]);
}
const useCachedLoader = useStableLoader as FetchQueryAdapter['useCachedLoader'];
const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;

type Row = JiniMediaPickerRow & { slug: string };
const row = (id: string, status = 'active'): Row => ({ id, status, slug: `${id}-slug` });

function deferredPicker() {
  const resolvers: ((value: { id: string } | null) => void)[] = [];
  const pick = vi.fn(() => new Promise((resolve) => { resolvers.push(resolve as never); }));
  return { picker: { pick } as unknown as MediaPickerPort, pick, resolvers };
}

function args(overrides: Partial<JiniMediaPickerArgs<Row>> = {}): JiniMediaPickerArgs<Row> {
  return { onSelect: vi.fn(), onCancel: vi.fn(), picker: null, port: { listMedia: async () => ({ media: [] }) },
    errorRedaction: {}, errorIdOf: () => undefined, useCachedLoader, ...overrides };
}

describe('useJiniMediaPicker', () => {
  it('stays disabled without a picker service or when the host injects its legacy dialog', () => {
    const onCancel = vi.fn();
    expect(renderHook(() => useJiniMediaPicker(args({ onCancel })), { wrapper }).result.current).toEqual({ enabled: false, error: null, onCancel });
    const { picker, pick } = deferredPicker();
    expect(renderHook(() => useJiniMediaPicker(args({ picker, useDialog: () => null })), { wrapper }).result.current.enabled).toBe(false);
    expect(pick).not.toHaveBeenCalled();
  });

  it('resolves the picked id to the host port\'s active row, skipping a trashed one', async () => {
    const { picker, pick, resolvers } = deferredPicker();
    const onSelect = vi.fn();
    const port = { listMedia: async () => ({ media: [row('a'), row('b', 'trashed'), row('b')] }) };
    renderHook(() => useJiniMediaPicker(args({ picker, port, onSelect, accept: ['image/*'] })), { wrapper });
    expect(pick).toHaveBeenCalledWith({ accept: ['image/*'] }, { signal: expect.any(AbortSignal) });
    await act(async () => { resolvers[0]!({ id: 'b' }); });
    await waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith(row('b')));
  });

  it('formats a failure with the injected redaction policy and host incident id', async () => {
    const { picker, resolvers } = deferredPicker();
    const cause = new Error('password=PICKER_CANARY_SECRET');
    const errorIdOf = vi.fn(() => 'incident-7');
    const port = { listMedia: async () => { throw cause; } };
    const { result } = renderHook(() => useJiniMediaPicker(args({ picker, port, errorIdOf })), { wrapper });
    await act(async () => { resolvers[0]!({ id: 'a' }); });
    await waitFor(() => expect(result.current.error).toMatchObject({ message: 'The media could not be chosen.', errorId: 'incident-7' }));
    expect(errorIdOf).toHaveBeenCalledWith(cause);
    expect(JSON.stringify(result.current.error)).not.toContain('PICKER_CANARY_SECRET');
  });
});

it('cancels a dismissed picker without reading media and discards a late pick after unmount', async () => {
  const listMedia = vi.fn(async () => ({ media: [row('a')] }));
  const onCancel = vi.fn();
  const a = deferredPicker();
  const first = renderHook(() => useJiniMediaPicker(args({ picker: a.picker, port: { listMedia }, onCancel })), { wrapper });
  expect(a.pick).toHaveBeenCalledExactlyOnceWith({ accept: [] }, { signal: expect.any(AbortSignal) });
  await act(async () => { a.resolvers[0]!(null); });
  expect(onCancel.mock.calls).toEqual([[]]);
  expect(listMedia).not.toHaveBeenCalled();
  first.unmount();

  const b = deferredPicker();
  const onSelect = vi.fn();
  const second = renderHook(() => useJiniMediaPicker(args({ picker: b.picker, port: { listMedia }, onSelect })), { wrapper });
  const signal = (b.pick.mock.calls as unknown as [unknown, { signal: AbortSignal }][])[0]?.[1].signal;
  expect(signal?.aborted).toBe(false);
  second.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { b.resolvers[0]!({ id: 'a' }); });
  expect(listMedia).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

it('reports a no-longer-active asset without inventing an incident id', async () => {
  const { picker, resolvers } = deferredPicker();
  const onSelect = vi.fn();
  const port = { listMedia: async () => ({ media: [row('a', 'trashed'), row('b')] }) };
  const { result } = renderHook(() => useJiniMediaPicker(args({ picker, port, onSelect })), { wrapper });
  await act(async () => { resolvers[0]!({ id: 'a' }); });
  await waitFor(() => expect(result.current.error).toMatchObject({ message: 'The media could not be chosen.', cause: expect.stringContaining('Selected media is unavailable') }));
  expect(result.current.error?.errorId).toBeUndefined();
  expect(onSelect).not.toHaveBeenCalled();
});
