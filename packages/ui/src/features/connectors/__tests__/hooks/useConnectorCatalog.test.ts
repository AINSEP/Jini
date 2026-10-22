import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConnectorCatalog } from '../../hooks/useConnectorCatalog.js';
import { createFakeConnectorsPort } from '../../dependencies.js';
import type { Connector } from '../../types.js';

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return { id: 'slack', name: 'Slack', provider: 'Connector Provider', category: 'communication', status: 'available', tools: [], ...overrides };
}

describe('useConnectorCatalog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retains the catalog after a failed refresh, clears loading, and can retry', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = makeConnector();
    const updated = makeConnector({ name: 'Updated Slack' });
    const port = createFakeConnectorsPort();
    port.fetchConnectors = vi.fn().mockResolvedValueOnce([original])
      .mockRejectedValueOnce(new Error('provider echoed a secret')).mockResolvedValueOnce([updated]);
    const { result, rerender } = renderHook(({ refreshKey }) => useConnectorCatalog(port, { unlocked: false, refreshKey }), {
      initialProps: { refreshKey: 0 },
    });
    await waitFor(() => expect(result.current.connectors).toEqual([original]));

    rerender({ refreshKey: 1 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.connectors).toEqual([original]);
    expect(diagnostic.mock.calls).toEqual([['[connectors] Catalog load failed.']]);

    rerender({ refreshKey: 2 });
    await waitFor(() => expect(result.current.connectors).toEqual([updated]));
    expect(result.current.loading).toBe(false);
  });

  it('retains base rows after enrichment fails and retries on refresh', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = makeConnector();
    const enriched = makeConnector({ toolCount: 7 });
    const port = createFakeConnectorsPort({ connectors: [original] });
    port.fetchConnectorEnrichment = vi.fn().mockRejectedValueOnce(new Error('provider echoed a secret'))
      .mockResolvedValueOnce([enriched]);
    const { result, rerender } = renderHook(({ refreshKey }) => useConnectorCatalog(port, { unlocked: true, refreshKey }), {
      initialProps: { refreshKey: 0 },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enriching).toBe(false);
    expect(result.current.enriched).toBe(false);
    expect(result.current.connectors).toEqual([original]);
    expect(diagnostic.mock.calls).toEqual([['[connectors] Catalog enrichment failed.']]);

    rerender({ refreshKey: 1 });
    await waitFor(() => expect(result.current.enriched).toBe(true));
    expect(result.current.enriching).toBe(false);
    expect(result.current.connectors).toEqual([enriched]);
  });

  it.each(['base', 'enrichment'] as const)('ignores a superseded %s rejection while the new read is pending', async (phase) => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectOld!: (reason: Error) => void;
    let resolveNew!: (rows: Connector[]) => void;
    const fetchRows = vi.fn().mockImplementationOnce(() => new Promise<Connector[]>((_resolve, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise<Connector[]>(resolve => { resolveNew = resolve; }));
    const port = createFakeConnectorsPort();
    if (phase === 'base') port.fetchConnectors = fetchRows;
    else port.fetchConnectorEnrichment = fetchRows;
    const { result, rerender } = renderHook(({ refreshKey }) => useConnectorCatalog(port, { unlocked: phase === 'enrichment', refreshKey }), {
      initialProps: { refreshKey: 0 },
    });
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(1));
    rerender({ refreshKey: 1 });
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));

    await act(async () => { rejectOld(new Error('old failure')); });
    expect(phase === 'base' ? result.current.loading : result.current.enriching).toBe(true);
    expect(result.current.connectors).toEqual([]);
    expect(diagnostic).not.toHaveBeenCalled();
    const rows = [makeConnector({ toolCount: 5 })];
    await act(async () => { resolveNew(rows); });
    expect(result.current.connectors).toEqual(rows);
    expect(phase === 'base' ? result.current.loading : result.current.enriching).toBe(false);
  });

  it('loads the base catalog on mount and clears loading', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    const { result } = renderHook(() => useConnectorCatalog(port, { unlocked: false }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.connectors).toHaveLength(1);
  });

  it('does not enrich while locked', async () => {
    const enrich = vi.fn(async () => []);
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    port.fetchConnectorEnrichment = enrich;
    const { result } = renderHook(() => useConnectorCatalog(port, { unlocked: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(enrich).not.toHaveBeenCalled();
    expect(result.current.enriched).toBe(false);
  });

  it('enriches once unlocked, and only once', async () => {
    const enrich = vi.fn(async () => [makeConnector({ toolCount: 3 })]);
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    port.fetchConnectorEnrichment = enrich;

    const { result, rerender } = renderHook(({ unlocked }) => useConnectorCatalog(port, { unlocked }), {
      initialProps: { unlocked: false },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ unlocked: true });
    await waitFor(() => expect(result.current.enriched).toBe(true));
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(result.current.connectors[0]!.toolCount).toBe(3);

    rerender({ unlocked: true });
    await waitFor(() => expect(result.current.enriched).toBe(true));
    expect(enrich).toHaveBeenCalledTimes(1);
  });

  it('re-runs both fetches when refreshKey changes', async () => {
    const fetchConnectors = vi.fn(async () => [makeConnector()]);
    const port = createFakeConnectorsPort({ connectors: [] });
    port.fetchConnectors = fetchConnectors;

    const { rerender } = renderHook(({ refreshKey }) => useConnectorCatalog(port, { unlocked: false, refreshKey }), {
      initialProps: { refreshKey: 0 },
    });
    await waitFor(() => expect(fetchConnectors).toHaveBeenCalledTimes(1));

    rerender({ refreshKey: 1 });
    await waitFor(() => expect(fetchConnectors).toHaveBeenCalledTimes(2));
  });

  it('does not update state after unmounting before the base fetch resolves', async () => {
    let resolveFetch: (value: Connector[]) => void = () => {};
    const port = createFakeConnectorsPort({ connectors: [] });
    port.fetchConnectors = () => new Promise((resolve) => (resolveFetch = resolve));

    const { result, unmount } = renderHook(() => useConnectorCatalog(port, { unlocked: false }));
    unmount();
    await act(async () => {
      resolveFetch([makeConnector()]);
      await Promise.resolve();
    });
    // No assertion possible on `result.current` post-unmount state changes
    // directly, but this proves the resolved fetch after unmount doesn't
    // throw (React's "update on unmounted component" would surface here).
    expect(result.current.loading).toBe(true);
  });

  it('does not enrich when the port has no fetchConnectorEnrichment implementation at all, even when unlocked', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    delete port.fetchConnectorEnrichment;
    const { result } = renderHook(() => useConnectorCatalog(port, { unlocked: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enriching).toBe(false);
    expect(result.current.enriched).toBe(false);
  });

  it('does not update state after unmounting before the enrichment fetch resolves', async () => {
    let resolveEnrich: (value: Connector[]) => void = () => {};
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    port.fetchConnectorEnrichment = () => new Promise((resolve) => (resolveEnrich = resolve));

    const { result, unmount } = renderHook(() => useConnectorCatalog(port, { unlocked: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enriching).toBe(true);

    unmount();
    await act(async () => {
      resolveEnrich([makeConnector({ toolCount: 9 })]);
      await Promise.resolve();
    });
    expect(result.current.enriched).toBe(false);
  });

  it('setConnectors lets a caller apply an external update', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    const { result } = renderHook(() => useConnectorCatalog(port, { unlocked: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setConnectors((curr) => curr.map((c) => ({ ...c, status: 'connected' })));
    });
    expect(result.current.connectors[0]!.status).toBe('connected');
  });
});
