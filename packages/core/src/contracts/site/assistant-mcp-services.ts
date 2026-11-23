/**
 * @file Host storage contract for remembered "Allow for this chat" external-tool approvals.
 * This chat grant lives with the conversation and is scoped to the person; naming another
 * person's conversation reuses nothing. Fingerprinting, drift checks and destructive-call locks
 * live in `@jini-ai/mcp/federation`; adapters (in-memory, SQL) stay with the host.
 */

/** One saved "Allow for this chat". Same shape as `@jini-ai/mcp/federation`'s
 *  `ConversationToolApprovalKey`, which is expected to re-export this declaration. */
export interface ConversationToolApprovalKey {
  readonly conversationId: string;
  readonly principalId: string;
  readonly connectionId: string;
  readonly toolName: string;
  readonly fingerprint: string;
}

/** The conversation grant key and timestamp are passed together at each boundary. */
export interface ConversationToolApprovalStore {
  has(key: ConversationToolApprovalKey): Promise<boolean>;
  /** Person/identity grant shared across existing chats; used only for native escalations. */
  hasIdentity?(key: Omit<ConversationToolApprovalKey, "conversationId">): Promise<boolean>;
  grant(required: { key: ConversationToolApprovalKey; grantedAt: string }, optional?: Record<string, never>): Promise<void>;
}
