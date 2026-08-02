/**
 * Pure logic ported from OD's ConnectorsBrowser.tsx + the two small pure
 * helpers it imported from EntryView.tsx (isTrustedConnectorCallbackOrigin,
 * sortConnectorsForSearch/getConnectorSearchScore/sortConnectorsForDisplay).
 * No React, no transport, no DOM — see `packages/ui/source-map.md`.
 */
import type {
  Connector,
  ConnectorAuthorizationPendingState,
  ConnectorActionResult,
  ConnectorStatusMap,
  ConnectorPanelAlert,
  ConnectorStatus,
  ProviderTab,
} from './types.js';

/** Restricts the catalog to a single provider tab's `match` predicate, defaulting to the first tab. */
export function scopeConnectorsToProvider(
  connectors: Connector[],
  providerTabs: readonly ProviderTab[],
  selectedProviderId: string,
): Connector[] {
  const tab = providerTabs.find((p) => p.id === selectedProviderId) ?? providerTabs[0];
  if (!tab) return connectors;
  return connectors.filter((connector) => tab.match(connector));
}

export function mergeConnectors(current: Connector[], incoming: Connector[]): Connector[] {
  if (current.length === 0) return incoming;
  const incomingById = new Map(incoming.map((connector) => [connector.id, connector]));
  const merged = current.map((connector) => {
    const next = incomingById.get(connector.id);
    if (!next) return connector;
    const toolCount = next.toolCount ?? connector.toolCount;
    const toolsNextCursor = next.toolsNextCursor ?? connector.toolsNextCursor;
    const toolsHasMore = next.toolsHasMore ?? connector.toolsHasMore;
    return {
      ...connector,
      ...next,
      tools: next.tools.length > 0 ? next.tools : connector.tools,
      ...(toolCount !== undefined ? { toolCount } : {}),
      ...(toolsNextCursor !== undefined ? { toolsNextCursor } : {}),
      ...(toolsHasMore !== undefined ? { toolsHasMore } : {}),
    };
  });
  const currentIds = new Set(current.map((connector) => connector.id));
  for (const connector of incoming) {
    if (!currentIds.has(connector.id)) merged.push(connector);
  }
  return merged;
}

export function pruneConnectorAuthorizationPending(
  pending: ConnectorAuthorizationPendingState,
  nowMs: number,
): ConnectorAuthorizationPendingState {
  const next: ConnectorAuthorizationPendingState = {};
  for (const [connectorId, state] of Object.entries(pending)) {
    const expiresAtMs = state.expiresAt ? Date.parse(state.expiresAt) : Number.NaN;
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) continue;
    next[connectorId] = {
      ...(state.expiresAt ? { expiresAt: state.expiresAt } : {}),
      ...(state.redirectUrl ? { redirectUrl: state.redirectUrl } : {}),
    };
  }
  return next;
}

export function parseConnectorAuthorizationPendingState(raw: string): ConnectorAuthorizationPendingState {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const pending: ConnectorAuthorizationPendingState = {};
    for (const [connectorId, state] of Object.entries(parsed as Record<string, unknown>)) {
      if (!connectorId) continue;
      if (state && typeof state === 'object' && !Array.isArray(state)) {
        const expiresAt = (state as Record<string, unknown>).expiresAt;
        const redirectUrl = (state as Record<string, unknown>).redirectUrl;
        pending[connectorId] = {
          ...(typeof expiresAt === 'string' && expiresAt.trim() ? { expiresAt } : {}),
          ...(typeof redirectUrl === 'string' && redirectUrl.trim() ? { redirectUrl } : {}),
        };
      } else {
        pending[connectorId] = {};
      }
    }
    return pending;
  } catch {
    return {};
  }
}

export function updateConnectorAuthorizationPendingFromConnectResponse(
  pending: ConnectorAuthorizationPendingState,
  response: ConnectorActionResult,
  nowMs: number,
): ConnectorAuthorizationPendingState {
  if (!response.connector) return pending;
  const connectorId = response.connector.id;
  const next = { ...pending };
  if (response.auth?.kind === 'redirect_required' || response.auth?.kind === 'pending') {
    next[connectorId] = {
      ...(response.auth.expiresAt ? { expiresAt: response.auth.expiresAt } : {}),
      ...(response.auth.redirectUrl ? { redirectUrl: response.auth.redirectUrl } : {}),
    };
    return pruneConnectorAuthorizationPending(next, nowMs);
  }
  delete next[connectorId];
  return pruneConnectorAuthorizationPending(next, nowMs);
}

export function updateConnectorAuthorizationPendingFromStatuses(
  pending: ConnectorAuthorizationPendingState,
  statuses: ConnectorStatusMap,
  nowMs: number,
): ConnectorAuthorizationPendingState {
  const next = { ...pending };
  for (const [connectorId, status] of Object.entries(statuses)) {
    if (status.status === 'connected') delete next[connectorId];
  }
  return pruneConnectorAuthorizationPending(next, nowMs);
}

export function clearConnectorAuthorizationErrorsForConnected(
  errors: Record<string, string>,
  statuses: ConnectorStatusMap,
): Record<string, string> {
  let mutated = false;
  const next = { ...errors };
  for (const [connectorId, status] of Object.entries(statuses)) {
    if (status.status === 'connected' && next[connectorId] !== undefined) {
      delete next[connectorId];
      mutated = true;
    }
  }
  return mutated ? next : errors;
}

export function clearConnectorAuthorizationCancelFailuresForConnected(
  failures: Record<string, boolean>,
  statuses: ConnectorStatusMap,
): Record<string, boolean> {
  let mutated = false;
  const next = { ...failures };
  for (const [connectorId, status] of Object.entries(statuses)) {
    if (status.status === 'connected' && next[connectorId] !== undefined) {
      delete next[connectorId];
      mutated = true;
    }
  }
  return mutated ? next : failures;
}

export function clearConnectorAuthorizationPending(
  pending: ConnectorAuthorizationPendingState,
  connectorId: string,
): ConnectorAuthorizationPendingState {
  if (pending[connectorId] === undefined) return pending;
  const next = { ...pending };
  delete next[connectorId];
  return next;
}

export function findStaleAuthorizations(
  pendingBeforeReload: ConnectorAuthorizationPendingState,
  statuses: ConnectorStatusMap,
  nowMs: number,
): string[] {
  return Object.keys(pendingBeforeReload).filter((connectorId) => {
    if (statuses[connectorId]?.status === 'connected') return false;
    const expiresAt = pendingBeforeReload[connectorId]?.expiresAt;
    if (!expiresAt) return false;
    const expiresAtMs = Date.parse(expiresAt);
    return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
  });
}

export function connectorAuthSnapshotChanged(
  current: Pick<Connector, 'status' | 'accountLabel' | 'lastError'> | null | undefined,
  next: { status: string; accountLabel?: string; lastError?: string } | null | undefined,
): boolean {
  if (current == null && next == null) return false;
  if (current == null || next == null) return true;
  return (
    next.status !== current.status ||
    next.accountLabel !== current.accountLabel ||
    next.lastError !== current.lastError
  );
}

export function hasConnectorStatusChanges(current: Connector[], statuses: ConnectorStatusMap): boolean {
  return current.some((connector) => connectorAuthSnapshotChanged(connector, statuses[connector.id]));
}

export function applyConnectorStatuses(current: Connector[], statuses: ConnectorStatusMap): Connector[] {
  if (Object.keys(statuses).length === 0) return current;
  return current.map((connector) => {
    const next = statuses[connector.id];
    if (!next) return connector;
    const { accountLabel: _accountLabel, lastError: _lastError, ...base } = connector;
    return { ...base, ...next };
  });
}

export function getConnectorDisplayToolCount(connector: Connector): number {
  return connector.toolCount ?? connector.tools.length;
}

export function hasLoadedAllAdvertisedConnectorTools(connector: Connector): boolean {
  if (connector.toolsNextCursor) return false;
  if (connector.toolCount === undefined) return connector.tools.length > 0;
  return connector.tools.length >= connector.toolCount;
}

function mergeConnectorTools(
  current: Connector['tools'],
  incoming: Connector['tools'],
): Connector['tools'] {
  const seen = new Set<string>();
  const merged: Connector['tools'] = [];
  for (const tool of [...current, ...incoming]) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    merged.push(tool);
  }
  return merged;
}

export function mergeConnectorToolPreview(current: Connector, next: Connector, append: boolean): Connector {
  const toolCount = next.toolCount ?? current.toolCount;
  const featuredToolNames = next.featuredToolNames ?? current.featuredToolNames;
  const merged: Connector = {
    ...current,
    ...next,
    tools: append ? mergeConnectorTools(current.tools, next.tools) : next.tools,
    toolsHasMore: next.toolsHasMore ?? false,
    ...(toolCount !== undefined ? { toolCount } : {}),
    ...(featuredToolNames !== undefined ? { featuredToolNames } : {}),
  };
  if (next.toolsNextCursor !== undefined) return { ...merged, toolsNextCursor: next.toolsNextCursor };
  const { toolsNextCursor: _toolsNextCursor, ...withoutCursor } = merged;
  return withoutCursor;
}

export function mergeConnectorActionResult(current: Connector, next: Connector): Connector {
  const toolCount = next.toolCount ?? current.toolCount;
  const featuredToolNames = next.featuredToolNames ?? current.featuredToolNames;
  return {
    ...current,
    ...next,
    tools: next.tools.length > 0 ? next.tools : current.tools,
    ...(toolCount !== undefined ? { toolCount } : {}),
    ...(featuredToolNames !== undefined ? { featuredToolNames } : {}),
  };
}

function normalizedSearchValue(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function scoreConnectorText(value: string | undefined, query: string, baseScore: number): number | null {
  const normalized = normalizedSearchValue(value);
  if (!normalized) return null;
  if (normalized === query) return baseScore;
  if (normalized.startsWith(query)) return baseScore + 1;
  if (normalized.includes(query)) return baseScore + 2;
  return null;
}

export function getConnectorSearchScore(connector: Connector, query: string): number | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  const scores: number[] = [];
  const collect = (value: string | undefined, baseScore: number) => {
    const score = scoreConnectorText(value, normalizedQuery, baseScore);
    if (score !== null) scores.push(score);
  };

  collect(connector.name, 0);
  collect(connector.provider, 0);
  collect(connector.category, 3);
  collect(connector.accountLabel, 3);
  for (const tool of connector.tools) {
    collect(tool.title, 5);
    collect(tool.name, 5);
  }
  collect(connector.description, 8);
  for (const tool of connector.tools) {
    collect(tool.description, 8);
  }

  return scores.length ? Math.min(...scores) : null;
}

export function sortConnectorsForDisplay(connectors: Connector[]): Connector[] {
  return [...connectors].sort((a, b) => {
    const aConnected = a.status === 'connected';
    const bConnected = b.status === 'connected';
    if (aConnected !== bConnected) return aConnected ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);
  });
}

export function sortConnectorsForSearch(connectors: Connector[], query: string): Connector[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return sortConnectorsForDisplay(connectors);

  return [...connectors]
    .map((connector) => ({ connector, score: getConnectorSearchScore(connector, normalizedQuery) }))
    .filter((entry): entry is { connector: Connector; score: number } => entry.score !== null)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const aConnected = a.connector.status === 'connected';
      const bConnected = b.connector.status === 'connected';
      if (aConnected !== bConnected) return aConnected ? -1 : 1;
      return (
        a.connector.name.localeCompare(b.connector.name, undefined, { sensitivity: 'base' }) ||
        a.connector.id.localeCompare(b.connector.id)
      );
    })
    .map((entry) => entry.connector);
}

/** Trusts same-origin + localhost-loopback so packaged dev URLs (different ports) keep working. */
export function isTrustedConnectorCallbackOrigin(origin: string, currentOrigin: string): boolean {
  if (origin === currentOrigin) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]' ||
      url.hostname === '::1'
    );
  } catch {
    return false;
  }
}

export function connectorPanelAlerts(
  connectors: Connector[],
  detailConnectorId: string | null,
  authorizationError: Record<string, string>,
  authorizationCancelFailed: Record<string, boolean>,
  cancelFailedMessage: string,
): ConnectorPanelAlert[] {
  const alerts: ConnectorPanelAlert[] = [];
  for (const connector of connectors) {
    if (connector.id === detailConnectorId) continue;
    const message = authorizationError[connector.id];
    if (message) {
      alerts.push({ connectorId: connector.id, connectorName: connector.name, message });
    }
    if (authorizationCancelFailed[connector.id]) {
      alerts.push({ connectorId: connector.id, connectorName: connector.name, message: cancelFailedMessage });
    }
  }
  return alerts;
}

/**
 * Default `getDisplayableAccountLabel` — shows any account label the host
 * supplies. The origin hid this for one specific provider (Composio) with no
 * documented rationale; that's provider-specific policy, not generic logic,
 * so it's now a host-overridable default rather than baked in here. A host
 * that wants to hide the label for a specific provider passes its own
 * `getDisplayableAccountLabel` prop.
 */
export function getDisplayableConnectorAccountLabel(connector: Connector): string | undefined {
  return connector.accountLabel;
}

export function formatToolsBadge(count: number): string {
  if (count === 0) return 'No tools';
  if (count === 1) return '1 tool';
  return `${count} tools`;
}

/** i18n-friendly variant of {@link formatToolsBadge}: a translation key plus
 *  interpolation vars, so a host dictionary can translate independent of the
 *  specific count rather than needing one entry per possible count value. */
export function toolsBadgeTranslation(count: number): { key: string; vars?: Record<string, number> } {
  if (count === 0) return { key: 'No tools' };
  if (count === 1) return { key: '1 tool' };
  return { key: '{count} tools', vars: { count } };
}

export function statusLabel(status: ConnectorStatus): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'connected':
      return 'Connected';
    case 'error':
      return 'Error';
    case 'disabled':
      return 'Disabled';
  }
}

export function defaultCategoryLabel(category: string): string {
  return category;
}

/** Stable hash -> palette index, used for the fallback logo tile's hue. */
export function fallbackLogoPaletteIndex(seed: string, paletteSize: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % paletteSize;
}

export function fallbackLogoInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/u);
  if (parts.length === 1) {
    const single = parts[0]!;
    // `single` is `parts[0]` when `parts.length === 1` — i.e. the whole
    // already-`.trim()`-ed `cleaned` string as one word, which the earlier
    // `!cleaned` check already proved non-empty. `single[0]` is therefore
    // always a defined character; only `single[1]` (absent for a
    // single-character name) is a real optional case. The `single[0] ?? ''`
    // fallback this used to have was dead code for every real input,
    // removed rather than tested around (same pattern as this file's other
    // `?? ''`/`?.[0] ?? ''` precedents just below).
    return single[0]!.toUpperCase() + (single[1] ?? '').toLowerCase();
  }
  // `cleaned` was already `.trim()`-ed above, so splitting on `\s+` can
  // never produce a leading empty segment — combined with the
  // `parts.length === 1` early return above, `parts[0]` and `parts[1]` are
  // both guaranteed non-empty strings here. The `?.[0] ?? ''` defensive
  // fallbacks this used to have were dead code for every real input,
  // removed rather than tested around (same pattern as this package's
  // `utils/auto-open-file.ts` `basenameOf` precedent).
  const first = parts[0]![0]!;
  const second = parts[1]![0]!;
  return (first + second).toUpperCase();
}
