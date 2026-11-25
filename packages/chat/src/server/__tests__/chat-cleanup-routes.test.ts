import { expect, it, vi } from 'vitest';
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
