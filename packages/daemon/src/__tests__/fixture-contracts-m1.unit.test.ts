import { afterEach, expect, it, vi } from 'vitest';
import { appendToolCatalogAttempt, buildToolCatalogQuery, withToolCatalogAudit } from './catalog-fixture.js';
import { createLiveRunTracker } from './session-fixture.js';
import { createSurfaceExchangeStore } from './surface-fixture.js';
import type { ToolAttemptEvent } from '../tool-audit.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('keeps catalog search limits, missing descriptions and default audit attribution intact', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T12:00:00.000Z'));
  const entries = [{ id: 'a', description: 'Read pages' }, { id: 'b', description: 'Read media' }, { id: 'c', description: 'Write pages' }];
  const catalog = buildToolCatalogQuery({ list: () => entries });
  expect(catalog.search({ query: 'READ' }).map(hit => hit.id)).toEqual(['a', 'b']);
  expect(catalog.search({ query: 'read' }, { limit: 1 }).map(hit => hit.id)).toEqual(['a']);
  expect(catalog.search({ query: 'read' }, { limit: 0 })).toEqual([]);
  expect(catalog.describe({ id: 'missing' })).toBeNull();
  const rows: ToolAttemptEvent[] = [];
  const sink = { append: async (event: ToolAttemptEvent) => { rows.push(event); } };
  const identity = { workspaceId: 'workspace', runId: 'run', principalId: 'person' };
  const audited = withToolCatalogAudit(catalog, sink, identity);
  expect(audited.search('read').map(hit => hit.id)).toEqual(['a', 'b']);
  expect(audited.describe('a')).toEqual(entries[0]);
  appendToolCatalogAttempt(sink, { ...identity, toolId: 'search_tools', detail: 'manual' });
  expect(rows.map(({ attemptId, ...row }) => row)).toEqual([
    { ...identity, executionId: null, phase: 'completed', at: '2026-10-29T12:00:00.000Z', toolId: 'search_tools', detail: '{"queryLength":4,"limit":null,"resultIds":["a","b"],"resultCount":2}' },
    { ...identity, executionId: null, phase: 'completed', at: '2026-10-29T12:00:00.000Z', toolId: 'describe_tool', detail: '{"id":"a","found":true}' },
    { ...identity, executionId: null, phase: 'completed', at: '2026-10-29T12:00:00.000Z', toolId: 'search_tools', detail: 'manual' },
  ]);
  expect(new Set(rows.map(row => row.attemptId)).size).toBe(3);
  for (const row of rows) expect(row.attemptId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

it('lists competing runs only within the requested conversation and excludes the caller', () => {
  const tracker = createLiveRunTracker();
  tracker.register('chat', 'self'); tracker.register('chat', 'peer-a'); tracker.register('chat', 'peer-b'); tracker.register('other', 'elsewhere');
  expect(tracker.concurrentLiveRunIds('chat', 'self')).toEqual(['peer-a', 'peer-b']);
  tracker.unregister('chat', 'peer-a');
  expect(tracker.concurrentLiveRunIds('chat', 'self')).toEqual(['peer-b']);
  expect(tracker.concurrentLiveRunIds('missing', 'self')).toEqual([]);
});

it('exposes the real idle deadline and expires a legacy exchange at that boundary', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const store = createSurfaceExchangeStore({ idleTtlMs: 20, maxLifetimeMs: 100, newExchangeId: () => 'exchange' });
  const exchange = store.open({ toolId: 'ask', principalId: 'person' }, async () => {});
  expect(exchange.expiresAtMs()).toBe(1020);
  const waiting = exchange.receive();
  await vi.advanceTimersByTimeAsync(20);
  expect(await waiting).toEqual({ status: 'expired' });
  expect(store.size()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
