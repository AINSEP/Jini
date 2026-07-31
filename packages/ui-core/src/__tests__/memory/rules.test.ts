import { describe, expect, it } from 'vitest';
import type { Connector } from '../../connectors/index.js';
import {
  applyMemoryConnectorStatus,
  connectorWithPendingAuthorization,
  enabledPatch,
  memoryEntryIdForConnectorSuggestion,
  singleFlagPatch,
  upsertMemoryConnector,
  visibleExtractionsFor,
  type MemoryConfigFlagKey,
} from '../../memory/rules.js';
import type { MemoryExtractionRecord, MemorySuggestion } from '../../memory/types.js';

function record(id: string, over: Partial<MemoryExtractionRecord> = {}): MemoryExtractionRecord {
  return { id, startedAt: 1_000, phase: 'success', userMessagePreview: '', ...over };
}

function connector(id: string, over: Partial<Connector> = {}): Connector {
  return { id, name: id, provider: 'connector-catalog', category: 'Memory source', status: 'available', tools: [], ...over };
}

function suggestion(id: string, over: Partial<MemorySuggestion> = {}): MemorySuggestion {
  return { id, name: `n-${id}`, description: '', type: 'project', body: 'b', ...over };
}

// Pure rules: a UI toggle maps to the exact `/api/memory/config` PATCH body.
// These characterize the wire shape the daemon merge parser expects, so a
// refactor that changes the body fails here rather than silently at runtime.
describe('memory config rules', () => {
  it('enabledPatch sends only the master switch', () => {
    expect(enabledPatch(true)).toEqual({ enabled: true });
    expect(enabledPatch(false)).toEqual({ enabled: false });
  });

  it('singleFlagPatch sends only the one toggled flag', () => {
    expect(singleFlagPatch('profileEnabled', false)).toEqual({ profileEnabled: false });
    expect(singleFlagPatch('verifyEnabled', true)).toEqual({ verifyEnabled: true });
  });

  it('covers every per-hook flag key', () => {
    const keys: MemoryConfigFlagKey[] = ['chatExtractionEnabled', 'profileEnabled', 'rewriteEnabled', 'verifyEnabled'];
    for (const key of keys) {
      expect(singleFlagPatch(key, true)).toEqual({ [key]: true });
    }
  });
});

describe('visibleExtractionsFor', () => {
  const rows = [record('llm-a', { kind: 'llm' }), record('conn-b', { kind: 'connector' }), record('plain-c')];

  it("drops connector-kind records under the 'all' filter", () => {
    expect(visibleExtractionsFor(rows, 'all').map((r) => r.id)).toEqual(['llm-a', 'plain-c']);
  });

  it('shows nothing under any per-type filter (extractions are all-only)', () => {
    expect(visibleExtractionsFor(rows, 'project')).toEqual([]);
    expect(visibleExtractionsFor(rows, 'user')).toEqual([]);
  });

  it('is empty when there are no extractions', () => {
    expect(visibleExtractionsFor([], 'all')).toEqual([]);
  });
});

describe('connector rules', () => {
  it('memoryEntryIdForConnectorSuggestion accepts safe ids and rejects others', () => {
    expect(memoryEntryIdForConnectorSuggestion(suggestion('good_id1'))).toBe('good_id1');
    expect(memoryEntryIdForConnectorSuggestion(suggestion('Bad-Id!'))).toBeUndefined();
  });

  it('upsertMemoryConnector inserts, merges (keeping tool metadata the update omits), and no-ops on null', () => {
    const list = [
      connector('a', { tools: [{ name: 'x', safety: { sideEffect: 'read' } }], toolCount: 3, toolsNextCursor: 'c', toolsHasMore: true }),
      connector('b'),
    ];
    expect(upsertMemoryConnector(list, null)).toBe(list);
    expect(upsertMemoryConnector(list, connector('c')).map((c) => c.id)).toEqual(['a', 'b', 'c']);

    const merged = upsertMemoryConnector(list, connector('a', { name: 'A', tools: [] }));
    const mergedA = merged.find((c) => c.id === 'a')!;
    expect(mergedA.name).toBe('A');
    // Tool metadata is kept when the update's own tools array is empty.
    expect(mergedA.tools).toHaveLength(1);
    expect(mergedA.toolCount).toBe(3);
    expect(mergedA.toolsNextCursor).toBe('c');
    expect(mergedA.toolsHasMore).toBe(true);

    // When the update carries its own tools, they win.
    const replaced = upsertMemoryConnector(list, connector('a', { tools: [{ name: 'y', safety: { sideEffect: 'read' } }] }));
    expect(replaced.find((c) => c.id === 'a')?.tools).toHaveLength(1);
    expect(replaced.find((c) => c.id === 'a')?.tools[0]?.name).toBe('y');
  });

  it('applyMemoryConnectorStatus drops stale account/error fields before applying', () => {
    const stale = connector('a', { accountLabel: 'old', lastError: 'boom', status: 'error' });
    const applied = applyMemoryConnectorStatus(stale, { status: 'connected' });
    expect(applied.status).toBe('connected');
    expect(applied.accountLabel).toBeUndefined();
    expect(applied.lastError).toBeUndefined();
  });

  it('applyMemoryConnectorStatus leaves a connector unchanged when its id has no entry in the map', () => {
    const a = connector('a', { status: 'available' });
    // The 1-item array form of applyConnectorStatuses this delegates to
    // no-ops per-row when the status map doesn't mention that row's id.
    const applied = applyMemoryConnectorStatus(a, undefined as never);
    expect(applied).toBe(a);
  });

  it('connectorWithPendingAuthorization keeps disabled but otherwise marks available', () => {
    expect(connectorWithPendingAuthorization(connector('a', { status: 'available' })).status).toBe('available');
    expect(connectorWithPendingAuthorization(connector('a', { status: 'error' })).status).toBe('available');
    expect(connectorWithPendingAuthorization(connector('a', { status: 'disabled' })).status).toBe('disabled');
  });

  it('connectorWithPendingAuthorization drops stale account/error fields', () => {
    const withStale = connector('a', { accountLabel: 'old', lastError: 'boom', status: 'error' });
    const marked = connectorWithPendingAuthorization(withStale);
    expect(marked.accountLabel).toBeUndefined();
    expect(marked.lastError).toBeUndefined();
  });
});
