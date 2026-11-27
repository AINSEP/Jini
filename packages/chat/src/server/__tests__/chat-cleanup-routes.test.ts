import { expect, it, vi } from 'vitest';
import { runtimeFixture } from "../../store/runtime/__tests__/runtime-fixture.js";
import { createSqlChatStore } from "../../store/sql/store.js";
import { createChatCleanupRoutes } from '../chat-cleanup-routes.js';

it('delete-selected without confirm is refused', async () => {
  const apply = vi.fn();
  const routes = createChatCleanupRoutes({
    paths: { patch: '/chat/:id', preview: '/preview', apply: '/apply', deleteSelected: '/selected' },
    bulkDeletionFor: () => ({ apply, preview: vi.fn() }),
    previewStore: { put: vi.fn(), take: vi.fn() }, store: vi.fn(),
  }, {});
  const selected = routes.deleteSelected;
  expect(selected.requireSameOrigin).toBe(true);
  const parsed = selected.parse({ body: { ids: ['c'] }, params: {}, query: {} });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('parse failed');
  expect(await selected.handle({ input: parsed.value, deps: {
    principal: 'alice', scope: { scopeId: 'ws', ownerKind: 'user', ownerId: 'alice' },
    copy: { invalidInput: 'Confirm first.', expired: 'Preview expired.', notFound: 'Chat missing.' },
  } }, {})).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Confirm first.' } });
  expect(apply).not.toHaveBeenCalled();
});

const routeDeps = {
  principal: 'alice',
  scope: { scopeId: 'ws', ownerKind: 'user' as const, ownerId: 'alice' },
  copy: { invalidInput: 'Confirm first.', expired: 'Preview expired.', notFound: 'Chat missing.' },
};

function parsed<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error('route rejected a raw request before handling');
  return result.value;
}

function cleanupHarness({ ids = [] }: { ids?: string[] } = {}) {
  type Ports = Parameters<typeof createChatCleanupRoutes>[0];
  type PreviewStore = Ports['previewStore'];
  type Apply = ReturnType<Ports['bulkDeletionFor']>['apply'];
  const records = new Map<string, Parameters<PreviewStore['put']>[0] & { deadline: number }>();
  let sequence = 0;
  const put = vi.fn<PreviewStore['put']>((record) => {
    const token = `preview-${++sequence}`;
    const deadline = record.payload.deadline ?? 900;
    records.set(token, { ...record, deadline });
    return { token, deadline };
  });
  const take = vi.fn<PreviewStore['take']>(({ token, principal, scope, kind }) => {
    const record = records.get(token);
    if (!record || record.principal !== principal || record.scope !== scope || record.kind !== kind) return null;
    records.delete(token);
    return { payload: record.payload, deadline: record.deadline };
  });
  const preview = vi.fn<ReturnType<Ports['bulkDeletionFor']>['preview']>(async ({ before }) => ({ ids, count: ids.length, bytes: 0, before, kept: [] }));
  const remaining = new Set(ids);
  const apply = vi.fn<Apply>(async ({ ids: selected }) => ({
    deleted: selected.filter((id) => remaining.delete(id)),
    kept: [],
  }));
  const routes = createChatCleanupRoutes({
    paths: { patch: '/chat/:id', preview: '/preview', apply: '/apply', deleteSelected: '/selected' },
    previewStore: { put, take }, bulkDeletionFor: () => ({ preview, apply }), store: vi.fn(),
  });
  const raw = (body: unknown) => ({ params: {}, query: {}, body });
  return {
    apply, put, take, preview, remaining,
    previewRequest: (body: unknown) => routes.preview.handle({ input: parsed(routes.preview.parse(raw(body))), deps: routeDeps }, {}),
    applyRequest: (body: unknown, deps = routeDeps) => routes.apply.handle({ input: parsed(routes.apply.parse(raw(body))), deps }, {}),
    selectRequest: (body: unknown) => routes.deleteSelected.handle({ input: parsed(routes.deleteSelected.parse(raw(body))), deps: routeDeps }, {}),
  };
}

it('rejects nonnumeric or nonfinite cutoffs before fetching a deletion preview', async () => {
  const h = cleanupHarness();
  for (const body of [null, { before: '20' }, { before: Infinity }, { before: NaN }]) {
    expect(await h.previewRequest(body)).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'Confirm first.' } });
  }
  expect(h.preview).not.toHaveBeenCalled();
  expect(h.put).not.toHaveBeenCalled();
});

it('requires a valid confirmed token and binds it to the owner before allowing deletion', async () => {
  const h = cleanupHarness({ ids: ['old'] });
  expect(await h.previewRequest({ before: 55 })).toEqual({
    ok: true, value: { ids: ['old'], count: 1, bytes: 0, before: 55, kept: [], previewToken: 'preview-1' },
  });
  expect(h.preview.mock.calls).toEqual([[{ before: 55 }, {}]]);
  for (const body of [{ confirm: true, previewToken: 1 }, { confirm: false, previewToken: 'preview-1' }]) {
    expect(await h.applyRequest(body)).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'Confirm first.' } });
  }
  expect(h.take).not.toHaveBeenCalled();
  const expired = { ok: false, error: { code: 'INVALID_INPUT', message: 'Preview expired.' } };
  expect(await h.applyRequest({ confirm: true, previewToken: 'preview-1' }, { ...routeDeps, principal: 'bob' })).toEqual(expired);
  expect(await h.applyRequest({ confirm: true, previewToken: 'preview-1' }, { ...routeDeps, scope: { ...routeDeps.scope, scopeId: 'other-ws' } })).toEqual(expired);
  expect(h.apply).not.toHaveBeenCalled();
  expect([...h.remaining]).toEqual(['old']);

  const confirmed = { confirm: true, previewToken: 'preview-1' };
  expect(await h.applyRequest(confirmed)).toEqual({ ok: true, value: { deleted: ['old'], kept: [] } });
  expect(h.apply.mock.calls).toEqual([[{ ids: ['old'], before: 55 }, {}]]);
  expect([...h.remaining]).toEqual([]);
  expect(await h.applyRequest(confirmed)).toEqual(expired);
});

it('continues a large cleanup exactly once with the remaining ids, original cutoff and deadline', async () => {
  const ids = Array.from({ length: 501 }, (_, i) => `old-${i}`);
  const h = cleanupHarness({ ids });
  expect(await h.previewRequest({ before: 55 })).toMatchObject({ ok: true, value: { count: 501, previewToken: 'preview-1' } });
  expect(await h.applyRequest({ confirm: true, previewToken: 'preview-1' })).toEqual({
    ok: true, value: { deleted: ids.slice(0, 500), kept: [], previewToken: 'preview-2' },
  });
  expect([...h.remaining]).toEqual(['old-500']);
  expect(h.put.mock.calls[1]).toEqual([{
    principal: 'alice', kind: 'chat-cleanup',
    scope: '{"scopeId":"ws","ownerKind":"user","ownerId":"alice"}',
    payload: { ids: ['old-500'], before: 55, deadline: 900 },
  }, {}]);
  expect(await h.applyRequest({ confirm: true, previewToken: 'preview-2' })).toEqual({ ok: true, value: { deleted: ['old-500'], kept: [] } });
  expect(h.apply.mock.calls).toEqual([[{ ids: ids.slice(0, 500), before: 55 }, {}], [{ ids: ['old-500'], before: 55 }, {}]]);
  expect([...h.remaining]).toEqual([]);
});

it('deletes only the selected chats and rejects malformed or oversized selections without applying', async () => {
  const h = cleanupHarness({ ids: ['keep', 'remove-b', 'remove-a'] });
  for (const ids of ['remove-a', ['remove-a', 7, 'remove-b'], Array.from({ length: 501 }, (_, i) => `id-${i}`)]) {
    expect(await h.selectRequest({ confirm: true, ids })).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'Confirm first.' } });
  }
  expect(h.apply).not.toHaveBeenCalled();
  expect(await h.selectRequest({ confirm: true, ids: ['remove-a', 'remove-b'] })).toEqual({
    ok: true, value: { deleted: ['remove-a', 'remove-b'], kept: [] },
  });
  expect(h.apply.mock.calls).toEqual([[{ ids: ['remove-a', 'remove-b'] }, {}]]);
  expect([...h.remaining]).toEqual(['keep']);
});

it('patches the route id as a manual edit by default and reports an absent chat', async () => {
  const fixture = runtimeFixture();
  try {
    const store = createSqlChatStore({ kernel: fixture.kernel, scope: routeDeps.scope, clock: { nowMs: () => 12 } });
    await store.create({ id: 'chat-a', title: 'Draft title', titleSource: 'generated' });
    const routes = createChatCleanupRoutes({
      paths: { patch: '/chat/:id', preview: '/preview', apply: '/apply', deleteSelected: '/selected' },
      bulkDeletionFor: vi.fn(), previewStore: { put: vi.fn(), take: vi.fn() }, store: () => store,
    });
    const readPatchInput = vi.fn(({ body }: { body: unknown }) => {
      if (typeof body !== 'string') throw new Error('expected a title');
      return { title: body, pinned: true };
    });
    const patch = (id: string, title: string) => routes.patch.handle({
      input: parsed(routes.patch.parse({ params: { id }, query: {}, body: title })),
      deps: { ...routeDeps, readPatchInput },
    }, {});
    expect(await patch('chat-a', 'Owner title')).toMatchObject({
      ok: true, value: { conversation: { id: 'chat-a', title: 'Owner title', pinned: true, titleSource: 'manual' } },
    });
    expect(await store.get({ id: 'chat-a' })).toMatchObject({ title: 'Owner title', pinned: true, titleSource: 'manual' });
    expect(await patch('absent', 'Other title')).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'Chat missing.' } });
    expect(readPatchInput.mock.calls).toEqual([[{ body: 'Owner title' }], [{ body: 'Other title' }]]);
  } finally {
    fixture.close();
  }
});
