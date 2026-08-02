/**
 * Generic OAuth-integration-marketplace domain types. Ported from the origin
 * product's ConnectorsBrowser.tsx (see the vendored reference tree cited in
 * `packages/ui/source-map.md`), stripped of Composio/product-specific
 * wire-shape specifics — see that file for the full provenance note.
 */

export type ConnectorStatus = 'available' | 'connected' | 'error' | 'disabled';

export interface ConnectorToolSafety {
  sideEffect: string;
  reason?: string;
}

export interface ConnectorTool {
  name: string;
  title?: string;
  description?: string;
  safety: ConnectorToolSafety;
}

/** The connector's own auth binding — which auth provider backs it, if any. */
export interface ConnectorAuthBinding {
  provider: string;
}

export interface Connector {
  id: string;
  name: string;
  /** Display provider name (e.g. "Composio", "Zapier"). */
  provider: string;
  category: string;
  description?: string;
  status: ConnectorStatus;
  accountLabel?: string;
  lastError?: string;
  auth?: ConnectorAuthBinding;
  tools: ConnectorTool[];
  toolCount?: number;
  toolsNextCursor?: string;
  toolsHasMore?: boolean;
  featuredToolNames?: string[];
  /** Host-resolved logo URL. Falls back to initials when absent. */
  logoUrl?: string;
}

export type ConnectorStatusEntry = Pick<Connector, 'status'> &
  Partial<Pick<Connector, 'accountLabel' | 'lastError'>>;

export type ConnectorStatusMap = Record<string, ConnectorStatusEntry>;

/** The result of an in-flight (or just-started) connect authorization. */
export interface ConnectorAuthResult {
  kind: 'redirect_required' | 'pending' | 'connected';
  redirectUrl?: string;
  expiresAt?: string;
}

export interface ConnectorActionResult {
  connector: Connector | null;
  auth?: ConnectorAuthResult;
  error?: string;
}

export interface ConnectorAuthorizationPending {
  expiresAt?: string;
  redirectUrl?: string;
}

export type ConnectorAuthorizationPendingState = Record<string, ConnectorAuthorizationPending>;

/**
 * A provider tab. `match` decides whether a given catalog entry belongs to
 * this provider — kept as a predicate (not a static field-equality check) so
 * a host can bind it to whatever field shape its own catalog uses, even
 * though a single-provider host only ever needs one tab.
 */
export interface ProviderTab {
  id: string;
  label: string;
  match: (connector: Connector) => boolean;
}

export interface ConnectorPanelAlert {
  connectorId: string;
  connectorName: string;
  message: string;
}

export type ConnectorAction = 'connect' | 'disconnect';

export interface PendingConnectorAction {
  connectorId: string;
  action: ConnectorAction;
}

export interface ConnectorAuthResultEvent {
  connectorId: string;
  action: ConnectorAction | 'refresh';
  result: 'success' | 'failed' | 'cancelled';
  errorCode?: string;
}
