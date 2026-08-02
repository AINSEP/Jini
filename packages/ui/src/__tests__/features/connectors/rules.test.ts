import { describe, expect, it } from 'vitest';
import type { Connector, ConnectorActionResult, ConnectorStatusMap } from '../../../features/connectors/types.js';
import {
  applyConnectorStatuses,
  clearConnectorAuthorizationCancelFailuresForConnected,
  clearConnectorAuthorizationErrorsForConnected,
  clearConnectorAuthorizationPending,
  connectorAuthSnapshotChanged,
  connectorPanelAlerts,
  defaultCategoryLabel,
  fallbackLogoInitials,
  fallbackLogoPaletteIndex,
  findStaleAuthorizations,
  formatToolsBadge,
  getConnectorDisplayToolCount,
  getConnectorSearchScore,
  getDisplayableConnectorAccountLabel,
  hasConnectorStatusChanges,
  hasLoadedAllAdvertisedConnectorTools,
  isTrustedConnectorCallbackOrigin,
  mergeConnectorActionResult,
  mergeConnectorToolPreview,
  mergeConnectors,
  parseConnectorAuthorizationPendingState,
  pruneConnectorAuthorizationPending,
  scopeConnectorsToProvider,
  sortConnectorsForDisplay,
  sortConnectorsForSearch,
  statusLabel,
  toolsBadgeTranslation,
  updateConnectorAuthorizationPendingFromConnectResponse,
  updateConnectorAuthorizationPendingFromStatuses,
} from '../../../features/connectors/rules.js';

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'slack',
    name: 'Slack',
    provider: 'Composio',
    category: 'communication',
    status: 'available',
    tools: [],
    ...overrides,
  };
}

describe('mergeConnectors', () => {
  it('returns incoming when current is empty', () => {
    const incoming = [makeConnector()];
    expect(mergeConnectors([], incoming)).toBe(incoming);
  });

  it('preserves existing tools when incoming has none, but takes incoming otherwise', () => {
    const current = [makeConnector({ tools: [{ name: 't1', safety: { sideEffect: 'no_side_effect' } }] })];
    const incoming = [makeConnector({ status: 'connected', tools: [] })];
    const merged = mergeConnectors(current, incoming);
    expect(merged[0]!.status).toBe('connected');
    expect(merged[0]!.tools).toHaveLength(1);
  });

  it('adds new connectors not present in current', () => {
    const current = [makeConnector({ id: 'a' })];
    const incoming = [makeConnector({ id: 'a' }), makeConnector({ id: 'b' })];
    const merged = mergeConnectors(current, incoming);
    expect(merged.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('carries forward toolCount/toolsNextCursor/toolsHasMore when incoming omits them', () => {
    const current = [makeConnector({ toolCount: 5, toolsNextCursor: 'cursor-1', toolsHasMore: true })];
    const incoming = [makeConnector({})];
    const merged = mergeConnectors(current, incoming);
    expect(merged[0]!.toolCount).toBe(5);
    expect(merged[0]!.toolsNextCursor).toBe('cursor-1');
    expect(merged[0]!.toolsHasMore).toBe(true);
  });
});

describe('mergeConnectorToolPreview', () => {
  const base = makeConnector({ tools: [{ name: 'a', safety: { sideEffect: 'no_side_effect' } }] });

  it('appends and dedupes tools when append=true', () => {
    const next = makeConnector({ tools: [{ name: 'a', safety: { sideEffect: 'no_side_effect' } }, { name: 'b', safety: { sideEffect: 'no_side_effect' } }] });
    const merged = mergeConnectorToolPreview(base, next, true);
    expect(merged.tools.map((t) => t.name)).toEqual(['a', 'b']);
  });

  it('replaces tools when append=false', () => {
    const next = makeConnector({ tools: [{ name: 'b', safety: { sideEffect: 'no_side_effect' } }] });
    const merged = mergeConnectorToolPreview(base, next, false);
    expect(merged.tools.map((t) => t.name)).toEqual(['b']);
  });

  it('drops toolsNextCursor when the next page has none (pagination end)', () => {
    const withCursor = { ...base, toolsNextCursor: 'cursor-1' };
    const next = makeConnector({ tools: [] });
    const merged = mergeConnectorToolPreview(withCursor, next, true);
    expect(merged.toolsNextCursor).toBeUndefined();
  });

  it('carries forward featuredToolNames when next omits it, and takes next when provided', () => {
    const withFeatured = { ...base, featuredToolNames: ['a'] };
    const nextWithout = makeConnector({ tools: [] });
    expect(mergeConnectorToolPreview(withFeatured, nextWithout, true).featuredToolNames).toEqual(['a']);

    const nextWith = makeConnector({ tools: [], featuredToolNames: ['b'] });
    expect(mergeConnectorToolPreview(withFeatured, nextWith, true).featuredToolNames).toEqual(['b']);
  });

  it('keeps toolsNextCursor when the next page provides one', () => {
    const next = makeConnector({ tools: [], toolsNextCursor: 'cursor-2' });
    const merged = mergeConnectorToolPreview(base, next, true);
    expect(merged.toolsNextCursor).toBe('cursor-2');
  });
});

describe('mergeConnectorActionResult', () => {
  it('keeps current tools when next has none', () => {
    const current = makeConnector({ tools: [{ name: 'a', safety: { sideEffect: 'no_side_effect' } }] });
    const next = makeConnector({ status: 'connected', tools: [] });
    const merged = mergeConnectorActionResult(current, next);
    expect(merged.status).toBe('connected');
    expect(merged.tools).toHaveLength(1);
  });

  it('takes next tools when next has some', () => {
    const current = makeConnector({ tools: [{ name: 'a', safety: { sideEffect: 'no_side_effect' } }] });
    const next = makeConnector({ tools: [{ name: 'b', safety: { sideEffect: 'no_side_effect' } }] });
    const merged = mergeConnectorActionResult(current, next);
    expect(merged.tools.map((t) => t.name)).toEqual(['b']);
  });

  it('carries forward toolCount and featuredToolNames when next omits them', () => {
    const current = makeConnector({ toolCount: 5, featuredToolNames: ['a'] });
    const next = makeConnector({});
    const merged = mergeConnectorActionResult(current, next);
    expect(merged.toolCount).toBe(5);
    expect(merged.featuredToolNames).toEqual(['a']);
  });

  it('takes next toolCount/featuredToolNames when provided', () => {
    const current = makeConnector({ toolCount: 5, featuredToolNames: ['a'] });
    const next = makeConnector({ toolCount: 9, featuredToolNames: ['b'] });
    const merged = mergeConnectorActionResult(current, next);
    expect(merged.toolCount).toBe(9);
    expect(merged.featuredToolNames).toEqual(['b']);
  });
});

describe('pruneConnectorAuthorizationPending', () => {
  it('drops entries whose expiresAt is in the past', () => {
    const pending = { a: { expiresAt: '2020-01-01T00:00:00Z' }, b: { expiresAt: '2099-01-01T00:00:00Z' } };
    const pruned = pruneConnectorAuthorizationPending(pending, Date.parse('2025-01-01T00:00:00Z'));
    expect(Object.keys(pruned)).toEqual(['b']);
  });

  it('keeps entries with no expiresAt', () => {
    const pending = { a: {} };
    expect(Object.keys(pruneConnectorAuthorizationPending(pending, Date.now()))).toEqual(['a']);
  });
});

describe('parseConnectorAuthorizationPendingState', () => {
  it('parses a valid JSON blob', () => {
    const raw = JSON.stringify({ a: { expiresAt: '2099-01-01T00:00:00Z' } });
    expect(parseConnectorAuthorizationPendingState(raw)).toEqual({ a: { expiresAt: '2099-01-01T00:00:00Z' } });
  });

  it('returns {} for malformed JSON', () => {
    expect(parseConnectorAuthorizationPendingState('{not json')).toEqual({});
  });

  it('returns {} for a JSON array', () => {
    expect(parseConnectorAuthorizationPendingState('[1,2,3]')).toEqual({});
  });

  it('ignores non-string expiresAt/redirectUrl fields', () => {
    const raw = JSON.stringify({ a: { expiresAt: 123, redirectUrl: null } });
    expect(parseConnectorAuthorizationPendingState(raw)).toEqual({ a: {} });
  });

  it('keeps a valid redirectUrl string', () => {
    const raw = JSON.stringify({ a: { redirectUrl: 'https://example.test/authorize' } });
    expect(parseConnectorAuthorizationPendingState(raw)).toEqual({
      a: { redirectUrl: 'https://example.test/authorize' },
    });
  });

  it('treats a non-object state value as an empty pending entry', () => {
    const raw = JSON.stringify({ a: 'not-an-object', b: 42, c: null });
    expect(parseConnectorAuthorizationPendingState(raw)).toEqual({ a: {}, b: {}, c: {} });
  });

  it('skips an entry with a blank connector id key', () => {
    const raw = JSON.stringify({ '': { expiresAt: '2099-01-01T00:00:00Z' }, kept: {} });
    expect(parseConnectorAuthorizationPendingState(raw)).toEqual({ kept: {} });
  });
});

describe('updateConnectorAuthorizationPendingFromConnectResponse', () => {
  const now = Date.parse('2025-01-01T00:00:00Z');

  it('records a pending entry for redirect_required', () => {
    const response: ConnectorActionResult = {
      connector: makeConnector(),
      auth: { kind: 'redirect_required', redirectUrl: 'https://example.com', expiresAt: '2099-01-01T00:00:00Z' },
    };
    const next = updateConnectorAuthorizationPendingFromConnectResponse({}, response, now);
    expect(next.slack).toEqual({ expiresAt: '2099-01-01T00:00:00Z', redirectUrl: 'https://example.com' });
  });

  it('records a pending entry for pending', () => {
    const response: ConnectorActionResult = { connector: makeConnector(), auth: { kind: 'pending' } };
    const next = updateConnectorAuthorizationPendingFromConnectResponse({}, response, now);
    expect(next.slack).toEqual({});
  });

  it('clears pending for a connected result', () => {
    const response: ConnectorActionResult = { connector: makeConnector(), auth: { kind: 'connected' } };
    const next = updateConnectorAuthorizationPendingFromConnectResponse({ slack: {} }, response, now);
    expect(next.slack).toBeUndefined();
  });

  it('is a no-op when connector is null', () => {
    const pending = { slack: {} };
    const response: ConnectorActionResult = { connector: null };
    expect(updateConnectorAuthorizationPendingFromConnectResponse(pending, response, now)).toBe(pending);
  });
});

describe('updateConnectorAuthorizationPendingFromStatuses', () => {
  it('clears pending entries whose status is now connected', () => {
    const pending = { slack: {}, notion: {} };
    const statuses: ConnectorStatusMap = { slack: { status: 'connected' } };
    const next = updateConnectorAuthorizationPendingFromStatuses(pending, statuses, Date.now());
    expect(next).toEqual({ notion: {} });
  });
});

describe('clearConnectorAuthorizationErrorsForConnected / CancelFailuresForConnected', () => {
  const statuses: ConnectorStatusMap = { slack: { status: 'connected' } };

  it('clears errors for now-connected connectors, returning the same reference if nothing changed', () => {
    const errors = { slack: 'oops' };
    expect(clearConnectorAuthorizationErrorsForConnected(errors, statuses)).toEqual({});
    const untouched = { notion: 'oops' };
    expect(clearConnectorAuthorizationErrorsForConnected(untouched, statuses)).toBe(untouched);
  });

  it('clears cancel-failed flags for now-connected connectors', () => {
    const failed = { slack: true };
    expect(clearConnectorAuthorizationCancelFailuresForConnected(failed, statuses)).toEqual({});
  });
});

describe('clearConnectorAuthorizationPending', () => {
  it('removes the entry and returns a new object', () => {
    const pending = { slack: {}, notion: {} };
    const next = clearConnectorAuthorizationPending(pending, 'slack');
    expect(next).toEqual({ notion: {} });
    expect(next).not.toBe(pending);
  });

  it('returns the same reference when the id is absent', () => {
    const pending = { notion: {} };
    expect(clearConnectorAuthorizationPending(pending, 'slack')).toBe(pending);
  });
});

describe('findStaleAuthorizations', () => {
  const now = Date.parse('2025-01-01T00:00:00Z');

  it('flags a pending authorization past its expiry with no connected status', () => {
    const pending = { slack: { expiresAt: '2020-01-01T00:00:00Z' } };
    expect(findStaleAuthorizations(pending, {}, now)).toEqual(['slack']);
  });

  it('does not flag an authorization that already connected', () => {
    const pending = { slack: { expiresAt: '2020-01-01T00:00:00Z' } };
    const statuses: ConnectorStatusMap = { slack: { status: 'connected' } };
    expect(findStaleAuthorizations(pending, statuses, now)).toEqual([]);
  });

  it('does not flag an authorization with no expiresAt (still genuinely pending)', () => {
    expect(findStaleAuthorizations({ slack: {} }, {}, now)).toEqual([]);
  });

  it('does not flag an authorization not yet expired', () => {
    expect(findStaleAuthorizations({ slack: { expiresAt: '2099-01-01T00:00:00Z' } }, {}, now)).toEqual([]);
  });
});

describe('connectorAuthSnapshotChanged / hasConnectorStatusChanges', () => {
  it('detects a status change', () => {
    expect(connectorAuthSnapshotChanged({ status: 'available' }, { status: 'connected' })).toBe(true);
  });

  it('detects no change', () => {
    expect(connectorAuthSnapshotChanged({ status: 'available' }, { status: 'available' })).toBe(false);
  });

  it('reports no change when both sides are null/undefined', () => {
    expect(connectorAuthSnapshotChanged(null, undefined)).toBe(false);
    expect(connectorAuthSnapshotChanged(undefined, null)).toBe(false);
  });

  it('reports a change when exactly one side is null/undefined', () => {
    expect(connectorAuthSnapshotChanged(null, { status: 'connected' })).toBe(true);
    expect(connectorAuthSnapshotChanged({ status: 'connected' }, null)).toBe(true);
  });

  it('hasConnectorStatusChanges is true when any connector changed', () => {
    const current = [makeConnector({ status: 'available' })];
    const statuses: ConnectorStatusMap = { slack: { status: 'connected' } };
    expect(hasConnectorStatusChanges(current, statuses)).toBe(true);
  });

  it('hasConnectorStatusChanges is false when nothing changed', () => {
    const current = [makeConnector({ status: 'connected' })];
    const statuses: ConnectorStatusMap = { slack: { status: 'connected' } };
    expect(hasConnectorStatusChanges(current, statuses)).toBe(false);
  });
});

describe('applyConnectorStatuses', () => {
  it('applies a status update to the matching connector', () => {
    const current = [makeConnector({ status: 'available' })];
    const next = applyConnectorStatuses(current, { slack: { status: 'connected', accountLabel: 'me@x.com' } });
    expect(next[0]!.status).toBe('connected');
    expect(next[0]!.accountLabel).toBe('me@x.com');
  });

  it('returns the same reference when there are no statuses', () => {
    const current = [makeConnector()];
    expect(applyConnectorStatuses(current, {})).toBe(current);
  });

  it('clears accountLabel/lastError when the new status omits them', () => {
    const current = [makeConnector({ accountLabel: 'stale', lastError: 'stale error' })];
    const next = applyConnectorStatuses(current, { slack: { status: 'available' } });
    expect(next[0]!.accountLabel).toBeUndefined();
    expect(next[0]!.lastError).toBeUndefined();
  });
});

describe('getConnectorDisplayToolCount / hasLoadedAllAdvertisedConnectorTools', () => {
  it('prefers toolCount over tools.length', () => {
    expect(getConnectorDisplayToolCount(makeConnector({ toolCount: 10, tools: [] }))).toBe(10);
  });

  it('falls back to tools.length when toolCount is absent', () => {
    expect(getConnectorDisplayToolCount(makeConnector({ tools: [{ name: 'a', safety: { sideEffect: 'no_side_effect' } }] }))).toBe(1);
  });

  it('is false while a next cursor remains', () => {
    expect(hasLoadedAllAdvertisedConnectorTools(makeConnector({ toolsNextCursor: 'c1' }))).toBe(false);
  });

  it('is true once tools.length reaches toolCount with no next cursor', () => {
    const connector = makeConnector({ toolCount: 1, tools: [{ name: 'a', safety: { sideEffect: 'no_side_effect' } }] });
    expect(hasLoadedAllAdvertisedConnectorTools(connector)).toBe(true);
  });

  it('is false when toolCount is undefined and there are no tools yet', () => {
    expect(hasLoadedAllAdvertisedConnectorTools(makeConnector({ tools: [] }))).toBe(false);
  });
});

describe('scopeConnectorsToProvider', () => {
  const tabs = [
    { id: 'composio', label: 'Composio', match: (c: Connector) => c.provider === 'Composio' },
    { id: 'zapier', label: 'Zapier', match: (c: Connector) => c.provider === 'Zapier' },
  ];
  const connectors = [makeConnector({ id: 'a', provider: 'Composio' }), makeConnector({ id: 'b', provider: 'Zapier' })];

  it('filters to the selected tab', () => {
    expect(scopeConnectorsToProvider(connectors, tabs, 'zapier').map((c) => c.id)).toEqual(['b']);
  });

  it('falls back to the first tab for an unknown selectedProviderId', () => {
    expect(scopeConnectorsToProvider(connectors, tabs, 'nonexistent').map((c) => c.id)).toEqual(['a']);
  });

  it('returns all connectors unfiltered when there are no tabs at all', () => {
    expect(scopeConnectorsToProvider(connectors, [], 'anything')).toBe(connectors);
  });
});

describe('search scoring + sorting', () => {
  const connectors = [
    makeConnector({ id: 'a', name: 'Zendesk', status: 'available' }),
    makeConnector({ id: 'b', name: 'Airtable', status: 'connected' }),
    makeConnector({ id: 'c', name: 'Notion', status: 'available', description: 'zendesk-like ticketing' }),
  ];

  it('scores an exact name match best', () => {
    expect(getConnectorSearchScore(connectors[0]!, 'zendesk')).toBe(0);
  });

  it('scores a description-only match worse than a name match', () => {
    const nameScore = getConnectorSearchScore(connectors[0]!, 'zendesk')!;
    const descScore = getConnectorSearchScore(connectors[2]!, 'zendesk')!;
    expect(descScore).toBeGreaterThan(nameScore);
  });

  it('returns null when nothing matches', () => {
    expect(getConnectorSearchScore(connectors[0]!, 'nonexistent-xyz')).toBeNull();
  });

  it('sortConnectorsForDisplay puts connected connectors first, then alphabetical', () => {
    const sorted = sortConnectorsForDisplay(connectors);
    expect(sorted[0]!.id).toBe('b');
  });

  it('sortConnectorsForSearch with empty query behaves like sortConnectorsForDisplay', () => {
    expect(sortConnectorsForSearch(connectors, '').map((c) => c.id)).toEqual(sortConnectorsForDisplay(connectors).map((c) => c.id));
  });

  it('sortConnectorsForSearch filters out non-matches and ranks matches', () => {
    const results = sortConnectorsForSearch(connectors, 'zendesk');
    expect(results.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('returns 0 for an empty (post-trim) query rather than scanning fields', () => {
    expect(getConnectorSearchScore(connectors[0]!, '   ')).toBe(0);
  });

  it('matches against tool title/name/description too', () => {
    const withTools = makeConnector({
      id: 'd',
      name: 'Other',
      tools: [
        {
          name: 'send_ticket',
          title: 'Send Zendesk Ticket',
          description: 'files a zendesk-style ticket',
          safety: { sideEffect: 'no_side_effect' },
        },
      ],
    });
    expect(getConnectorSearchScore(withTools, 'zendesk')).not.toBeNull();

    const nameOnly = makeConnector({
      id: 'e',
      name: 'Other2',
      tools: [{ name: 'zendesk_tool', safety: { sideEffect: 'no_side_effect' } }],
    });
    expect(getConnectorSearchScore(nameOnly, 'zendesk')).not.toBeNull();
  });

  it('sortConnectorsForDisplay breaks a same-name tie by id', () => {
    const tied = [
      makeConnector({ id: 'z', name: 'Same' }),
      makeConnector({ id: 'a', name: 'Same' }),
    ];
    expect(sortConnectorsForDisplay(tied).map((c) => c.id)).toEqual(['a', 'z']);
  });

  it('sortConnectorsForSearch breaks an equal-score tie by connected status, in either input order', () => {
    const availableFirst = [
      makeConnector({ id: 'z', name: 'Match', status: 'available' }),
      makeConnector({ id: 'a', name: 'Match', status: 'connected' }),
    ];
    expect(sortConnectorsForSearch(availableFirst, 'match').map((c) => c.id)).toEqual(['a', 'z']);

    const connectedFirst = [
      makeConnector({ id: 'a', name: 'Match', status: 'connected' }),
      makeConnector({ id: 'z', name: 'Match', status: 'available' }),
    ];
    expect(sortConnectorsForSearch(connectedFirst, 'match').map((c) => c.id)).toEqual(['a', 'z']);
  });

  it('sortConnectorsForSearch breaks an equal-score, equal-status tie by name then id', () => {
    const tied = [
      makeConnector({ id: 'z', name: 'Match Two', status: 'available' }),
      makeConnector({ id: 'a', name: 'Match One', status: 'available' }),
    ];
    expect(sortConnectorsForSearch(tied, 'match').map((c) => c.id)).toEqual(['a', 'z']);
  });

  it('sortConnectorsForSearch breaks an equal-score, equal-status, equal-name tie by id alone', () => {
    const tied = [
      makeConnector({ id: 'z', name: 'Match', status: 'available' }),
      makeConnector({ id: 'a', name: 'Match', status: 'available' }),
    ];
    expect(sortConnectorsForSearch(tied, 'match').map((c) => c.id)).toEqual(['a', 'z']);
  });
});

describe('isTrustedConnectorCallbackOrigin', () => {
  it('trusts same-origin', () => {
    expect(isTrustedConnectorCallbackOrigin('https://app.example.com', 'https://app.example.com')).toBe(true);
  });

  it('trusts localhost regardless of current origin', () => {
    expect(isTrustedConnectorCallbackOrigin('http://localhost:5173', 'https://app.example.com')).toBe(true);
  });

  it('trusts the loopback IP', () => {
    expect(isTrustedConnectorCallbackOrigin('http://127.0.0.1:5173', 'https://app.example.com')).toBe(true);
  });

  it('rejects an untrusted origin', () => {
    expect(isTrustedConnectorCallbackOrigin('https://evil.example.com', 'https://app.example.com')).toBe(false);
  });

  it('rejects a non-http(s) protocol even if the hostname looks like localhost', () => {
    expect(isTrustedConnectorCallbackOrigin('file://localhost', 'https://app.example.com')).toBe(false);
  });

  it('rejects a malformed origin string', () => {
    expect(isTrustedConnectorCallbackOrigin('not a url', 'https://app.example.com')).toBe(false);
  });
});

describe('connectorPanelAlerts', () => {
  it('surfaces auth-error and cancel-failed alerts, skipping the open detail connector', () => {
    const connectors = [makeConnector({ id: 'a', name: 'A' }), makeConnector({ id: 'b', name: 'B' })];
    const alerts = connectorPanelAlerts(connectors, 'b', { a: 'boom', b: 'ignored (open in drawer)' }, { a: true }, 'cancel failed');
    expect(alerts).toEqual([
      { connectorId: 'a', connectorName: 'A', message: 'boom' },
      { connectorId: 'a', connectorName: 'A', message: 'cancel failed' },
    ]);
  });
});

describe('getDisplayableConnectorAccountLabel', () => {
  it('shows the account label regardless of provider (no provider-specific policy baked in)', () => {
    expect(getDisplayableConnectorAccountLabel(makeConnector({ accountLabel: 'me@x.com', auth: { provider: 'composio' } }))).toBe('me@x.com');
    expect(getDisplayableConnectorAccountLabel(makeConnector({ accountLabel: 'me@x.com', auth: { provider: 'zapier' } }))).toBe('me@x.com');
  });

  it('returns undefined when there is no account label at all', () => {
    expect(getDisplayableConnectorAccountLabel(makeConnector())).toBeUndefined();
  });
});

describe('formatToolsBadge / statusLabel', () => {
  it.each([
    [0, 'No tools'],
    [1, '1 tool'],
    [4, '4 tools'],
  ])('formats %i as %s', (count, expected) => {
    expect(formatToolsBadge(count)).toBe(expected);
  });

  it.each([
    ['available', 'Available'],
    ['connected', 'Connected'],
    ['error', 'Error'],
    ['disabled', 'Disabled'],
  ] as const)('labels status %s as %s', (status, expected) => {
    expect(statusLabel(status)).toBe(expected);
  });
});

describe('toolsBadgeTranslation', () => {
  it.each([
    [0, { key: 'No tools' }],
    [1, { key: '1 tool' }],
    [4, { key: '{count} tools', vars: { count: 4 } }],
  ])('translates %i tools', (count, expected) => {
    expect(toolsBadgeTranslation(count)).toEqual(expected);
  });
});

describe('defaultCategoryLabel', () => {
  it('passes the category straight through (host translates by key)', () => {
    expect(defaultCategoryLabel('communication')).toBe('communication');
  });
});

describe('fallback logo helpers', () => {
  it('builds initials from a single-word name', () => {
    expect(fallbackLogoInitials('Slack')).toBe('Sl');
  });

  it('builds initials from a multi-word name', () => {
    expect(fallbackLogoInitials('Google Drive')).toBe('GD');
  });

  it('falls back to ? for an empty name', () => {
    expect(fallbackLogoInitials('   ')).toBe('?');
  });

  it('handles a single-character name (no second letter to lowercase)', () => {
    expect(fallbackLogoInitials('X')).toBe('X');
  });

  it('handles a two-character single-word name', () => {
    expect(fallbackLogoInitials('Hi')).toBe('Hi');
  });

  it('is stable for the same seed', () => {
    expect(fallbackLogoPaletteIndex('slack', 6)).toBe(fallbackLogoPaletteIndex('slack', 6));
  });

  it('stays within the palette range', () => {
    const index = fallbackLogoPaletteIndex('anything-goes-here', 6);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(6);
  });
});
