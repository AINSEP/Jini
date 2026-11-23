/**
 * @file The host's "Allow for this chat" remembered-approval store port. Types only.
 *
 * A remembered external-tool approval lives with the conversation and is scoped to the person;
 * naming another person's conversation reuses nothing. Fingerprinting, drift checks and
 * destructive-call locks live in `@jini-ai/mcp/federation`.
 *
 * `ConversationToolApprovalKey` is an additive copy of the declaration in `@jini-ai/mcp/federation`
 * (`federation/tool-approvals.ts`), which keeps its identical declaration and export until the
 * paired cutover. The store below is the host-boundary variant: its `grant` takes the
 * (required, optional) argument pair.
 */

/** One saved "Allow for this chat". */
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
