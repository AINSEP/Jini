import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { createSqliteMediaTaskStore } from '../sqlite-task-store.js';
import { createSqliteAsyncOperationStore } from '../dispatch/sqlite-async-operation-store.js';
import { resolveProviderCredentialsFromEnv } from '../dispatch/credentials.js';
import { canonicalMediaProviderId, findProvider, normalizeMediaProviderMap, VENDOR_API_BASE_URLS } from '../catalog.js';

// hwb #7: the injected opener deliberately ignores the path. A hardwired constructor fails or opens another handle.
it('both durable media stores use the host opener and retain their storage contracts', async () => {
  const opened: Database.Database[] = [];
  const paths: string[] = [];
  const open = (file: string) => { paths.push(file); const db = new Database(':memory:'); opened.push(db); return db; };
  const tasks = await createSqliteMediaTaskStore({ dbPath: '/host-owned/tasks', open });
  const operations = await createSqliteAsyncOperationStore({ dbPath: '/host-owned/operations', open });
  try {
    await tasks.create({ id: 'task', ownerRef: 'run' });
    expect((await tasks.get('task'))?.status).toBe('queued');
    await operations.create({ id: 'operation', providerId: 'openai', routeKey: 'image', ownerRef: 'run', maxAttempts: 2, deadlineAt: 10_000 });
    expect((await operations.get({ id: 'operation' }))?.status).toBe('submitted');
    expect(paths).toEqual(['/host-owned/tasks', '/host-owned/operations']);
    expect(opened[0]!.prepare('SELECT id FROM jini_media_tasks').get()).toEqual({ id: 'task' });
    expect(opened[1]!.prepare('SELECT id FROM jini_async_operations').get()).toEqual({ id: 'operation' });
  } finally { await tasks.close(); await operations.close(); }
  expect(opened.map(db => db.open)).toEqual([false, false]);
});

// hwb #13: old IDs resolve to the dispatch owner, and canonical credentials win regardless of insertion order.
it('resolves old vendor ids and normalizes conflicting aliases without mutation', () => {
  for (const [alias, canonical] of [['nano-banana', 'nanobanana'], ['fal-ai', 'fal'], ['xai-grok-imagine', 'grok'], ['tavily-search', 'tavily']]) {
    expect(canonicalMediaProviderId({ id: alias! })).toBe(canonical);
    expect(findProvider({ id: alias! })).toBe(findProvider({ id: canonical! }));
  }
  const providers = { nanobanana: { model: 'canonical' }, 'nano-banana': { model: 'legacy' }, extension: { model: 'custom' } };
  expect(normalizeMediaProviderMap({ providers })).toEqual({ nanobanana: { model: 'canonical' }, extension: { model: 'custom' } });
  expect(providers['nano-banana']).toEqual({ model: 'legacy' });
  expect(findProvider({ id: 'openai' })?.defaultBaseUrl).toBe(VENDOR_API_BASE_URLS.openai);
  expect(canonicalMediaProviderId({ id: 'toString' })).toBe('toString');
});

it('legacy provider ids use the canonical credential environment precedence', () => {
  expect(resolveProviderCredentialsFromEnv({ providerId: 'tavily-search', env: { TAVILY_API_KEY: ' fixture-key ' } }, {})).toEqual({ apiKey: 'fixture-key' });
});
