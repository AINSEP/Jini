import assert from 'node:assert/strict';
import { test } from 'vitest';
import { InMemoryTransformDefinitionRepo } from '../../repo.memory.js';
import { ensureCoreMediaTransform } from '../bootstrap.js';

test('boot fills missing public renditions without appending over an existing transform on restart', async () => {
  const workspaceId = 'west';
  const existing = { id: 'existing', workspaceId, name: 'thumb', owner: 'core', version: 3,
    params: { format: 'webp' as const, width: 800 }, createdAt: '2026-11-19T00:00:00.000Z' };
  const transformRepo = new InMemoryTransformDefinitionRepo({}, { initialRows: [existing] });
  let n = 0;
  const deps = { transformRepo, idGen: { newId: () => `transform-${++n}` }, clock: { nowMs: () => 0 } };
  const first = await ensureCoreMediaTransform({ deps, input: { workspaceId } });
  for (let restart = 0; restart < 2; restart++) {
    assert.deepEqual(await ensureCoreMediaTransform({ deps, input: { workspaceId } }), first);
  }
  const publicRows = await transformRepo.listByName({ workspaceId, name: 'public' });
  const ogRows = await transformRepo.listByName({ workspaceId, name: 'og' });
  assert.deepEqual(publicRows.map(({ name, version, owner, params }) => ({ name, version, owner, params })), [
    { name: 'public', version: 1, owner: 'core', params: { format: 'webp' } },
  ]);
  assert.deepEqual(first.definition, publicRows[0]);
  assert.deepEqual(ogRows.map(({ name, version, owner, params }) => ({ name, version, owner, params })), [
    { name: 'og', version: 1, owner: 'core', params: { format: 'jpeg', width: 1200, height: 630, fit: 'cover', quality: 82 } },
  ]);
  assert.deepEqual(await transformRepo.listByName({ workspaceId, name: 'thumb' }), [existing]);
  const east = await ensureCoreMediaTransform({ deps, input: { workspaceId: 'east' } });
  assert.equal(east.definition.workspaceId, 'east');
  assert.deepEqual((await transformRepo.listByName({ workspaceId: 'east', name: 'thumb' })).map(({ version, params }) => ({ version, params })),
    [{ version: 1, params: { format: 'webp', width: 640 } }]);
});
