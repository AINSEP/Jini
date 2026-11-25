import { ToolInputError } from './tool-input-errors.js';
import type { RememberedApprovalPort } from './approval.js';
import type { Clock } from './primitives/index.js';
import type { ConversationToolApprovalStore } from './contracts/site/assistant-mcp-services.js';

/** Adapt native escalation grants to the existing external-MCP remembered approval store.
 * Real conversations remain the persistence/revocation parents; the content store's server FK
 * cannot hold a native plugin. Identity keys are host-generated and never taken from callback input.
 * @param required.store The existing durable chat grant repository (or its shared memory fake).
 * @returns A core grant port scoped to workspace, delegating human, plugin and version/digest.
 * @throws ToolInputError if the host cannot bind a real conversation or store identity lookups.
 * @complexity One bounded SQL lookup/write; the memory adapter scans its grant rows.
 * @example createNativeApprovalMemory({ store, workspaceId, conversationIdForRun, clock });
 */
export function createNativeApprovalMemory(
  { store, workspaceId, conversationIdForRun, clock }: {
    store: ConversationToolApprovalStore; workspaceId: string; clock: Clock;
    conversationIdForRun: (required: { runId: string; principalId: string }) => string | undefined;
  }, _optional = {},
): RememberedApprovalPort {
  const coordinates = ({ key, principalId }: { key: string; principalId: string }, _optional = {}) => ({
    principalId, connectionId: JSON.stringify(['native-escalation', workspaceId]),
    toolName: key, fingerprint: key,
  });
  return {
    has: async ({ ctx, key }) => {
      if (!store.hasIdentity) throw new ToolInputError({ message: 'NATIVE_APPROVAL_MEMORY_UNAVAILABLE: The approval store cannot reuse identity grants. Nothing was changed.' });
      return store.hasIdentity(coordinates({ key, principalId: ctx.principal.id }));
    },
    grant: async ({ ctx, key, confirmer }) => {
      if (confirmer.id !== ctx.principal.id) throw new ToolInputError({ message: "NATIVE_APPROVAL_ACTOR_MISMATCH: The approval actor does not match this call. Nothing was changed." });
      const conversationId = conversationIdForRun({ runId: ctx.run.id, principalId: confirmer.id });
      if (!conversationId) throw new ToolInputError({ message: 'NATIVE_APPROVAL_CONVERSATION_REQUIRED: The human approval could not be saved to this conversation. Nothing was changed.' });
      await store.grant({ key: { ...coordinates({ key, principalId: confirmer.id }), conversationId }, grantedAt: new Date(clock.nowMs()).toISOString() });
    },
  };
}
