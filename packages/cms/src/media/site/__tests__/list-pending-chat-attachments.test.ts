import { expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@jini-ai/core';
import { buildListPendingChatAttachmentsTool, type PendingChatAttachmentLookup } from '../list-pending-chat-attachments.js';

const ctx: ToolExecutionContext = {
  input: {}, executionId: 'execution', principal: { id: 'owner' }, run: { id: 'run-west' }, signal: new AbortController().signal,
};
const createdAt = Date.parse('2026-11-20T12:05:00.000Z');
const photo = { ref: 'attachment:photo', name: 'Garden.png', kind: 'image' as const, size: 240, createdAt, path: '/private/file' };
const draft = { ref: 'attachment:older', name: 'Older draft.md', kind: 'file' as const, size: 70, createdAt };

it('projects only this message’s attachments, looking them up with the trusted owner and run', async () => {
  const listPendingForOwner = vi.fn<PendingChatAttachmentLookup['listPendingForOwner']>(async ({ ownerId }, options) =>
    ownerId === 'owner' && options?.runId === 'run-west' ? [draft, photo] : []);
  const getMessageAttachmentRefs = vi.fn(async ({ runId }: { runId: string }, _options: Record<string, never>) =>
    runId === 'run-west' ? ['attachment:photo', 'attachment:missing'] : []);
  const tool = buildListPendingChatAttachmentsTool({ getStore: () => ({ listPendingForOwner }), getMessageAttachmentRefs });
  expect(tool.descriptor).toMatchObject({ id: 'chat_list_pending_attachments', readOnly: true,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } });
  expect(await tool.handler(ctx)).toEqual({ attachments: [
    { attachmentRef: 'attachment:photo', filename: 'Garden.png', kind: 'image', size: 240, uploadedAt: '2026-11-20T12:05:00.000Z' },
  ] });
  expect(listPendingForOwner.mock.calls).toEqual([[{ ownerId: 'owner' }, { runId: 'run-west' }]]);
  expect(getMessageAttachmentRefs.mock.calls).toEqual([[{ runId: 'run-west' }, {}]]);
});

it('fails closed without a message binding, and resolves a late-starting store on the next call', async () => {
  let store: PendingChatAttachmentLookup | undefined;
  const tool = buildListPendingChatAttachmentsTool({ getStore: () => store });
  await expect(tool.handler(ctx)).rejects.toThrow('attachment store is not ready');
  store = { listPendingForOwner: async () => [photo] };
  expect(await tool.handler(ctx)).toEqual({ attachments: [] });
});
