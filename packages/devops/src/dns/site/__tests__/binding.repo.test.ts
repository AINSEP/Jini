import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql, type RawBuilder } from 'kysely';
import { expect, test } from 'vitest';
import { createDomainBindingStore, type DomainBinding } from '../binding.repo.js';

function database() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE domain_binding (
    workspace_id TEXT NOT NULL, hostname TEXT NOT NULL, provider_id TEXT NOT NULL, zone TEXT NOT NULL,
    requirements_json TEXT NOT NULL, status TEXT NOT NULL, delegation_state TEXT, attempt INTEGER NOT NULL,
    started_at TEXT NOT NULL, next_check_at TEXT, last_checked_at TEXT, last_result_json TEXT,
    version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, hostname)
  )`);
  const kysely = new Kysely<Record<string, never>>({ dialect: new SqliteDialect({ database: db }) });
  return { store: (workspaceId: string) => createDomainBindingStore({
    sql, workspaceId, kernel: { query: async (statement: RawBuilder<unknown>) => (await statement.execute(kysely)).rows },
  }), close: () => kysely.destroy() };
}

const now = '2026-11-27T20:00:00.000Z';
function binding(hostname: string, nextCheckAt: string | null = now): DomainBinding {
  return {
    hostname, providerId: 'manual', zone: 'studio.test',
    requirements: [{ purpose: 'site', providerId: 'host', domain: hostname, records: [{ type: 'A', name: hostname, value: '192.0.2.18' }] }],
    status: 'pending', delegation: 'delegated', attempt: 2, startedAt: '2026-11-27T19:55:00.000Z',
    nextCheckAt, lastCheckedAt: now, lastResult: null, version: 1,
  };
}

test('inserts and updates by workspace and version, preserving the winner on stale writes', async () => {
  const db = database();
  try {
    const a = db.store('workspace-a'), b = db.store('workspace-b');
    const first = binding('www.studio.test');
    const other = { ...first, providerId: 'other' };
    expect(await a.get({ hostname: first.hostname })).toBeNull();
    expect(await b.put({ binding: other, now, expectedVersion: null })).toBe(true);
    expect(await a.get({ hostname: first.hostname })).toBeNull();
    expect(await a.put({ binding: first, now, expectedVersion: null })).toBe(true);
    expect(await a.put({ binding: other, now, expectedVersion: null })).toBe(false);
    expect(await a.get({ hostname: first.hostname })).toEqual(first);
    const verified = { ...first, version: 2, status: 'propagated' as const, nextCheckAt: null, lastResult: { answers: ['192.0.2.18'] } };
    expect(await a.put({ binding: verified, now, expectedVersion: 1 })).toBe(true);
    expect(await a.put({ binding: { ...first, version: 3 }, now, expectedVersion: 1 })).toBe(false);
    expect(await a.get({ hostname: first.hostname })).toEqual(verified);
    expect(await b.get({ hostname: first.hostname })).toEqual(other);
  } finally { await db.close(); }
});

test('lists only due workspace bindings in chronological order with hostname tie-break and limit', async () => {
  const db = database();
  try {
    const a = db.store('workspace-a'), b = db.store('workspace-b');
    const early = binding('z.studio.test', '2026-11-27T19:59:00.000Z');
    const tiedFirst = binding('a.studio.test'), tiedSecond = binding('b.studio.test');
    for (const value of [tiedSecond, tiedFirst, binding('future.studio.test', '2026-11-27T20:01:00.000Z'), binding('done.studio.test', null), early]) {
      expect(await a.put({ binding: value, now, expectedVersion: null })).toBe(true);
    }
    expect(await b.put({ binding: binding('foreign.studio.test', '2026-11-27T19:56:00.000Z'), now, expectedVersion: null })).toBe(true);
    expect(await a.listDue({ now, limit: 2 })).toEqual([early, tiedFirst]);
    expect(await a.listDue({ now, limit: 3 })).toEqual([early, tiedFirst, tiedSecond]);
  } finally { await db.close(); }
});
