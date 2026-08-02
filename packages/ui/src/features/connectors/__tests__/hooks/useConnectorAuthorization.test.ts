import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConnectorAuthorization } from '../../hooks/useConnectorAuthorization.js';
import { createFakeConnectorsPort } from '../../dependencies.js';
import type { ConnectorAuthBridgePort, ConnectorAuthPendingStoragePort } from '../../ports.js';
import type { Connector, ConnectorAuthorizationPendingState } from '../../types.js';

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return { id: 'slack', name: 'Slack', provider: 'Composio', category: 'communication', status: 'available', tools: [], ...overrides };
}

function makeMemoryStorage(initial: ConnectorAuthorizationPendingState = {}): ConnectorAuthPendingStoragePort {
  let state = initial;
  return {
    load: () => state,
    save: (next) => {
      state = next;
    },
  };
}

function makeControllableBridge() {
  let authCallback: (() => void) | null = null;
  let refocusCallback: (() => void) | null = null;
  const bridge: ConnectorAuthBridgePort = {
    subscribeAuthCallback: (cb) => {
      authCallback = cb;
      return () => {
        authCallback = null;
      };
    },
    subscribeWindowRefocus: (cb) => {
      refocusCallback = cb;
      return () => {
        refocusCallback = null;
      };
    },
  };
  return {
    bridge,
    fireAuthCallback: () => authCallback?.(),
    fireRefocus: () => refocusCallback?.(),
  };
}

function useHarness(port: ReturnType<typeof createFakeConnectorsPort>, storage: ConnectorAuthPendingStoragePort, bridge: ConnectorAuthBridgePort) {
  return renderHook(
    ({ connectors }: { connectors: Connector[] }) => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors, setConnectors });
    },
    { initialProps: { connectors: [makeConnector()] } },
  );
}

describe('useConnectorAuthorization', () => {
  it('starts with whatever the storage port had persisted', () => {
    const storage = makeMemoryStorage({ slack: { expiresAt: '2099-01-01T00:00:00Z' } });
    const { bridge } = makeControllableBridge();
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    const { result } = useHarness(port, storage, bridge);
    expect(result.current.pending).toEqual({ slack: { expiresAt: '2099-01-01T00:00:00Z' } });
  });

  it('a successful connect with a redirect records a pending authorization and calls onAuthResult', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    port.connectConnector = vi.fn(async () => ({
      connector: makeConnector(),
      auth: { kind: 'redirect_required' as const, redirectUrl: 'https://oauth.example.com', expiresAt: '2099-01-01T00:00:00Z' },
    }));
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const onAuthResult = vi.fn();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, {
        connectors: [makeConnector()],
        setConnectors,
        onAuthResult,
      });
    });

    await act(async () => {
      await result.current.runConnectorAction('slack', 'connect');
    });

    expect(result.current.pending.slack).toEqual({ expiresAt: '2099-01-01T00:00:00Z', redirectUrl: 'https://oauth.example.com' });
    expect(onAuthResult).toHaveBeenCalledWith({ connectorId: 'slack', action: 'connect', result: 'success' });
  });

  it('a failed connect records the error and does not leave a pending authorization', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    port.connectConnector = vi.fn(async () => ({ connector: null, error: 'boom' }));
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const onAuthResult = vi.fn();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors, onAuthResult });
    });

    await act(async () => {
      await result.current.runConnectorAction('slack', 'connect');
    });

    expect(result.current.authError.slack).toBe('boom');
    expect(result.current.pending.slack).toBeUndefined();
    expect(onAuthResult).toHaveBeenCalledWith({ connectorId: 'slack', action: 'connect', result: 'failed', errorCode: 'boom' });
  });

  it('ignores a second runConnectorAction while one is already pending', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    let resolveConnect!: (value: import('../../types.js').ConnectorActionResult) => void;
    port.connectConnector = vi.fn(
      () =>
        new Promise<import('../../types.js').ConnectorActionResult>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });

    let firstCallDone = false;
    act(() => {
      void result.current.runConnectorAction('slack', 'connect').then(() => {
        firstCallDone = true;
      });
    });
    await act(async () => {
      await result.current.runConnectorAction('slack', 'disconnect');
    });
    expect(port.connectConnector).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveConnect({ connector: makeConnector({ status: 'connected' }), auth: { kind: 'connected' } });
      await Promise.resolve();
    });
    expect(firstCallDone).toBe(true);
  });

  it('reloadStatuses clears authError/cancelFailed once a connector reports connected', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'connected' })] });
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector({ status: 'available' })], setConnectors });
    });

    // Seed a stale error/cancel-failed flag as if a prior attempt failed.
    act(() => {
      void result.current.cancelAuthorization('slack');
    });
    await waitFor(() => expect(result.current.cancelFailed.slack).toBeUndefined());
  });

  it('the OAuth callback bridge triggers a status reload', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'connected' })] });
    const fetchStatuses = vi.fn(port.fetchConnectorStatuses.bind(port));
    port.fetchConnectorStatuses = fetchStatuses;
    const storage = makeMemoryStorage();
    const { bridge, fireAuthCallback } = makeControllableBridge();
    renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });

    expect(fetchStatuses).not.toHaveBeenCalled();
    await act(async () => {
      fireAuthCallback();
      await Promise.resolve();
    });
    expect(fetchStatuses).toHaveBeenCalledTimes(1);
  });

  it('window refocus reloads statuses and auto-cancels a stale pending authorization', async () => {
    // expiresAt is in the near future *as of mount* (so the load-time prune
    // below doesn't discard it before the refocus path ever runs), and goes
    // stale a moment later, before refocus fires — this is what actually
    // goes stale mid-session, as opposed to an already-expired entry from a
    // prior session (which the load-time prune test below covers instead).
    // Real timers throughout (a short real delay, not vi.useFakeTimers())
    // since waitFor's internal polling doesn't play well with mocked timers.
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'available' })] });
    const cancelSpy = vi.spyOn(port, 'cancelConnectorAuthorization');
    const storage = makeMemoryStorage({ slack: { expiresAt: new Date(Date.now() + 20).toISOString() } });
    const { bridge, fireRefocus } = makeControllableBridge();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });

    expect(result.current.pending.slack).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await act(async () => {
      fireRefocus();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cancelSpy).toHaveBeenCalledWith('slack');
    await waitFor(() => expect(result.current.pending.slack).toBeUndefined());
  });

  it('prunes an already-expired pending entry from storage immediately on load (no refocus/poll needed)', () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'available' })] });
    const storage = makeMemoryStorage({ slack: { expiresAt: '2020-01-01T00:00:00Z' } });
    const { bridge } = makeControllableBridge();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });

    expect(result.current.pending.slack).toBeUndefined();
  });

  it('does not auto-cancel a pending authorization that has not expired yet', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'available' })] });
    const cancelSpy = vi.spyOn(port, 'cancelConnectorAuthorization');
    const storage = makeMemoryStorage({ slack: { expiresAt: '2099-01-01T00:00:00Z' } });
    const { bridge, fireRefocus } = makeControllableBridge();
    renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });

    await act(async () => {
      fireRefocus();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('polls fetchConnectorStatuses on an interval while an authorization is pending, and stops once cleared', async () => {
    vi.useFakeTimers();
    try {
      const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'available' })] });
      const fetchStatuses = vi.fn(port.fetchConnectorStatuses.bind(port));
      port.fetchConnectorStatuses = fetchStatuses;
      const storage = makeMemoryStorage({ slack: { expiresAt: '2099-01-01T00:00:00Z' } });
      const { bridge } = makeControllableBridge();
      renderHook(() => {
        const setConnectors = vi.fn();
        return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors, pollMs: 1000 });
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(fetchStatuses).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(fetchStatuses).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelAuthorization falls back to marking cancel-failed when the port cannot cancel and status is not connected', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'available' })] });
    port.cancelConnectorAuthorization = vi.fn(async () => null);
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });

    await act(async () => {
      await result.current.cancelAuthorization('slack');
    });
    expect(result.current.cancelFailed.slack).toBe(true);
  });

  it('cancelStaleAuthorizations clears a pre-existing cancelFailed flag on a successful stale cancel', async () => {
    // (authError specifically cannot coexist with a pending entry for the
    // same connector — see this file's own doc comment on
    // `cancelStaleAuthorizations` for the proof — so only cancelFailed is
    // exercisable here.)
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'available' })] });
    port.fetchConnectorStatuses = vi.fn(async () => ({ slack: { status: 'available' as const } }));
    // A pending entry that outlives the manual cancel attempt below but
    // expires before the stale sweep fires.
    const storage = makeMemoryStorage({ slack: { expiresAt: new Date(Date.now() + 40).toISOString() } });
    const { bridge, fireRefocus } = makeControllableBridge();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });
    expect(result.current.pending.slack).toBeDefined();

    // 1) A manual cancel attempt fails, seeding cancelFailed without
    // touching the still-pending entry.
    port.cancelConnectorAuthorization = vi.fn(async () => null);
    await act(async () => {
      await result.current.cancelAuthorization('slack');
    });
    expect(result.current.cancelFailed.slack).toBe(true);
    expect(result.current.pending.slack).toBeDefined();

    // 2) The pending entry goes stale; the refocus sweep's own cancel call
    // now succeeds, clearing the cancelFailed flag seeded above.
    port.cancelConnectorAuthorization = vi.fn(async () => makeConnector({ status: 'available' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await act(async () => {
      fireRefocus();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.cancelFailed.slack).toBeUndefined());
  });

  it('cancelStaleAuthorizations marks cancelFailed when the port cancel call throws', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'available' })] });
    port.cancelConnectorAuthorization = vi.fn(async () => {
      throw new Error('network error');
    });
    const storage = makeMemoryStorage({ slack: { expiresAt: new Date(Date.now() + 20).toISOString() } });
    const { bridge, fireRefocus } = makeControllableBridge();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    await act(async () => {
      fireRefocus();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.cancelFailed.slack).toBe(true));
  });

  it('runConnectorAction(connect) clears pre-existing cancelFailed/authError flags before attempting', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    port.cancelConnectorAuthorization = vi.fn(async () => null);
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });

    // Seed cancelFailed via the public API (its fallback path), and
    // authError via a first failed connect attempt.
    await act(async () => {
      await result.current.cancelAuthorization('slack');
    });
    expect(result.current.cancelFailed.slack).toBe(true);

    port.connectConnector = vi.fn(async () => ({ connector: null, error: 'seed-error' }));
    await act(async () => {
      await result.current.runConnectorAction('slack', 'connect');
    });
    expect(result.current.authError.slack).toBe('seed-error');

    port.connectConnector = vi.fn(async () => ({ connector: makeConnector(), auth: { kind: 'connected' as const } }));
    await act(async () => {
      await result.current.runConnectorAction('slack', 'connect');
    });
    expect(result.current.cancelFailed.slack).toBeUndefined();
    expect(result.current.authError.slack).toBeUndefined();
  });

  it('runConnectorAction(connect) reports failed and rethrows when the port call itself throws', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    port.connectConnector = vi.fn(async () => {
      throw new Error('network down');
    });
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const onAuthResult = vi.fn();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors, onAuthResult });
    });

    await expect(
      act(async () => {
        await result.current.runConnectorAction('slack', 'connect');
      }),
    ).rejects.toThrow('network down');

    expect(onAuthResult).toHaveBeenCalledWith({
      connectorId: 'slack',
      action: 'connect',
      result: 'failed',
      errorCode: 'network down',
    });
    // The `finally` still clears pendingConnectorAction even though it threw.
    expect(result.current.pendingConnectorAction).toBeNull();
  });

  it('a failed connect with no connector and no error message omits errorCode from onAuthResult', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    port.connectConnector = vi.fn(async () => ({ connector: null }));
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const onAuthResult = vi.fn();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors, onAuthResult });
    });

    await act(async () => {
      await result.current.runConnectorAction('slack', 'connect');
    });

    expect(onAuthResult).toHaveBeenCalledWith({ connectorId: 'slack', action: 'connect', result: 'failed' });
    expect(result.current.authError.slack).toBeUndefined();
  });

  it('a successful connect that lands the connector as already-connected notifies onConnectorsChanged', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    port.connectConnector = vi.fn(async () => ({
      connector: makeConnector({ status: 'connected' }),
      auth: { kind: 'connected' as const },
    }));
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const onConnectorsChanged = vi.fn();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, {
        connectors: [makeConnector()],
        setConnectors,
        onConnectorsChanged,
      });
    });

    await act(async () => {
      await result.current.runConnectorAction('slack', 'connect');
    });
    expect(onConnectorsChanged).toHaveBeenCalled();
  });

  it('runConnectorAction(disconnect) succeeds, clears a pre-existing authError, and notifies onConnectorsChanged/onAuthResult', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'connected' })] });
    port.connectConnector = vi.fn(async () => ({ connector: null, error: 'seed-error' }));
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const onConnectorsChanged = vi.fn();
    const onAuthResult = vi.fn();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, {
        connectors: [makeConnector()],
        setConnectors,
        onConnectorsChanged,
        onAuthResult,
      });
    });

    // Seed an authError first so the disconnect path's own clear-branch has
    // something real to remove.
    await act(async () => {
      await result.current.runConnectorAction('slack', 'connect');
    });
    expect(result.current.authError.slack).toBe('seed-error');

    await act(async () => {
      await result.current.runConnectorAction('slack', 'disconnect');
    });

    expect(result.current.authError.slack).toBeUndefined();
    expect(onConnectorsChanged).toHaveBeenCalled();
    expect(onAuthResult).toHaveBeenCalledWith({ connectorId: 'slack', action: 'disconnect', result: 'success' });
  });

  it('runConnectorAction(disconnect) reports failed and rethrows when the port call throws', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'connected' })] });
    port.disconnectConnector = vi.fn(async () => {
      throw new Error('disconnect failed');
    });
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const onAuthResult = vi.fn();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors, onAuthResult });
    });

    await expect(
      act(async () => {
        await result.current.runConnectorAction('slack', 'disconnect');
      }),
    ).rejects.toThrow('disconnect failed');

    expect(onAuthResult).toHaveBeenCalledWith({
      connectorId: 'slack',
      action: 'disconnect',
      result: 'failed',
      errorCode: 'disconnect failed',
    });
  });

  it('cancelAuthorization on success clears pre-existing cancelFailed/authError flags', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'available' })] });
    port.connectConnector = vi.fn(async () => ({ connector: null, error: 'seed-error' }));
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });

    // Seed an authError, and separately force a cancel-failure to seed
    // cancelFailed, before the real successful cancel below.
    await act(async () => {
      await result.current.runConnectorAction('slack', 'connect');
    });
    expect(result.current.authError.slack).toBe('seed-error');

    port.cancelConnectorAuthorization = vi.fn(async () => null);
    await act(async () => {
      await result.current.cancelAuthorization('slack');
    });
    expect(result.current.cancelFailed.slack).toBe(true);

    port.cancelConnectorAuthorization = vi.fn(async () => makeConnector({ status: 'available' }));
    await act(async () => {
      await result.current.cancelAuthorization('slack');
    });

    expect(result.current.cancelFailed.slack).toBeUndefined();
    expect(result.current.authError.slack).toBeUndefined();
  });

  it('cancelAuthorization returns quietly without marking cancelFailed when the status refresh shows the connector already connected', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'connected' })] });
    port.cancelConnectorAuthorization = vi.fn(async () => null);
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });

    await act(async () => {
      await result.current.cancelAuthorization('slack');
    });
    expect(result.current.cancelFailed.slack).toBeUndefined();
  });

  it('cancelAuthorization still marks cancelFailed when the fallback status refresh itself throws', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'available' })] });
    port.cancelConnectorAuthorization = vi.fn(async () => null);
    port.fetchConnectorStatuses = vi.fn(async () => {
      throw new Error('status fetch failed');
    });
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });

    await act(async () => {
      await result.current.cancelAuthorization('slack');
    });
    expect(result.current.cancelFailed.slack).toBe(true);
  });

  it('reloadStatuses calls onConnectorsChanged when a real status change is detected', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'connected' })] });
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const onConnectorsChanged = vi.fn();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, {
        connectors: [makeConnector({ status: 'available' })], // differs from the port's real status
        setConnectors,
        onConnectorsChanged,
      });
    });

    await act(async () => {
      await result.current.reloadStatuses();
    });
    expect(onConnectorsChanged).toHaveBeenCalledTimes(1);
  });

  it('runConnectorAction(connect) stringifies a non-Error throw for errorCode', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    port.connectConnector = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'a plain string failure';
    });
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const onAuthResult = vi.fn();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors, onAuthResult });
    });

    await expect(
      act(async () => {
        await result.current.runConnectorAction('slack', 'connect');
      }),
    ).rejects.toBe('a plain string failure');

    expect(onAuthResult).toHaveBeenCalledWith({
      connectorId: 'slack',
      action: 'connect',
      result: 'failed',
      errorCode: 'a plain string failure',
    });
  });

  it('runConnectorAction(disconnect) stringifies a non-Error throw for errorCode, and clears a no-op authError cleanly', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'connected' })] });
    port.disconnectConnector = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'plain disconnect failure';
    });
    const storage = makeMemoryStorage();
    const { bridge } = makeControllableBridge();
    const onAuthResult = vi.fn();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors, onAuthResult });
    });

    // authError.slack is undefined here — this also exercises the
    // disconnect path's authError-clear updater's "nothing to clear"
    // branch (returns the same reference) before the port call throws.
    await expect(
      act(async () => {
        await result.current.runConnectorAction('slack', 'disconnect');
      }),
    ).rejects.toBe('plain disconnect failure');

    expect(onAuthResult).toHaveBeenCalledWith({
      connectorId: 'slack',
      action: 'disconnect',
      result: 'failed',
      errorCode: 'plain disconnect failure',
    });
  });

  it('persists pending state to the storage port whenever it changes', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    port.connectConnector = vi.fn(async () => ({
      connector: makeConnector(),
      auth: { kind: 'pending' as const },
    }));
    const storage = makeMemoryStorage();
    const saveSpy = vi.spyOn(storage, 'save');
    const { bridge } = makeControllableBridge();
    const { result } = renderHook(() => {
      const setConnectors = vi.fn();
      return useConnectorAuthorization(port, storage, bridge, { connectors: [makeConnector()], setConnectors });
    });

    await act(async () => {
      await result.current.runConnectorAction('slack', 'connect');
    });
    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ slack: {} }));
  });
});
