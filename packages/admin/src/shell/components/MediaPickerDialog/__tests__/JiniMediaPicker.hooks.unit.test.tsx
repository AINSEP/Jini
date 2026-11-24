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
