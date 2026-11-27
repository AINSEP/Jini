import { expect, it, vi } from 'vitest';
import { createPublishContentSeedHash, NO_PUBLISH_CONTENT_SEED_HASH, type PublishContentSeedCatalog } from '../seed-hash.js';

const query = { entityType: 'page', entityId: 'about' };

it('lazily opens the seed once but uses fresh publish handlers for every lookup', async () => {
  const deps = { database: 'seed' };
  const loadSeedDeps = vi.fn(() => deps);
  const inspect = vi.fn<(required: { id: string }) => Promise<{ hash: string } | null>>(
    async ({ id }) => id === 'about' ? { hash: 'seed-about-hash' } : null,
  );
  const buildCatalog = vi.fn<(deps: { database: string }) => PublishContentSeedCatalog>()
    .mockReturnValueOnce({ handlerByType: new Map([['page', { inspect }]]) })
    .mockReturnValueOnce({ handlerByType: new Map() });
  const hashOf = createPublishContentSeedHash({ loadSeedDeps, buildCatalog });
  expect(loadSeedDeps).not.toHaveBeenCalled();
  expect(await hashOf(query)).toBe('seed-about-hash');
  expect(await hashOf(query)).toBeNull();
  expect(inspect).toHaveBeenCalledExactlyOnceWith({ id: 'about' });
  expect(loadSeedDeps).toHaveBeenCalledExactlyOnceWith();
  expect(buildCatalog.mock.calls).toEqual([[deps], [deps]]);
});

it.each(['missing', 'unreadable'] as const)('does not open a %s seed again on another request', async mode => {
  const loadSeedDeps = vi.fn(() => {
    if (mode === 'unreadable') throw new Error('seed database missing a table');
    return null;
  });
  const buildCatalog = vi.fn<() => PublishContentSeedCatalog>();
  const hashOf = createPublishContentSeedHash({ loadSeedDeps, buildCatalog });
  expect(await hashOf(query)).toBeNull();
  expect(await hashOf({ ...query, entityId: 'contact' })).toBeNull();
  expect(loadSeedDeps).toHaveBeenCalledExactlyOnceWith();
  expect(buildCatalog).not.toHaveBeenCalled();
});

it('treats a missing seed row and an inspection failure as no baseline', async () => {
  const inspect = vi.fn<(required: { id: string }) => Promise<{ hash: string } | null>>()
    .mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('seed inspection failed'));
  const hashOf = createPublishContentSeedHash({ loadSeedDeps: () => ({}),
    buildCatalog: () => ({ handlerByType: new Map([['page', { inspect }]]) }) });
  expect(await hashOf(query)).toBeNull();
  expect(await hashOf({ ...query, entityId: 'contact' })).toBeNull();
  expect(inspect.mock.calls).toEqual([[{ id: 'about' }], [{ id: 'contact' }]]);
  expect(await NO_PUBLISH_CONTENT_SEED_HASH(query)).toBeNull();
});
