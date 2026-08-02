import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWiredConnectorsBrowser } from '../../hooks/useWiredConnectorsBrowser.js';
import { createFakeConnectorsDependencies } from '../../dependencies.js';
import type { Connector } from '../../types.js';

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return { id: 'slack', name: 'Slack', provider: 'Composio', category: 'communication', status: 'available', tools: [], ...overrides };
}

describe('useWiredConnectorsBrowser', () => {
  it('binds the catalog/authorization/detail cluster to the supplied `dependencies` (not a hardcoded fake)', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector({ id: 'wired', name: 'Wired' })] });
    const { result } = renderHook(() => useWiredConnectorsBrowser({ dependencies, unlocked: true }));

    await waitFor(() => expect(result.current.catalog.loading).toBe(false));
    expect(result.current.catalog.connectors).toEqual([expect.objectContaining({ id: 'wired' })]);
    expect(result.current.deps).toBe(dependencies);
  });

  it('falls back to the package in-memory fake (empty catalog) when `dependencies` is omitted', async () => {
    const { result } = renderHook(() => useWiredConnectorsBrowser({ unlocked: true }));
    await waitFor(() => expect(result.current.catalog.loading).toBe(false));
    expect(result.current.catalog.connectors).toEqual([]);
  });

  it('wires `authorization` and `detail` off the same `catalog.connectors` state', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector()] });
    const { result } = renderHook(() => useWiredConnectorsBrowser({ dependencies, unlocked: true }));
    await waitFor(() => expect(result.current.catalog.connectors).toHaveLength(1));

    act(() => {
      result.current.detail.openDetails('slack');
    });
    await waitFor(() => expect(result.current.detail.detailConnector?.id).toBe('slack'));

    await act(async () => {
      await result.current.authorization.runConnectorAction('slack', 'connect');
    });
    await waitFor(() => expect(result.current.catalog.connectors[0]?.status).toBe('connected'));
  });

  it('threads hook overrides through to the underlying sub-hooks', async () => {
    const customCatalog = vi.fn(() => ({
      connectors: [makeConnector({ id: 'overridden' })],
      setConnectors: vi.fn(),
      loading: false,
      enriching: false,
      enriched: true,
    }));

    const { result } = renderHook(() =>
      useWiredConnectorsBrowser({
        unlocked: true,
        useConnectorCatalog: customCatalog as any,
      }),
    );

    expect(customCatalog).toHaveBeenCalled();
    expect(result.current.catalog.connectors).toEqual([expect.objectContaining({ id: 'overridden' })]);
  });
});
