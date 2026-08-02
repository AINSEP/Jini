import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserConnectorAuthBridge,
  createBrowserConnectorAuthPendingStorage,
  createFakeConnectorsDependencies,
  createFakeConnectorsPort,
} from '../dependencies.js';
import type { Connector } from '../types.js';

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return { id: 'slack', name: 'Slack', provider: 'Composio', category: 'communication', status: 'available', tools: [], ...overrides };
}

describe('createFakeConnectorsPort', () => {
  it('fetchConnectors returns a copy of the seeded catalog', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    const connectors = await port.fetchConnectors();
    expect(connectors).toEqual([makeConnector()]);
  });

  it('connectConnector marks the connector connected', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    const result = await port.connectConnector('slack');
    expect(result.connector?.status).toBe('connected');
    expect(result.auth).toEqual({ kind: 'connected' });
    const [refetched] = await port.fetchConnectors();
    expect(refetched!.status).toBe('connected');
  });

  it('connectConnector reports an error for an unknown id', async () => {
    const port = createFakeConnectorsPort({ connectors: [] });
    const result = await port.connectConnector('missing');
    expect(result.connector).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('disconnectConnector marks the connector available again', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'connected' })] });
    const result = await port.disconnectConnector('slack');
    expect(result?.status).toBe('available');
  });

  it('disconnectConnector returns null for an unknown id', async () => {
    const port = createFakeConnectorsPort({ connectors: [] });
    expect(await port.disconnectConnector('missing')).toBeNull();
  });

  it('fetchConnectorStatuses reflects current status', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'connected', accountLabel: 'me@x.com' })] });
    const statuses = await port.fetchConnectorStatuses();
    expect(statuses.slack).toEqual({ status: 'connected', accountLabel: 'me@x.com' });
  });

  it('fetchConnectorDetail returns a copy of the connector when found', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    const detail = await port.fetchConnectorDetail('slack');
    expect(detail).toEqual(makeConnector());
  });

  it('fetchConnectorDetail returns null for an unknown id', async () => {
    const port = createFakeConnectorsPort({ connectors: [] });
    expect(await port.fetchConnectorDetail('missing')).toBeNull();
  });

  it('fetchConnectorEnrichment returns a copy of the catalog', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector()] });
    expect(await port.fetchConnectorEnrichment!()).toEqual([makeConnector()]);
  });

  it('fetchConnectorStatuses omits accountLabel when the connector has none', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'available' })] });
    const statuses = await port.fetchConnectorStatuses();
    expect(statuses.slack).toEqual({ status: 'available' });
  });

  it('defaults connectors to an empty catalog when none are seeded', async () => {
    const port = createFakeConnectorsPort();
    expect(await port.fetchConnectors()).toEqual([]);
  });

  it('cancelConnectorAuthorization marks the connector available again', async () => {
    const port = createFakeConnectorsPort({ connectors: [makeConnector({ status: 'error' })] });
    const result = await port.cancelConnectorAuthorization('slack');
    expect(result?.status).toBe('available');
  });

  it('cancelConnectorAuthorization returns null for an unknown id', async () => {
    const port = createFakeConnectorsPort({ connectors: [] });
    expect(await port.cancelConnectorAuthorization('missing')).toBeNull();
  });

  it('openExternalUrl resolves true', async () => {
    const port = createFakeConnectorsPort();
    await expect(port.openExternalUrl('https://example.test')).resolves.toBe(true);
  });

  it('honors simulated latency', async () => {
    vi.useFakeTimers();
    const port = createFakeConnectorsPort({ connectors: [makeConnector()], latencyMs: 50 });
    const promise = port.fetchConnectors();
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});

describe('createFakeConnectorsDependencies', () => {
  it('bundles a fake data port with the real browser auth-pending-storage and auth-bridge ports', async () => {
    const deps = createFakeConnectorsDependencies({ connectors: [makeConnector()] });
    expect(await deps.data.fetchConnectors()).toEqual([makeConnector()]);
    expect(deps.authPendingStorage.load()).toEqual({});
    expect(typeof deps.authBridge.subscribeAuthCallback).toBe('function');
  });
});

describe('createBrowserConnectorAuthPendingStorage', () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('load() returns {} when nothing is stored', () => {
    const storage = createBrowserConnectorAuthPendingStorage();
    expect(storage.load()).toEqual({});
  });

  it('save() then load() round-trips', () => {
    const storage = createBrowserConnectorAuthPendingStorage();
    storage.save({ slack: { expiresAt: '2099-01-01T00:00:00Z' } });
    expect(storage.load()).toEqual({ slack: { expiresAt: '2099-01-01T00:00:00Z' } });
  });

  it('save() with an empty object clears the stored key', () => {
    const storage = createBrowserConnectorAuthPendingStorage();
    storage.save({ slack: {} });
    storage.save({});
    expect(window.sessionStorage.getItem('jini-connectors-authorization-pending')).toBeNull();
  });

  it('load() and save() are no-ops when window is unavailable (SSR-style)', () => {
    vi.stubGlobal('window', undefined);
    try {
      const storage = createBrowserConnectorAuthPendingStorage();
      expect(storage.load()).toEqual({});
      expect(() => storage.save({ slack: { expiresAt: '2099-01-01T00:00:00Z' } })).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('load() returns {} rather than throwing when sessionStorage.getItem throws', () => {
    const storage = createBrowserConnectorAuthPendingStorage();
    const realSessionStorage = window.sessionStorage;
    // `vi.spyOn(window.sessionStorage, 'getItem')` does not reliably
    // intercept calls through jsdom's `Storage` implementation (verified:
    // the installed spy is not what ends up being called), so this
    // replaces the whole `window.sessionStorage` getter's target instead.
    vi.stubGlobal('sessionStorage', {
      ...realSessionStorage,
      getItem: () => {
        throw new Error('access denied');
      },
    });
    try {
      expect(storage.load()).toEqual({});
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('save() swallows a sessionStorage.setItem failure without throwing', () => {
    const storage = createBrowserConnectorAuthPendingStorage();
    const realSessionStorage = window.sessionStorage;
    vi.stubGlobal('sessionStorage', {
      ...realSessionStorage,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });
    try {
      expect(() => storage.save({ slack: { expiresAt: '2099-01-01T00:00:00Z' } })).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('createBrowserConnectorAuthBridge', () => {
  it('subscribeAuthCallback fires only for trusted-origin, correctly-typed messages', () => {
    const bridge = createBrowserConnectorAuthBridge();
    const onTrusted = vi.fn();
    const unsubscribe = bridge.subscribeAuthCallback(onTrusted);

    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'not-a-connector-message' }, origin: window.location.origin }),
    );
    expect(onTrusted).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'jini:connector-connected' }, origin: 'https://evil.example.com' }),
    );
    expect(onTrusted).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'jini:connector-connected' }, origin: window.location.origin }),
    );
    expect(onTrusted).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'jini:connector-connected' }, origin: window.location.origin }),
    );
    expect(onTrusted).toHaveBeenCalledTimes(1);
  });

  it('subscribeWindowRefocus fires on focus and pageshow, and on visibilitychange only when visible', () => {
    const bridge = createBrowserConnectorAuthBridge();
    const onRefocus = vi.fn();
    const unsubscribe = bridge.subscribeWindowRefocus(onRefocus);

    window.dispatchEvent(new Event('focus'));
    expect(onRefocus).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('pageshow'));
    expect(onRefocus).toHaveBeenCalledTimes(2);

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onRefocus).toHaveBeenCalledTimes(2);

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onRefocus).toHaveBeenCalledTimes(3);

    unsubscribe();
    window.dispatchEvent(new Event('focus'));
    expect(onRefocus).toHaveBeenCalledTimes(3);

    vi.restoreAllMocks();
  });

  it('subscribeAuthCallback returns a no-op unsubscribe when window is unavailable (SSR-style)', () => {
    vi.stubGlobal('window', undefined);
    try {
      const bridge = createBrowserConnectorAuthBridge();
      expect(() => bridge.subscribeAuthCallback(vi.fn())()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('subscribeWindowRefocus returns a no-op unsubscribe when window is unavailable (SSR-style)', () => {
    vi.stubGlobal('window', undefined);
    try {
      const bridge = createBrowserConnectorAuthBridge();
      expect(() => bridge.subscribeWindowRefocus(vi.fn())()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
