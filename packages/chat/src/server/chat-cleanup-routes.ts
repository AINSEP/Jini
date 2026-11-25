import { defineJsonRoute, ok, err } from '@jini-ai/core/contracts/server';
import type { CleanupPreviewStore } from '@jini-ai/core/contracts/storage';
import type { ChatOwnerScope, ChatStore, ChatTitleSource } from '../store/ports.js';
import type { createChatBulkDeletion } from '../store/sql/bulk-deletion.js';

export interface ChatCleanupPatchDeps {
  principal: string; scope: ChatOwnerScope;
  copy: { invalidInput: string; expired: string; notFound: string };
  readPatchInput: (required: { body: unknown }) => { title?: string; pinned?: boolean; source?: ChatTitleSource };
}
export type ChatCleanupPreviewDeps = Omit<ChatCleanupPatchDeps, 'readPatchInput'>;
export type ChatCleanupApplyDeps = ChatCleanupPreviewDeps;
export type ChatCleanupSelectedDeps = ChatCleanupPreviewDeps;

export function createChatCleanupRoutes(
  { paths, bulkDeletionFor, previewStore, store }: {
    paths: { patch: string; preview: string; apply: string; deleteSelected: string };
    bulkDeletionFor: (required: { principal: string; scope: ChatOwnerScope }) => ReturnType<typeof createChatBulkDeletion>;
    previewStore: CleanupPreviewStore;
    store: (required: { principal: string; scope: ChatOwnerScope }) => ChatStore;
  }, _optional = {},
) {
  return {
    patch: defineJsonRoute<{ id: string; body: unknown }, object, ChatCleanupPatchDeps>({
      method: 'patch', path: paths.patch,
      parse: raw => ok({ value: { id: raw.params.id!, body: raw.body } }),
      handle: async ({ input, deps }) => {
        const { source = 'manual', ...patch } = deps.readPatchInput({ body: input.body });
        const conversation = await store(deps).updateConversation({ id: input.id, ...patch }, { source });
        return conversation ? ok({ value: { conversation } }) : err({ error: { code: 'NOT_FOUND', message: deps.copy.notFound } });
      },
    }, { requireSameOrigin: true }),
    preview: defineJsonRoute<{ body: unknown }, object, ChatCleanupPreviewDeps>({
      method: 'post', path: paths.preview, parse: raw => ok({ value: { body: raw.body } }),
      handle: async ({ input, deps }) => {
        const body = input.body as { before?: unknown } | null;
        if (typeof body?.before !== 'number' || !Number.isFinite(body.before)) return err({ error: { code: 'INVALID_INPUT', message: deps.copy.invalidInput } });
        const preview = await bulkDeletionFor(deps).preview({ before: body.before }, {});
        const token = previewStore.put({ principal: deps.principal, kind: 'chat-cleanup', scope: JSON.stringify(deps.scope), payload: preview }, {});
        return ok({ value: { ...preview, previewToken: token.token } });
      },
    }, { requireSameOrigin: true }),
    apply: defineJsonRoute<{ body: unknown }, object, ChatCleanupApplyDeps>({
      method: 'post', path: paths.apply, parse: raw => ok({ value: { body: raw.body } }),
      handle: async ({ input, deps }) => {
        const body = input.body as { previewToken?: unknown; confirm?: unknown } | null;
        if (body?.confirm !== true || typeof body.previewToken !== 'string') return err({ error: { code: 'INVALID_INPUT', message: deps.copy.invalidInput } });
        const taken = previewStore.take({ token: body.previewToken, principal: deps.principal, kind: 'chat-cleanup', scope: JSON.stringify(deps.scope) }, {});
        if (!taken) return err({ error: { code: 'INVALID_INPUT', message: deps.copy.expired } });
        const ids = taken.payload.ids as string[];
        const before = taken.payload.before as number;
        const result = await bulkDeletionFor(deps).apply({ ids: ids.slice(0, 500), before }, {});
        if (ids.length <= 500) return ok({ value: result });
        const next = previewStore.put({ principal: deps.principal, kind: 'chat-cleanup', scope: JSON.stringify(deps.scope), payload: { ids: ids.slice(500), before, deadline: taken.deadline } }, {});
        return ok({ value: { ...result, previewToken: next.token } });
      },
    }, { requireSameOrigin: true }),
    deleteSelected: defineJsonRoute<{ body: unknown }, object, ChatCleanupSelectedDeps>({
      method: 'post', path: paths.deleteSelected, parse: raw => ok({ value: { body: raw.body } }),
      handle: async ({ input, deps }) => {
        const body = input.body as { ids?: unknown; confirm?: unknown } | null;
        if (body?.confirm !== true || !Array.isArray(body.ids) || body.ids.length > 500 || !body.ids.every(id => typeof id === 'string')) return err({ error: { code: 'INVALID_INPUT', message: deps.copy.invalidInput } });
        return ok({ value: await bulkDeletionFor(deps).apply({ ids: body.ids }, {}) });
      },
    }, { requireSameOrigin: true }),
  };
}
