import { expect, it, vi } from 'vitest';
import { CONTENT_HASH_VERSION } from '../content-hash.js';
import { planImport, type PlanImportDeps } from '../planner.js';
import type { PublishContentBundle } from '../plan-rows.js';
import { createPublishContentTypeRegistry, type PublishContentHandler } from '../type-registry.js';
import { PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION, type PackedEntity } from '../../transfer/index.js';

type Ports = Record<string, never>;

function pack(id: string, entityType = 'page', overrides: Partial<PackedEntity> = {}): PackedEntity {
  return { entityType, id, schemaVersion: 1, hashVersion: CONTENT_HASH_VERSION,
    contentHash: id + '-incoming', requiredBlobs: [], state: { title: 'Title ' + id }, ...overrides };
}

function fixture() {
  const registry = createPublishContentTypeRegistry<Ports>();
  const apply = vi.fn<PublishContentHandler['apply']>(async () => { throw new Error('planning must not write'); });
  const precheck = vi.fn<PublishContentHandler['precheck']>(async () => null);
  const inspect = vi.fn<PublishContentHandler['inspect']>(async () => null);
  const seedHash = vi.fn<NonNullable<PublishContentHandler['seedHash']>>(async () => null);
  const planRetire = vi.fn<NonNullable<PublishContentHandler['planRetire']>>(async () => null);
  const page: PublishContentHandler = {
    entityType: 'page', schemaVersion: 1, permission: 'content.write', dependsOn: [], apply, inspect,
    precheck, planRetire, seedHash, pack: async function* () {},
  };
  registry.register({ contributor: { entityType: 'page', dependsOn: [], build: () => page } });
  const getBaseline = vi.fn<PlanImportDeps<Ports>['getBaseline']>(async () => null);
  const hasBlob = vi.fn<PlanImportDeps<Ports>['hasBlob']>(async () => true);
  const getSeedHash = vi.fn<NonNullable<PlanImportDeps<Ports>['getSeedHash']>>(async () => null);
  const build = vi.fn((deps: PlanImportDeps<Ports>['publishContentDeps']) => registry.buildCatalog(deps));
  const deps: PlanImportDeps<Ports> = {
    publishContentDeps: { workspaceId: 'live', ports: {}, clock: { nowMs: () => 0 }, idGen: { newId: () => 'unused' } },
    catalog: { build }, getBaseline, hasBlob, getSeedHash,
  };
  const run = (entities: readonly PackedEntity[], overrides: Partial<PlanImportDeps<Ports>> = {}, format: Partial<PublishContentBundle> = {}) =>
    planImport({ deps: { ...deps, ...overrides }, bundle: { entities, hashVersion: CONTENT_HASH_VERSION,
      artifactFormatVersion: PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION, ...format } });
  return { run, apply, precheck, inspect, seedHash, getSeedHash, getBaseline, build, hasBlob, planRetire, registry, page };
}

it.each([
  { mismatch: 'artifact', format: { artifactFormatVersion: 7 }, schemaVersion: 1,
    reason: "bundle artifact format version 7 does not match this instance's 1 — use an exporter/importer pair with a supported format" },
  { mismatch: 'older hash', format: { hashVersion: 0 }, schemaVersion: 1,
    reason: "bundle content-hash version 0 does not match this instance's 1 — upgrade the exporting instance and re-export before syncing" },
  { mismatch: 'future hash', format: { hashVersion: 7 }, schemaVersion: 1,
    reason: "bundle content-hash version 7 does not match this instance's 1 — upgrade this importing instance before syncing" },
  { mismatch: 'schema', format: {}, schemaVersion: 4,
    reason: "page 'p-1' uses schema version 4, but this instance supports version 1 for that type" },
])('refuses a $mismatch mismatch before reading any live entities', async ({ format, schemaVersion, reason }) => {
  const f = fixture();
  expect(await f.run([pack('p-1', 'page', { schemaVersion })], {}, format)).toEqual({
    refused: true, refusalReason: reason, applyOrder: [], rows: [],
  });
  expect(f.getBaseline).not.toHaveBeenCalled();
  expect(f.precheck).not.toHaveBeenCalled();
  expect(f.inspect).not.toHaveBeenCalled();
  expect(f.apply).not.toHaveBeenCalled();
});

it('plans one outcome per entity, distinguishing known history from seeded or never-synced content', async () => {
  const f = fixture();
  const ids = ['create', 'match', 'peer', 'seed', 'handler', 'drift', 'unsynced', 'explicit'];
  const live: Record<string, string> = { match: 'match-incoming', peer: 'peer-baseline', seed: 'seed-stock',
    handler: 'handler-stock', drift: 'edited', unsynced: 'edited', explicit: 'edited' };
  f.inspect.mockImplementation(async ({ id }) => live[id] === undefined ? null : { version: 8, hash: live[id]! });
  f.getBaseline.mockImplementation(async ({ entityId }) => entityId === 'peer'
    ? { hashAtLastSync: 'peer-baseline', hashVersion: CONTENT_HASH_VERSION }
    : entityId === 'drift' ? { hashAtLastSync: 'old', hashVersion: CONTENT_HASH_VERSION }
    : entityId === 'seed' ? { hashAtLastSync: 'obsolete', hashVersion: 0 } : null);
  f.getSeedHash.mockImplementation(async ({ entityId }) => entityId === 'seed' ? 'seed-stock' : null);
  f.seedHash.mockImplementation(async ({ id }) => id === 'handler' ? 'handler-stock' : null);
  const report = await f.run(ids.map(id => pack(id)), { forcedEntityKeys: new Set(['page:explicit']) });
  expect(report.refused).toBe(false);
  expect(report.applyOrder).toEqual(['page']);
  expect(report.rows.map(({ entityId, outcome, writes, reason, canOverwrite }) => [entityId, outcome, writes, reason, canOverwrite])).toEqual([
    ['create', 'created', true, null, false],
    ['match', 'unchanged', false, null, false],
    ['peer', 'applied', true, null, false],
    ['seed', 'applied', true, null, false],
    ['handler', 'applied', true, null, false],
    ['drift', 'conflict', false, "page 'drift' has been edited on the destination since the last sync with this peer", true],
    ['unsynced', 'conflict', false, "no prior sync baseline for page 'unsynced' with this peer — the destination already holds different content", true],
    ['explicit', 'forced', true, "no prior sync baseline for page 'explicit' with this peer — the destination already holds different content", false],
  ]);
  expect(f.getSeedHash.mock.calls).toEqual(['seed', 'handler', 'unsynced', 'explicit'].map(entityId => [{ entityType: 'page', entityId }]));
  expect(f.seedHash.mock.calls).toEqual(['handler', 'unsynced', 'explicit'].map(id => [{ id }]));
  expect(f.apply).not.toHaveBeenCalled();
});

it('blocks unavailable blobs before precheck and appends unsupported entity types after the dependency-ordered catalog', async () => {
  const f = fixture();
  const inspectMenu = vi.fn<PublishContentHandler['inspect']>(async () => null);
  const menu: PublishContentHandler = { ...f.page, entityType: 'menu', dependsOn: ['page'], inspect: inspectMenu };
  f.registry.register({ contributor: { entityType: 'menu', dependsOn: ['page'], build: () => menu } });
  f.hasBlob.mockImplementation(async ({ sha256 }) => sha256 !== 'missing');
  const menuItem = pack('links', 'menu');
  const inputs = [pack('mystery', 'custom'), menuItem, pack('about', 'page', { requiredBlobs: ['present', 'missing', 'not-probed'] })];
  const report = await f.run(inputs);
  expect(report.applyOrder).toEqual(['page', 'menu', 'custom']);
  expect(report.rows.map(row => [row.entityId, row.outcome, row.reason])).toEqual([
    ['about', 'blocked', "required blob 'missing' is not available on this instance"],
    ['links', 'created', null],
    ['mystery', 'blocked', "no registered publish-content handler for entity type 'custom' on this instance"],
  ]);
  expect(f.hasBlob.mock.calls).toEqual([[{ sha256: 'present' }], [{ sha256: 'missing' }]]);
  expect(f.precheck).toHaveBeenCalledExactlyOnceWith({ entity: menuItem });
  expect(f.inspect).not.toHaveBeenCalled();
  expect(inspectMenu).toHaveBeenCalledExactlyOnceWith({ id: 'links' });
  expect(f.apply).not.toHaveBeenCalled();
});

it.each([false, true])('carries the reviewed bytes and the live edit warning in a replacement offer (selected=%s)', async selected => {
  const f = fixture();
  const sourceReplacement = { version: 9, sourceSha256: 'before-replacement' };
  f.precheck.mockResolvedValueOnce({ reason: 'Different file on live.', sourceReplacement });
  f.getBaseline.mockResolvedValueOnce({ hashAtLastSync: 'last-sync', hashVersion: CONTENT_HASH_VERSION });
  f.inspect.mockResolvedValueOnce({ version: 9, hash: 'edited' });
  const report = await f.run([pack('file')], { forcedEntityKeys: new Set(selected ? ['page:file'] : []) });
  expect(report.rows).toEqual([{
    entityType: 'page', entityId: 'file', entityLabel: 'Title file', outcome: selected ? 'forced' : 'blocked', writes: selected,
    reason: 'Different file on live. This file has been edited on the destination since the last sync with this peer.',
    canOverwrite: true, retires: null, sourceReplacement,
  }]);
  expect(f.inspect).toHaveBeenCalledExactlyOnceWith({ id: 'file' });
  expect(f.apply).not.toHaveBeenCalled();
});

it('offers a retire only when the holder is outside the bundle and lists links not replaced by the run', async () => {
  const f = fixture();
  const retire = { entityType: 'page', entityId: 'live-about', entityLabel: 'Live about', hash: 'retire-hash' };
  const overwrittenMenu = { entityType: 'menu', entityId: 'replaced', entityLabel: 'Replaced', referencedId: 'live-about' };
  const externalMenu = { entityType: 'menu', entityId: 'external', entityLabel: 'External', referencedId: 'live-about' };
  const referencesTo = vi.fn<NonNullable<PublishContentHandler['referencesTo']>>(async () => [overwrittenMenu, externalMenu]);
  f.registry.register({ contributor: { entityType: 'menu', dependsOn: ['page'],
    build: () => ({ ...f.page, entityType: 'menu', dependsOn: ['page'], referencesTo }) } });
  f.precheck.mockImplementation(async ({ entity }) => entity.id === 'incoming-about' ? 'Address is held.' : null);
  f.planRetire.mockResolvedValue(retire);
  const incoming = pack('incoming-about');
  const menu = pack('replaced', 'menu');
  const initial = await f.run([incoming, menu]);
  const forced = await f.run([incoming, menu], { forcedEntityKeys: new Set(['page:incoming-about']) });
  const blocked = await f.run([incoming, pack('live-about'), menu], { forcedEntityKeys: new Set(['page:incoming-about']) });
  const base = { entityType: 'page', entityId: 'incoming-about', entityLabel: 'Title incoming-about', reason: 'Address is held.' };
  expect(initial.rows.find(row => row.entityId === 'incoming-about')).toEqual({
    ...base, outcome: 'blocked', writes: false, canOverwrite: true, retires: retire, referencedBy: [externalMenu],
  });
  expect(forced.rows.find(row => row.entityId === 'incoming-about')).toEqual({
    ...base, outcome: 'forced', writes: true, canOverwrite: true, retires: retire, referencedBy: [externalMenu],
  });
  expect(blocked.rows.find(row => row.entityId === 'incoming-about')).toEqual({
    ...base, outcome: 'blocked', writes: false, canOverwrite: false, retires: null,
  });
  expect(referencesTo.mock.calls).toEqual([[{ ids: ['live-about'] }], [{ ids: ['live-about'] }]]);
  expect(f.apply).not.toHaveBeenCalled();
});
