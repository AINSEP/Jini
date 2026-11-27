import { expect, it } from 'vitest';
import { InMemoryPublishContentBaselineRepo, type PublishContentBaselineRecord } from '../baseline-repo.js';

it('isolates each dimension of the baseline key and replaces only the exact same identity', async () => {
  const repo = new InMemoryPublishContentBaselineRepo();
  const key = { workspaceId: 'west', peerPrincipalId: 'peer-a', entityType: 'page', entityId: 'p-4' };
  const first: PublishContentBaselineRecord = { ...key, hashAtLastSync: 'hash-old', hashVersion: 1,
    syncedAt: '2026-01-02T00:00:00Z', runId: 'run-old' };
  expect(await repo.findOne(key)).toBeNull();
  await repo.upsert({ record: first });
  for (const different of [{ workspaceId: 'east' }, { peerPrincipalId: 'peer-b' }, { entityType: 'post' }, { entityId: 'p-5' }]) {
    expect(await repo.findOne({ ...key, ...different })).toBeNull();
  }
  const next = { ...first, hashAtLastSync: 'hash-new', runId: 'run-new' };
  await repo.upsert({ record: next });
  next.hashAtLastSync = 'mutated-caller-copy';
  const read = await repo.findOne(key);
  expect(read).toEqual({ ...first, hashAtLastSync: 'hash-new', runId: 'run-new' });
  Object.assign(read ?? {}, { hashAtLastSync: 'mutated-reader-copy' });
  expect(await repo.findOne(key)).toEqual({ ...first, hashAtLastSync: 'hash-new', runId: 'run-new' });
});
