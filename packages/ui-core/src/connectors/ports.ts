/**
 * The DI seam. Everything in this feature reaches transport/DOM only
 * through these interfaces — `dependencies.ts` is the one file allowed to
 * bind a real implementation.
 */
import type {
  Connector,
  ConnectorActionResult,
  ConnectorStatusMap,
  ConnectorAuthorizationPendingState,
} from './types.js';

export interface FetchConnectorDetailOptions {
  hydrateTools?: boolean;
  toolsLimit?: number;
  toolsCursor?: string;
}

/** The connector-catalog + connect/disconnect transport. */
export interface ConnectorsPort {
  fetchConnectors(): Promise<Connector[]>;
  /**
   * Lazy secondary enrichment (richer per-connector metadata/tools),
   * gated by the host on whatever "the provider is configured" concept it
   * has (e.g. an API key saved). Optional: a host with a single-phase
   * catalog can omit it entirely.
   */
  fetchConnectorEnrichment?(options?: { refresh?: boolean }): Promise<Connector[]>;
  fetchConnectorStatuses(): Promise<ConnectorStatusMap>;
  fetchConnectorDetail(connectorId: string, options?: FetchConnectorDetailOptions): Promise<Connector | null>;
  connectConnector(connectorId: string): Promise<ConnectorActionResult>;
  disconnectConnector(connectorId: string): Promise<Connector | null>;
  cancelConnectorAuthorization(connectorId: string): Promise<Connector | null>;
  /** Opens a redirect URL (OAuth continuation) in an external browser/tab. */
  openExternalUrl(url: string): Promise<boolean>;
}

/** sessionStorage-shaped persistence for in-flight authorization state. */
export interface ConnectorAuthPendingStoragePort {
  load(): ConnectorAuthorizationPendingState;
  save(state: ConnectorAuthorizationPendingState): void;
}

/**
 * The two browser-subscription bridges the OAuth handshake needs: a
 * postMessage callback from a popup/system-browser tab, and a
 * focus/pageshow/visibilitychange refresh so a system-browser flow (which
 * has no opener to post back to) still resolves when the user returns.
 */
export interface ConnectorAuthBridgePort {
  subscribeAuthCallback(onTrustedCallback: () => void): () => void;
  subscribeWindowRefocus(onRefocus: () => void): () => void;
}

export interface ConnectorsDependencies {
  data: ConnectorsPort;
  authPendingStorage: ConnectorAuthPendingStoragePort;
  authBridge: ConnectorAuthBridgePort;
}
