import { expect, it, vi } from 'vitest';
import { InMemoryChangeSetRepo } from '../../../core/commands/repo.memory.js';
import { PublishContentApplyRowError, type PackedEntity } from '../../transfer/index.js';
import { createRepoPublishHandler, type RepoPublishTypeConfig } from '../repo-handler.js';
import type { PublishContentDeps } from '../type-registry.js';

type Row = { id: string; slug: string; title: string; version: number; trashed: boolean };
type Ports = { rows: Map<string, Row> };
type Host = { notes?: Ports };
type Config = RepoPublishTypeConfig<Row, Ports, Host>;

const entity: PackedEntity = { entityType: 'note', id: 'subject', schemaVersion: 1, hashVersion: 1,
  contentHash: 'fixture-hash', requiredBlobs: [], state: { slug: 'guide', title: 'Incoming' } };
const stored = { id: 'subject', slug: 'guide', title: 'Local', version: 7, trashed: false };

function setup(overrides: Partial<Config> = {}) {
  const rows = new Map<string, Row>();
  const changeSets = new InMemoryChangeSetRepo();
  const find = vi.fn<Config['find']>(async ({ ports, id }) => ports.rows.get(id) ?? null);
  const write = vi.fn<Config['write']>(async ({ ports, id, state, existing }) => {
    ports.rows.set(id, { id, title: String(state.title), slug: String(state.slug), version: (existing?.version ?? 0) + 1, trashed: false });
    return { changeSetId: 'domain-revision' };
  });
  const holder = vi.fn<NonNullable<Config['address']>['holder']>(async ({ ports, value }) =>
    [...ports.rows.values()].find(row => row.slug === value) ?? null);
  const validate = vi.fn<NonNullable<Config['validate']>>(async () => null);
  const handler = createRepoPublishHandler<Row, Ports, Host>({
    entityType: 'note', permission: 'note.write', ports: ({ deps }) => deps.ports.notes, portsKey: 'notes',
    find, write, list: async ({ ports }) => [...ports.rows.values()], isTrashed: ({ row }) => row.trashed,
    fields: { id: 'provenance', version: 'provenance', trashed: 'provenance', title: 'transferred', slug: 'transferred' },
    address: { field: 'slug', holder }, validate, ...overrides,
  });
  const deps: PublishContentDeps<Host> = { workspaceId: 'w', ports: { notes: { rows } }, changeSets,
    outbox: { enqueue: async () => {} } as never, authorize: async () => ({ allowed: true, reason: 'fixture' }),
    mutationActor: { id: 'editor', kind: 'user' }, clock: { nowMs: () => 0 }, idGen: { newId: () => 'test-id' } };
  const built = handler.build(deps);
  const apply = (expectedVersion: number | undefined) =>
    built.apply({ entity, expectedVersion, principalId: 'editor', idempotencyKey: 'test-apply' });
  return { rows, built, handler, deps, changeSets, apply, find, write, validate, holder };
}

it('inspects only the requested live row and reports missing wiring instead of implying success', async () => {
  const f = setup();
  f.rows.set(stored.id, stored);
  for await (const packed of f.built.pack()) {
    expect(packed.id).toBe('subject');
    expect(await f.built.inspect({ id: 'subject' })).toEqual({ version: 7, hash: packed.contentHash });
  }
  expect(f.find).toHaveBeenCalledExactlyOnceWith({ ports: { rows: f.rows }, workspaceId: 'w', id: 'subject' });
  expect(await f.built.inspect({ id: 'missing' })).toBeNull();
  const unavailable = f.handler.build({ ...f.deps, ports: {} });
  expect(await unavailable.inspect({ id: 'subject' })).toBeNull();
  expect(await unavailable.precheck({ entity })).toBe("note entity 'subject' cannot be prechecked — no notes port wired for this deps bag");
  await expect(unavailable.apply({ entity, expectedVersion: undefined, principalId: 'editor', idempotencyKey: 'test-apply' }))
    .rejects.toThrow("publish-content: note.apply() requires PublishContentDeps.ports.notes — wire it from the apply-loop composition root (features/publish-content/apply-loop.ts).");
});

it.each([
  { trashed: false, reason: "slug 'guide' is already held by a different note ('other')" },
  { trashed: true, reason: "note 'other' is in the trash at this destination and still holds slug 'guide' — restore it, or delete it permanently from the Trash, before publishing" },
])('refuses an address held by another row (trashed=$trashed) before trying custom validation', async ({ trashed, reason }) => {
  const f = setup();
  f.rows.set('other', { ...stored, id: 'other', trashed });
  expect(await f.built.precheck({ entity })).toBe(reason);
  expect(f.holder).toHaveBeenCalledExactlyOnceWith({ ports: { rows: f.rows }, workspaceId: 'w', value: 'guide', state: entity.state });
  expect(f.validate).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
});

it.each([
  { expectedVersion: undefined, exists: true, detail: 'expected no existing row, found version 7' },
  { expectedVersion: 6, exists: false, detail: 'expected version 6, but the row is gone' },
  { expectedVersion: 6, exists: true, detail: 'expected version 6, found version 7' },
])('refuses stale apply: $detail', async ({ expectedVersion, exists, detail }) => {
  const f = setup();
  if (exists) f.rows.set('subject', stored);
  await expect(f.apply(expectedVersion)).rejects.toThrow(new PublishContentApplyRowError({
    rowOutcome: 'conflict', message: "note 'subject' changed on the destination during apply: " + detail,
  }));
  expect(f.write).not.toHaveBeenCalled();
  expect(f.rows.get('subject')).toEqual(exists ? stored : undefined);
});

it('maps only a configured domain conflict and preserves an unexpected driver failure', async () => {
  class StaleRow extends Error {}
  const write = vi.fn<Config['write']>();
  const f = setup({ write, errors: { conflict: [StaleRow] } });
  f.rows.set('subject', stored);
  const fault = new Error('driver unavailable');
  write.mockRejectedValueOnce(new StaleRow('row was edited')).mockRejectedValueOnce(fault);
  await expect(f.apply(7)).rejects.toThrow(new PublishContentApplyRowError({
    rowOutcome: 'conflict', message: "note 'subject' changed on the destination during apply: row was edited",
  }));
  await expect(f.apply(7)).rejects.toBe(fault);
  expect(f.rows.get('subject')).toEqual(stored);
});

it.each(['restore', 'remove'] as const)('reverses side effects before it has to %s the row after an audit write failure', async mode => {
  const calls: string[] = [];
  const f = setup({
    write: async ({ ports, id, onRollback }) => {
      onRollback({ undo: async () => { calls.push('undo-first'); } });
      onRollback({ undo: async () => { calls.push('undo-second'); } });
      ports.rows.set(id, { ...stored, title: 'Incoming', version: 8 });
      return { version: 8 };
    },
    undo: {
      restore: async ({ ctx, prior }) => { calls.push('restore'); ctx.ports.rows.set(prior.id, prior); },
      remove: async ({ id, ports }) => { calls.push('remove'); ports.rows.delete(id); },
    },
  });
  if (mode === 'restore') f.rows.set('subject', stored);
  const fault = new Error('audit disk offline');
  vi.spyOn(f.changeSets, 'insert').mockRejectedValueOnce(fault);
  await expect(f.apply(mode === 'restore' ? 7 : undefined)).rejects.toBe(fault);
  expect(calls).toEqual(['undo-second', 'undo-first', mode]);
  expect(f.rows.get('subject')).toEqual(mode === 'restore' ? stored : undefined);
  expect(await f.changeSets.listByWorkspace({ workspaceId: 'w' })).toEqual([]);
});
