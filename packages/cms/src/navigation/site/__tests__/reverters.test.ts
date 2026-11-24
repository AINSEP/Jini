import { describe, expect, it } from 'vitest';
import type { ChangeSetItemRecord, DomainEvent, OutboxPort } from '@jini-ai/core/contracts/events';
import { createRevertRegistry } from '../../../core/commands/index.js';
import { InMemoryMenuRepo } from '../../repo.memory.js';
import type { NavItemNode, NavMenuEntry } from '../../index.js';
import { createMenuReverters, registerMenuReverters, type MenuReverterDeps } from '../reverters.js';

const WORKSPACE_ID = 'workspace-1';
const MENU_ID = 'menu-header';

const label = (id: string, text: string, href: string): NavItemNode => ({ id, label: text, target: { kind: 'url', href } });

function menuRow(items: readonly NavItemNode[], overrides: Partial<NavMenuEntry> = {}): NavMenuEntry {
  return {
    id: MENU_ID, workspaceId: WORKSPACE_ID, slug: 'primary-nav', title: 'Header', status: 'published',
    doc: { type: 'menu', version: 1, items }, locations: [], updatedAt: '2026-01-01T00:00:00.000Z', version: 4,
    ...overrides,
  } as NavMenuEntry;
}

function harness(initial: NavMenuEntry[]) {
  const menuRepo = new InMemoryMenuRepo({}, { initialRows: initial });
  const events: DomainEvent[] = [];
  const outbox = { enqueue: async (event: DomainEvent) => { events.push(event); } } as unknown as OutboxPort;
  let n = 0;
  const deps: MenuReverterDeps = { menuRepo, clock: { nowMs: () => Date.parse('2026-09-24T00:00:00.000Z') }, idGen: { newId: () => `generated-${++n}` }, outbox };
  return { menuRepo, events, deps };
}

const item = (patch: Partial<ChangeSetItemRecord> = {}): ChangeSetItemRecord => ({
  id: 'item-1', changeSetId: 'change-1', entityType: 'menu', entityId: MENU_ID, operation: 'update', position: 0, ...patch,
} as ChangeSetItemRecord);

/** The repoint inverse a menu change set carries: the prior item tree. */
const inverse = (items: readonly NavItemNode[]) => ({ items }) as unknown as ChangeSetItemRecord['inversePayload'];

describe('menu update reverter', () => {
  it('reports the live menu version, or null once the menu is gone', async () => {
    const { deps } = harness([menuRow([], { version: 7 })]);
    const { update } = createMenuReverters(deps);
    expect(await update.currentVersion({ workspaceId: WORKSPACE_ID, entityId: MENU_ID })).toBe(7);
    expect(await update.currentVersion({ workspaceId: WORKSPACE_ID, entityId: 'deleted' })).toBeNull();
    expect(await update.currentVersion({ workspaceId: 'other-workspace', entityId: MENU_ID }), 'a menu is only visible inside its own workspace').toBeNull();
  });

  it('restores the captured item tree through updateMenuTree: version bump, other fields kept, event enqueued', async () => {
    const prior = [label('a', 'Company', '/company'), { ...label('b', 'Contact', '/contact'), children: [label('c', 'Phone', '/phone')] }];
    const { deps, menuRepo, events } = harness([menuRow([label('x', 'Changed', '/changed')], { title: 'Header', version: 4 })]);
    await createMenuReverters(deps).update.applyInverse({ workspaceId: WORKSPACE_ID, item: item({ inversePayload: inverse(prior) }) });

    const restored = await menuRepo.findById({ workspaceId: WORKSPACE_ID, id: MENU_ID });
    expect(restored?.doc.items.map((node) => [node.id, node.label])).toEqual([['a', 'Company'], ['b', 'Contact']]);
    expect(restored?.doc.items[1]?.children?.map((node) => node.label)).toEqual(['Phone']);
    expect(restored).toMatchObject({ title: 'Header', slug: 'primary-nav', version: 5 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: 'navigation.menu.updated', workspaceId: WORKSPACE_ID, aggregateId: MENU_ID, payload: { menuId: MENU_ID, slug: 'primary-nav' } });
  });

  it('refuses a missing inverse payload and writes nothing', async () => {
    const { deps, menuRepo, events } = harness([menuRow([label('x', 'Keep', '/keep')])]);
    await expect(createMenuReverters(deps).update.applyInverse({ workspaceId: WORKSPACE_ID, item: item() })).rejects.toThrow('menu reverter called without an inverse payload');
    expect((await menuRepo.findById({ workspaceId: WORKSPACE_ID, id: MENU_ID }))?.version).toBe(4);
    expect(events).toEqual([]);
  });

  it('names the menu when it was deleted before the revert ran', async () => {
    const { deps } = harness([]);
    await expect(createMenuReverters(deps).update.applyInverse({ workspaceId: WORKSPACE_ID, item: item({ entityId: 'gone', inversePayload: { items: [] } }) }))
      .rejects.toThrow("menu 'gone' was not found");
  });

  it('is a second safety net: a stale write between read and save is refused by updateMenuTree\'s own version check', async () => {
    const { deps, menuRepo } = harness([menuRow([label('x', 'Live', '/live')])]);
    // The reverter reads `existing`, then updateMenuTree re-reads; a save landing in that window bumps the version.
    const realFind = menuRepo.findById.bind(menuRepo);
    let reads = 0;
    menuRepo.findById = async (args) => {
      const row = await realFind(args);
      if (++reads === 1 && row) await menuRepo.save({ ...row, version: row.version + 1 }, { expectedVersion: row.version });
      return row;
    };
    await expect(createMenuReverters(deps).update.applyInverse({ workspaceId: WORKSPACE_ID, item: item({ inversePayload: inverse([label('a', 'Old', '/old')]) }) })).rejects.toThrow();
    expect((await realFind({ workspaceId: WORKSPACE_ID, id: MENU_ID }))?.doc.items.map((node) => node.label), 'the refused revert must not overwrite the newer save').toEqual(['Live']);
  });
});

describe('registerMenuReverters', () => {
  it('registers the reverter under menu/update only, and returns the very registry it was given', () => {
    const { deps } = harness([]);
    const registry = createRevertRegistry({});
    const returned = registerMenuReverters({ registry, deps });
    expect(returned).toBe(registry);
    expect(registry.resolve('menu', 'update')).toBeDefined();
    expect(registry.resolve('menu', 'delete')).toBeUndefined();
    expect(registry.resolve('post', 'update')).toBeUndefined();
  });

  it('adds to an existing registry without displacing reverters already registered for other domains', () => {
    const { deps } = harness([]);
    const registry = createRevertRegistry({});
    const post = { currentVersion: async () => 1, applyInverse: async () => {} };
    registry.register('post', 'update', post);
    registerMenuReverters({ registry, deps });
    expect(registry.resolve('post', 'update')).toBe(post);
    expect(registry.resolve('menu', 'update')).not.toBe(post);
  });

  it('the registered reverter is bound to the injected adapters (end to end through the registry)', async () => {
    const { deps, menuRepo } = harness([menuRow([label('x', 'Changed', '/changed')])]);
    const registry = registerMenuReverters({ registry: createRevertRegistry({}), deps });
    await registry.resolve('menu', 'update')!.applyInverse({ workspaceId: WORKSPACE_ID, item: item({ inversePayload: inverse([label('a', 'Back', '/back')]) }) });
    expect((await menuRepo.findById({ workspaceId: WORKSPACE_ID, id: MENU_ID }))?.doc.items.map((node) => node.label)).toEqual(['Back']);
  });
});
