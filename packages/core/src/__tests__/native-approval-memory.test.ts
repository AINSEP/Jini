import { expect, it, vi } from 'vitest';
import type { ConversationToolApprovalStore } from '../contracts/site/assistant-mcp-services.js';
import { createNativeApprovalMemory } from '../native-approval-memory.js';
import { ToolInputError } from '../tool-input-errors.js';
import type { ToolExecutionContext } from '../tool-registry.js';

const context = (id = 'ana', runId = 'run-1'): ToolExecutionContext => ({
  principal: { id }, run: { id: runId }, executionId: 'exec-1', input: {}, signal: new AbortController().signal,
});
const key = 'plugin:publish:v2';
const clock = { nowMs: () => Date.UTC(2026, 10, 26, 16, 30) };
const confirmer = { id: 'ana', kind: 'user' } as const;

it('persists the scoped grant under its original conversation and reuses it across the same human’s runs only', async () => {
  const rows: Parameters<ConversationToolApprovalStore['grant']>[0][] = [];
  const store: ConversationToolApprovalStore = {
    has: async () => { throw new Error('Native grants require identity lookup'); },
    hasIdentity: async (requested) => rows.some(({ key: saved }) =>
      saved.principalId === requested.principalId && saved.connectionId === requested.connectionId &&
      saved.toolName === requested.toolName && saved.fingerprint === requested.fingerprint),
    grant: async row => { rows.push(row); },
  };
  const conversationIdForRun = vi.fn(({ runId, principalId }: { runId: string; principalId: string }) =>
    runId === 'run-1' && principalId === 'ana' ? 'chat-1' : undefined);
  const memory = (workspaceId: string) => createNativeApprovalMemory({ store, workspaceId, clock, conversationIdForRun });
  const approval = memory('workspace-1');
  expect(await approval.has({ ctx: context(), key })).toBe(false);
  await approval.grant({ ctx: context(), key, confirmer });
  expect(conversationIdForRun.mock.calls).toEqual([[{ runId: 'run-1', principalId: 'ana' }]]);
  expect(rows).toEqual([{
    key: { conversationId: 'chat-1', principalId: 'ana', connectionId: '["native-escalation","workspace-1"]', toolName: key, fingerprint: key },
    grantedAt: '2026-11-26T16:30:00.000Z',
  }]);
  expect(await approval.has({ ctx: context('ana', 'run-2'), key })).toBe(true);
  expect(await approval.has({ ctx: context('bea'), key })).toBe(false);
  expect(await approval.has({ ctx: context(), key: 'plugin:publish:v3' })).toBe(false);
  expect(await memory('workspace-2').has({ ctx: context(), key })).toBe(false);
});

it('refuses unavailable identity lookup, a different confirmer and an unbound conversation without saving a grant', async () => {
  const store = {
    has: vi.fn<ConversationToolApprovalStore['has']>().mockResolvedValue(false),
    grant: vi.fn<ConversationToolApprovalStore['grant']>().mockResolvedValue(undefined),
  };
  const conversationIdForRun = vi.fn(() => undefined);
  const approval = createNativeApprovalMemory({ store, workspaceId: 'workspace-1', clock, conversationIdForRun });
  const ctx = context();
  await expect(approval.has({ ctx, key })).rejects.toThrow(new ToolInputError({ message:
    'NATIVE_APPROVAL_MEMORY_UNAVAILABLE: The approval store cannot reuse identity grants. Nothing was changed.',
  }));
  await expect(approval.grant({ ctx, key, confirmer: { ...confirmer, id: 'bea' } })).rejects.toThrow(new ToolInputError({ message:
    'NATIVE_APPROVAL_ACTOR_MISMATCH: The approval actor does not match this call. Nothing was changed.',
  }));
  expect(conversationIdForRun).not.toHaveBeenCalled();
  await expect(approval.grant({ ctx, key, confirmer })).rejects.toThrow(new ToolInputError({ message:
    'NATIVE_APPROVAL_CONVERSATION_REQUIRED: The human approval could not be saved to this conversation. Nothing was changed.',
  }));
  expect(conversationIdForRun.mock.calls).toEqual([[{ runId: 'run-1', principalId: 'ana' }]]);
  expect(store.has).not.toHaveBeenCalled();
  expect(store.grant).not.toHaveBeenCalled();
});
