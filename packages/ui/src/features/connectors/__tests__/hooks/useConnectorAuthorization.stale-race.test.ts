import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConnectorAuthorization } from '../../hooks/useConnectorAuthorization.js';
import { createFakeConnectorsPort } from '../../dependencies.js';
import type { ConnectorAuthBridgePort, ConnectorAuthPendingStoragePort } from '../../ports.js';
import type { Connector, ConnectorAuthorizationPendingState } from '../../types.js';

afterEach(() => { vi.useRealTimers(); });

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return { id: 'slack', name: 'Slack', provider: 'Connector Provider', category: 'communication', status: 'available', tools: [], ...overrides };
}

function makeMemoryStorage(initial: ConnectorAuthorizationPendingState): ConnectorAuthPendingStoragePort {
  let state = initial;
  return { load: () => state, save: (next) => { state = next; } };
}

function makeRefocusBridge() {
  let refocus: (() => void) | null = null;
  const bridge: ConnectorAuthBridgePort = {
    subscribeAuthCallback: () => () => {},
    subscribeWindowRefocus: (cb) => { refocus = cb; return () => { refocus = null; }; },
  };
  return { bridge, fireRefocus: () => refocus?.() };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('useConnectorAuthorization stale sweep against live state', () => {
  it('merges the cancelled connector into the list and leaves every other connector object untouched', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const github = makeConnector({ id: 'github', name: 'GitHub' });
    const port = createFakeConnectorsPort({ connectors: [makeConnector(), github] });
    port.fetchConnectorStatuses = vi.fn(async () => ({ slack: { status: 'available' as const } }));
    port.cancelConnectorAuthorization = vi.fn(async () => makeConnector({ name: 'Slack (cancelled)' }));
    const storage = makeMemoryStorage({ slack: { expiresAt: new Date(Date.now() + 20).toISOString() } });
    const { bridge, fireRefocus } = makeRefocusBridge();
    const { result } = renderHook(() => {
      const [connectors, setConnectors] = useState<Connector[]>([makeConnector(), github]);
      return { connectors, auth: useConnectorAuthorization(port, storage, bridge, { connectors, setConnectors }) };
    });

    vi.setSystemTime(Date.now() + 30);
    await act(async () => { fireRefocus(); await flush(); });

    await waitFor(() => expect(result.current.auth.pending.slack).toBeUndefined());
    expect(result.current.connectors[0]?.name).toBe('Slack (cancelled)');
    expect(result.current.connectors[1]).toBe(github);
  });

  // Characterization of a race the hook's own comment calls unreachable: a connect that FAILS while the
  // stale sweep's cancel call is still in flight sets `authError[id]`, and the sweep's later success
  // then clears that newer error. Pinned as-is and reported for an owner decision, not endorsed.
  it('clears an auth error set by a connect that failed while the stale cancel was in flight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    port.fetchConnectorStatuses = vi.fn(async () => ({ slack: { status: 'available' as const } }));
    let finishCancel!: (connector: Connector) => void;
    port.cancelConnectorAuthorization = vi.fn(() => new Promise<Connector | null>((resolve) => { finishCancel = resolve; }));
    port.connectConnector = vi.fn(async () => ({ connector: makeConnector(), error: 'consent_denied' }));
    const storage = makeMemoryStorage({ slack: { expiresAt: new Date(Date.now() + 20).toISOString() } });
    const { bridge, fireRefocus } = makeRefocusBridge();
    const { result } = renderHook(() => {
      const [connectors, setConnectors] = useState<Connector[]>([makeConnector()]);
      return useConnectorAuthorization(port, storage, bridge, { connectors, setConnectors });
    });

    vi.setSystemTime(Date.now() + 30);
    await act(async () => { fireRefocus(); await flush(); });
    expect(port.cancelConnectorAuthorization).toHaveBeenCalledWith('slack');

    await act(async () => { await result.current.runConnectorAction('slack', 'connect'); });
    expect(result.current.authError.slack).toBe('consent_denied');

    await act(async () => { finishCancel(makeConnector()); await flush(); });
    expect(result.current.authError.slack).toBeUndefined();
  });
});
