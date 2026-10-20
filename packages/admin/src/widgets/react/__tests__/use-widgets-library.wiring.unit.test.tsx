import { act, renderHook, waitFor } from '../../../__tests__/fetch-query-support.js';
import { describe, expect, it, vi } from 'vitest';
import { AdminApiError } from '../../../core/transport/errors.js';
import { createMemoryWidgetsApi } from '../../adapters/memory.js';
import { useWidgetsLibrary, type WidgetsLibraryController } from '../hooks/use-widgets-library.hooks.js';
import type { AdminWidget } from '../../models.js';
import type { AdminWidgetsPort, WidgetsEventsPort } from '../../ports.js';

/** @file The pre-controller first render and the cached-query/controller state merge. */
const W1: AdminWidget = { id: 'w1', workspaceId: 'ws', slug: 'w1-slug', title: 'One', status: 'active', widgetType: 'text', config: {}, updatedAt: 'then', version: 1 };

describe('useWidgetsLibrary before the controller exists', () => {
  it('renders the empty loading state and its actions are inert', async () => {
    const api = createMemoryWidgetsApi({ widgets: [W1] });
    const trash = vi.spyOn(api, 'trashWidget');
    const renders: WidgetsLibraryController[] = [];
    const { result } = renderHook(() => { const view = useWidgetsLibrary({ api }, { locale: 'fr' }); renders.push(view); return view; });
    const first = renders[0]!;
    expect(first).toMatchObject({ widgets: null, error: null, skippedCount: 0, skippedIds: [], createType: 'text', pendingTrash: null, trashing: false, locale: 'fr' });
    first.setCreateType('social-links');
    first.requestTrash(W1);
    first.cancelTrash();
    await first.confirmTrash();
    await waitFor(() => expect(result.current.widgets).toEqual([W1]));
    expect(result.current).toMatchObject({ createType: 'text', pendingTrash: null });
    expect(trash).not.toHaveBeenCalled();
  });
});

describe('useWidgetsLibrary state merge', () => {
  it('reports the skipped malformed rows from the cached list', async () => {
    const api = createMemoryWidgetsApi({ skippedCount: 1, skippedIds: ['bad'] });
    const { result } = renderHook(() => useWidgetsLibrary({ api }));
    await waitFor(() => expect(result.current.skippedIds).toEqual(['bad']));
    expect(result.current).toMatchObject({ skippedCount: 1, widgets: [], locale: 'en' });
  });

  it('shows the refreshed cached list after a host refresh event', async () => {
    let refresh!: () => void;
    const events: WidgetsEventsPort = { subscribe: ({ onRefresh }) => { refresh = onRefresh; return () => {}; } };
    const api = createMemoryWidgetsApi({ widgets: [W1] });
    const { result } = renderHook(() => useWidgetsLibrary({ api }, { events }));
    await waitFor(() => expect(result.current.widgets).toEqual([W1]));
    await api.createWidget({ widgetType: 'text', title: 'Two', config: {} });
    act(() => refresh());
    await waitFor(() => expect(result.current.widgets?.map(w => w.title)).toEqual(['One', 'Two']));
  });

  it('surfaces the list failure message', async () => {
    const api: AdminWidgetsPort = { ...createMemoryWidgetsApi({}), listWidgets: () => Promise.reject(new AdminApiError({ message: 'library denied', status: 403 })) };
    const { result } = renderHook(() => useWidgetsLibrary({ api }));
    await waitFor(() => expect(result.current.error).toBe('library denied'));
    expect(result.current.widgets).toBeNull();
  });

  it('is trashing only while the confirmed widget is the pending one', async () => {
    let release!: () => void;
    const memory = createMemoryWidgetsApi({ widgets: [W1] });
    const api: AdminWidgetsPort = { ...memory, trashWidget: input => new Promise(resolve => { release = () => resolve(memory.trashWidget(input)); }) };
    const { result } = renderHook(() => useWidgetsLibrary({ api }));
    await waitFor(() => expect(result.current.widgets).toEqual([W1]));
    act(() => result.current.requestTrash(W1));
    expect(result.current.trashing).toBe(false);
    let done!: Promise<void>;
    act(() => { done = result.current.confirmTrash(); });
    await waitFor(() => expect(result.current.trashing).toBe(true));
    await act(async () => { release(); await done; });
    expect(result.current).toMatchObject({ trashing: false, pendingTrash: null });
  });

  it('stores the chosen create type', async () => {
    const api = createMemoryWidgetsApi({});
    const { result } = renderHook(() => useWidgetsLibrary({ api }));
    await waitFor(() => expect(result.current.widgets).toEqual([]));
    act(() => result.current.setCreateType('social-links'));
    expect(result.current.createType).toBe('social-links');
  });
});
