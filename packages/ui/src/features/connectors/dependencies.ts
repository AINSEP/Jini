/**
 * The only file in this feature allowed to touch a concrete adapter.
 *
 * `data` (the catalog/connect/disconnect transport) is genuinely
 * host-specific — OD's real implementation calls `providers/registry`
 * (REST endpoints + a popup-window OAuth flow). Per the canary plan, this
 * package ships a fake/in-memory double instead of a real transport; a real
 * host supplies its own `ConnectorsPort` implementation.
 *
 * `authPendingStorage` and `authBridge`, by contrast, only touch generic
 * browser APIs (sessionStorage, postMessage, focus/visibility) with no
 * backend-specific shape, so this package ships real SSR-guarded browser
 * implementations for those two — a host only needs to supply its own
 * `data` port.
 */
import { CONNECTOR_AUTH_PENDING_STORAGE_KEY } from './constants.js';
import type {
  ConnectorAuthBridgePort,
  ConnectorAuthPendingStoragePort,
  ConnectorsDependencies,
  ConnectorsPort,
  FetchConnectorDetailOptions,
} from './ports.js';
import {
  isTrustedConnectorCallbackOrigin,
  parseConnectorAuthorizationPendingState,
} from './rules.js';
import type {
  Connector,
  ConnectorActionResult,
  ConnectorAuthorizationPendingState,
  ConnectorStatusMap,
} from './types.js';

export interface FakeConnectorsPortOptions {
  connectors?: Connector[];
  /** Simulated network latency in ms; 0 (default) resolves synchronously. */
  latencyMs?: number;
}

/**
 * An in-memory test double: connect/disconnect mutate a local array and
 * report `connected`/`available` directly (no real OAuth round trip). Good
 * enough for demos and for driving this feature's own hook/component tests.
 */
export function createFakeConnectorsPort(options: FakeConnectorsPortOptions = {}): ConnectorsPort {
  let connectors = options.connectors ? options.connectors.map((c) => ({ ...c })) : [];
  const latencyMs = options.latencyMs ?? 0;
  const delay = <T>(value: T): Promise<T> =>
    latencyMs > 0 ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs)) : Promise.resolve(value);

  return {
    fetchConnectors() {
      return delay(connectors.map((c) => ({ ...c })));
    },
    fetchConnectorEnrichment() {
      return delay(connectors.map((c) => ({ ...c })));
    },
    fetchConnectorStatuses() {
      const statuses: ConnectorStatusMap = {};
      for (const c of connectors) {
        statuses[c.id] = { status: c.status, ...(c.accountLabel ? { accountLabel: c.accountLabel } : {}) };
      }
      return delay(statuses);
    },
    fetchConnectorDetail(connectorId: string, _options?: FetchConnectorDetailOptions) {
      const found = connectors.find((c) => c.id === connectorId) ?? null;
      return delay(found ? { ...found } : null);
    },
    connectConnector(connectorId: string): Promise<ConnectorActionResult> {
      const idx = connectors.findIndex((c) => c.id === connectorId);
      if (idx === -1) return delay({ connector: null, error: 'Connector not found' });
      connectors[idx] = { ...connectors[idx]!, status: 'connected' };
      return delay({ connector: { ...connectors[idx]! }, auth: { kind: 'connected' } });
    },
    disconnectConnector(connectorId: string) {
      const idx = connectors.findIndex((c) => c.id === connectorId);
      if (idx === -1) return delay(null);
      connectors[idx] = { ...connectors[idx]!, status: 'available' };
      return delay({ ...connectors[idx]! });
    },
    cancelConnectorAuthorization(connectorId: string) {
      const idx = connectors.findIndex((c) => c.id === connectorId);
      if (idx === -1) return delay(null);
      connectors[idx] = { ...connectors[idx]!, status: 'available' };
      return delay({ ...connectors[idx]! });
    },
    openExternalUrl(_url: string) {
      return delay(true);
    },
  };
}

export function createBrowserConnectorAuthPendingStorage(): ConnectorAuthPendingStoragePort {
  return {
    load(): ConnectorAuthorizationPendingState {
      if (typeof window === 'undefined') return {};
      try {
        const raw = window.sessionStorage.getItem(CONNECTOR_AUTH_PENDING_STORAGE_KEY);
        if (!raw) return {};
        return parseConnectorAuthorizationPendingState(raw);
      } catch {
        return {};
      }
    },
    save(state: ConnectorAuthorizationPendingState): void {
      if (typeof window === 'undefined') return;
      try {
        if (Object.keys(state).length === 0) {
          window.sessionStorage.removeItem(CONNECTOR_AUTH_PENDING_STORAGE_KEY);
        } else {
          window.sessionStorage.setItem(CONNECTOR_AUTH_PENDING_STORAGE_KEY, JSON.stringify(state));
        }
      } catch {
        /* Ignore unavailable sessionStorage. */
      }
    },
  };
}

const CONNECTOR_CALLBACK_MESSAGE_TYPE = 'jini:connector-connected';

export function createBrowserConnectorAuthBridge(): ConnectorAuthBridgePort {
  return {
    subscribeAuthCallback(onTrustedCallback: () => void): () => void {
      if (typeof window === 'undefined') return () => {};
      function onMessage(event: MessageEvent) {
        const data = event.data as { type?: unknown } | null;
        if (!data || typeof data !== 'object' || data.type !== CONNECTOR_CALLBACK_MESSAGE_TYPE) return;
        if (!isTrustedConnectorCallbackOrigin(event.origin, window.location.origin)) return;
        onTrustedCallback();
      }
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
    },
    subscribeWindowRefocus(onRefocus: () => void): () => void {
      if (typeof window === 'undefined') return () => {};
      function onVisibilityChange() {
        if (document.visibilityState !== 'visible') return;
        onRefocus();
      }
      window.addEventListener('focus', onRefocus);
      window.addEventListener('pageshow', onRefocus);
      document.addEventListener('visibilitychange', onVisibilityChange);
      return () => {
        window.removeEventListener('focus', onRefocus);
        window.removeEventListener('pageshow', onRefocus);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      };
    },
  };
}

export function createFakeConnectorsDependencies(
  options: FakeConnectorsPortOptions = {},
): ConnectorsDependencies {
  return {
    data: createFakeConnectorsPort(options),
    authPendingStorage: createBrowserConnectorAuthPendingStorage(),
    authBridge: createBrowserConnectorAuthBridge(),
  };
}
