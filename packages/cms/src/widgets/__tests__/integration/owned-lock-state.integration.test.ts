import { describe, expect, it } from 'vitest';
import { InMemoryEntryRepo } from '../../../entries/index.js';
import { InMemoryContentTypeRepo } from '../../../content-types/index.js';
import { createEntryLockState, getEntryLockState, type EntryLockState } from '../../concurrency.js';
import { InMemoryWidgetRegionBindingRepo } from '../../repo.memory.js';
import { updateWidgetInstance, importWidgetInstance, trashWidgetInstance, type WidgetTrashDeps } from '../../write-service.js';
import { insertWidgetEmbed, removeWidgetEmbed, reorderWidgetEmbeds, type EmbedServiceDeps } from '../../embed-service.js';
import { bindWidgetArea, mutateWidgetAreaPlacements, type RegionAreaServiceDeps } from '../../region-area-service.js';
import { widgetHostFixture, InMemoryEntryRefsRepo, InMemoryOutbox } from '../support/host.fixture.js';

type Services = WidgetTrashDeps & EmbedServiceDeps & RegionAreaServiceDeps;
const actor = { principalId: 'operator', kind: 'user' };
const common = { workspaceId: 'workspace-a', actor };
const readError = new Error('fixture reached protected read');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** Observes queue admission through the injected state, with no module replacement or sleeps. */
class ObservedLocks extends Map<string, Promise<void>> {
  readonly queued = deferred();
  override set(key: string, value: Promise<void>): this {
    super.set(key, value);
    this.queued.resolve();
    return this;
  }
}

function fixture(entryLocks: EntryLockState) {
  let reads = 0;
  const protectedRead = async (): Promise<never> => { reads++; throw readError; };
  const entryRepo = new InMemoryEntryRepo();
  entryRepo.findById = protectedRead;
  const bindingRepo = new InMemoryWidgetRegionBindingRepo();
  bindingRepo.findByRegion = protectedRead;
  let id = 0;
  const unexpected = async (): Promise<never> => { throw new Error('unexpected write'); };
  const deps: Services = {
    entryLocks, entryRepo, bindingRepo, contentTypeRepo: new InMemoryContentTypeRepo(),
    entryRefsRepo: new InMemoryEntryRefsRepo(), clock: { nowMs: () => 0 }, ids: { newId: () => `id-${++id}` },
    authorize: async () => ({ allowed: true, reason: 'fixture allowed' }), outbox: new InMemoryOutbox(),
    remove: unexpected, postRepo: { findById: unexpected, findBySlug: unexpected }, forgetRemovedPost: unexpected,
    changeSets: { insert: unexpected, findById: unexpected, findByIdempotencyKey: unexpected, listByWorkspace: unexpected, save: unexpected },
    host: { ...widgetHostFixture, posts: {
      isTrashed: () => false, isVersionConflict: (_error): _error is Error & { currentVersion: number } => false,
      isNotFound: () => false, updatePost: unexpected, restorePostForward: unexpected,
      findPublishedPostById: unexpected, findPublishedPostBySlug: unexpected,
    } },
  };
  return { deps, reads: () => reads };
}

const operations: Array<{ name: string; key: string; run: (deps: Services) => Promise<unknown> }> = [
  { name: 'update', key: 'workspace-a::shared-id', run: deps => updateWidgetInstance({ deps,
    input: { ...common, widgetInstanceId: 'shared-id', baseVersion: 1, config: { body: 'changed' } } }) },
  { name: 'import', key: 'workspace-a::shared-id', run: deps => importWidgetInstance({ deps,
    input: { ...common, id: 'shared-id', slug: 'shared', title: 'Shared', widgetType: 'text', config: { body: 'changed' }, expectedVersion: undefined } }) },
  { name: 'trash', key: 'workspace-a::shared-id', run: deps => trashWidgetInstance({ deps,
    input: { ...common, widgetInstanceId: 'shared-id' } }) },
  { name: 'insert embed', key: 'workspace-a::shared-id', run: deps => insertWidgetEmbed({ deps,
    input: { ...common, hostEntryId: 'shared-id', baseVersion: 1, widgetEntryId: 'widget' } }) },
  { name: 'remove embed', key: 'workspace-a::shared-id', run: deps => removeWidgetEmbed({ deps,
    input: { ...common, hostEntryId: 'shared-id', baseVersion: 1, placementId: 'placement' } }) },
  { name: 'reorder embeds', key: 'workspace-a::shared-id', run: deps => reorderWidgetEmbeds({ deps,
    input: { ...common, hostEntryId: 'shared-id', baseVersion: 1, orderedWidgetEntryIds: [] } }) },
  { name: 'bind region', key: 'workspace-a::area::footer', run: deps => bindWidgetArea({ deps,
    input: { workspaceId: 'workspace-a', regionKey: 'footer' } }) },
  { name: 'mutate placements', key: 'workspace-a::shared-id', run: deps => mutateWidgetAreaPlacements({ deps,
    input: { ...common, areaEntryId: 'shared-id', baseVersion: 1, placements: [] } }) },
];

describe('owned widget service locks', () => {
  it.each(operations)('$name waits on the supplied state before its protected read and cleans up on failure', async ({ key, run }) => {
    const locks = new ObservedLocks();
    const held = deferred();
    Map.prototype.set.call(locks, key, held.promise);
    const f = fixture(locks);
    const result = run(f.deps).then(() => null, error => error);
    try {
      await Promise.race([locks.queued.promise, result.then(() => { throw new Error('service bypassed supplied lock'); })]);
      expect(f.reads()).toBe(0);
    } finally { held.resolve(); }
    expect(await result).toBe(readError);
    expect(f.reads()).toBe(1);
    expect(locks.size).toBe(0);
  });

  it('a shared store lock blocks embed reads while the same identifiers in another store progress', async () => {
    const locks = new ObservedLocks(); const held = deferred();
    Map.prototype.set.call(locks, 'workspace-a::shared-id', held.promise);
    const shared = fixture(locks); const independent = fixture(createEntryLockState({}));
    const embed = operations.find(operation => operation.name === 'insert embed')!;
    const pending = embed.run(shared.deps).catch(error => error);
    try {
      await Promise.race([locks.queued.promise, pending.then(() => { throw new Error('embed bypassed supplied lock'); })]);
      await expect(operations[0]!.run(independent.deps)).rejects.toBe(readError);
      expect(shared.reads()).toBe(0); expect(independent.reads()).toBe(1);
    } finally { held.resolve(); }
    expect(await pending).toBe(readError); expect(locks.size).toBe(0);
  });

  it('store ownership survives recreated dependency bags without sharing across stores', () => {
    const owner = new InMemoryEntryRepo();
    expect(getEntryLockState({ owner })).toBe(getEntryLockState({ owner }));
    expect(getEntryLockState({ owner: new InMemoryEntryRepo() })).not.toBe(getEntryLockState({ owner }));
  });
});


it('a widget area refuses an embed with the exact portable runtime message', async () => {
  const f = fixture(createEntryLockState({}));
  f.deps.entryRepo = new InMemoryEntryRepo();
  f.deps.bindingRepo = new InMemoryWidgetRegionBindingRepo();
  const { areaEntry } = await bindWidgetArea({ deps: f.deps,
    input: { workspaceId: common.workspaceId, regionKey: 'footer' } });
  await expect(insertWidgetEmbed({ deps: f.deps, input: {
    ...common, hostEntryId: areaEntry.id, baseVersion: areaEntry.version, widgetEntryId: 'widget',
  } })).rejects.toMatchObject({
    name: 'WidgetEmbedHostUnsupportedError', reason: 'widget-area',
    message: `host '${areaEntry.id}' is a widget_area entry, which can never host a widgetEmbed node`,
  });
});
