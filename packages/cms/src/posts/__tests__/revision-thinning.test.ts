import { expect, it, vi } from 'vitest';
import { createRevisionThinning } from '../revision-thinning.js';

function setup() {
  let rows = [{ id: 'a', body: 'old' }, { id: 'b', body: 'middle' }, { id: 'c', body: 'new' }];
  let payload: Record<string, unknown> | null = null;
  const protections = { isPublished: vi.fn(async (_required: { id: string }) => false), isRestoreTarget: vi.fn(async (_required: { id: string }) => false), isRestoredFrom: vi.fn(async (_required: { id: string }) => false), isUndoReferenced: vi.fn(async (_required: { id: string }) => false) };
  const revisions = {
    withPostLock: async ({ run }: { run: () => Promise<void> }) => run(),
    listOldest: async () => rows,
    newestId: async () => rows.at(-1)!.id,
    deleteIds: async ({ ids }: { ids: readonly string[] }) => { rows = rows.filter(row => !ids.includes(row.id)); },
  };
  const engine = createRevisionThinning({ revisions, protections, clock: () => 10, previewStore: {
    put: ({ payload: value }) => { payload = value; return { token: 'opaque', deadline: 100 }; },
    take: ({ token }) => { const value = payload; payload = null; return token === 'opaque' && value ? { payload: value, deadline: 100 } : null; },
  } }, {});
  const scope = { workspaceId: 'ws', postId: 'p', kind: 'post' };
  const preview = () => engine.preview({ principal: 'alice', scope, olderThan: 5 }, {});
  const apply = () => engine.apply({ principal: 'alice', scope, previewToken: 'opaque', confirm: true }, {});
  return { engine, scope, protections, revisions, rows: () => rows, preview, apply };
}
it('published / restore / undo targets kept', async () => {
  for (const name of ['isPublished', 'isRestoreTarget', 'isRestoredFrom', 'isUndoReferenced'] as const) {
    const h = setup(); await h.preview();
    h.protections[name].mockResolvedValue(true);
    expect((await h.apply()).deleted).toEqual([]);
    expect(h.rows().map(row => row.id)).toEqual(['a', 'b', 'c']);
  }
});
it('newest kept', async () => {
  const h = setup(); await h.preview();
  expect((await h.apply()).deleted).toEqual(['a', 'b']);
  expect(h.rows()).toEqual([{ id: 'c', body: 'new' }]);
});
it('requires explicit scope', async () => {
  const h = setup();
  await expect(h.engine.preview({ principal: 'alice', scope: {} as typeof h.scope, olderThan: 5 }, {})).rejects.toThrow();
  await expect(h.engine.apply({ principal: 'alice', scope: {} as typeof h.scope, previewToken: 'opaque', confirm: true }, {})).rejects.toThrow();
});
it('undo reference added after preview is kept', async () => {
  const h = setup(); await h.preview();
  h.protections.isUndoReferenced.mockImplementation(async ({ id }: { id: string }) => id === 'b');
  expect((await h.apply()).deleted).toEqual(['a']);
  expect(h.rows().map(row => row.id)).toEqual(['b', 'c']);
});
it('history reads the same after thinning', async () => {
  const h = setup();
  const before = h.rows().map(row => JSON.stringify(row));
  await h.preview();
  h.protections.isRestoreTarget.mockImplementation(async ({ id }) => id === 'b');
  await h.apply();
  expect(h.rows().map(row => JSON.stringify(row))).toEqual(before.slice(1));
});

it('keeps the oldest unconfirmed revision and does not jump forward to confirmed history', async () => {
  const h = setup();
  const list = h.revisions.listOldest;
  const read = vi.spyOn(h.revisions, 'listOldest').mockResolvedValueOnce([{ id: 'b', body: 'middle' }, { id: 'c', body: 'new' }]);
  try {
    expect(await h.preview()).toEqual({ ids: ['b', 'c'], count: 2, previewToken: 'opaque' });
    expect(await h.apply()).toEqual({ deleted: [], kept: [{ id: 'a', reason: 'unconfirmed' }] });
    expect((await list()).map(row => row.id)).toEqual(['a', 'b', 'c']);
  } finally { read.mockRestore(); }
});

it('fails closed when a protection lookup rejects, and keeps the valid preview on unconfirmed apply', async () => {
  const h = setup();
  await h.preview();
  await expect(h.engine.apply({ principal: 'alice', scope: h.scope, previewToken: 'opaque', confirm: false }, {}))
    .rejects.toThrow('Confirm the revision preview first.');
  h.protections.isPublished.mockRejectedValueOnce(new Error('publication lookup unavailable'));
  expect(await h.apply()).toEqual({ deleted: [], kept: [{ id: 'a', reason: 'isPublished' }] });
  expect(h.rows().map(row => row.id)).toEqual(['a', 'b', 'c']);
  await expect(h.apply()).rejects.toThrow('The revision preview expired.');
});
