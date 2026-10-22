import { useFetchQuery } from "@jini-ai/ui/fetch-query";
import { act, renderHook, waitFor } from '../../../__tests__/fetch-query-support.js';
import { describe, expect, it } from 'vitest';
import { createMemoryWidgetsApi } from '../../adapters/memory.js';
import { useWidgetsLibrary } from '../hooks/use-widgets-library.hooks.js';
import type { AdminWidget } from '../../models.js';

const widget: AdminWidget = { id: 'w1', workspaceId: 'ws1', slug: 'hero', title: 'Hero', status: 'active', widgetType: 'text', config: {}, updatedAt: '2026-08-01T00:00:00.000Z', version: 1 };
describe('widgets shared query ownership', () => {
  it('a confirmed trash refreshes every mounted library consumer', async () => {
    const api = createMemoryWidgetsApi({ widgets: [widget] });
    const { result } = renderHook(() => ({ first: useWidgetsLibrary({ api }), second: useWidgetsLibrary({ api }) }));
    await waitFor(() => expect(result.current.second.widgets).toEqual([widget]));
    act(() => result.current.first.requestTrash(widget));
    await act(async () => { await result.current.first.confirmTrash(); });
    await waitFor(() => {
      expect(result.current.first.widgets).toEqual([]);
      expect(result.current.second.widgets).toEqual([]);
    });
  });

  it('a rejected trash retains the cached roster in both consumers', async () => {
    const source = createMemoryWidgetsApi({ widgets: [widget] });
    const api = { ...source, trashWidget: async () => { throw new Error('offline'); } };
    const { result } = renderHook(() => ({ first: useWidgetsLibrary({ api }), second: useWidgetsLibrary({ api }) }));
    await waitFor(() => expect(result.current.second.widgets).toEqual([widget]));
    act(() => result.current.first.requestTrash(widget));
    await act(async () => { await result.current.first.confirmTrash(); });
    expect(result.current.first.error).toBe('offline');
    expect(result.current.first.widgets).toEqual([widget]);
    expect(result.current.second.widgets).toEqual([widget]);
  });
});


it('invalidates host widget option lists after an accepted trash', async () => {
  const api = createMemoryWidgetsApi({ widgets: [widget] });
  const { result } = renderHook(() => ({
    library: useWidgetsLibrary({ api }),
    hostOptions: useFetchQuery({ key: ['widgets', 'instances', 'text'], fetch: () => api.listWidgets({}) }),
  }));
  await waitFor(() => expect(result.current.hostOptions.data?.widgets).toEqual([widget]));
  act(() => result.current.library.requestTrash(widget));
  await act(async () => { await result.current.library.confirmTrash(); });
  await waitFor(() => expect(result.current.hostOptions.data?.widgets).toEqual([]));
});
