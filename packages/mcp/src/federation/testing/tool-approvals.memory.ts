import type { ExternalMcpToolApprovalRepoPort, ExternalMcpToolApprovalRecord, ConversationToolApprovalStore, ConversationToolApprovalKey } from "../tool-approvals.js";
function approvalKey(input: { serverId: string; toolName: string }, optional: { scope?: string }): string {
  return JSON.stringify([optional.scope, input.serverId, input.toolName]);
}

/** In-memory {@link ExternalMcpToolApprovalRepoPort}, for DB-less compositions and tests. */
export class InMemoryExternalMcpToolApprovalRepo implements ExternalMcpToolApprovalRepoPort {
  private readonly rows = new Map<string, ExternalMcpToolApprovalRecord>();

  constructor(_required: Record<string, never>) {}

  async find(input: { serverId: string; toolName: string }, optional: { scope?: string } = {}): Promise<ExternalMcpToolApprovalRecord | null> {
    return this.rows.get(approvalKey(input, optional)) ?? null;
  }

  async upsert(record: Omit<ExternalMcpToolApprovalRecord, "scope">, optional: { scope?: string } = {}): Promise<void> {
    const scopedRecord = { ...record, ...optional };
    // Scope belongs to the options bag, even if a caller passes a record with extra fields.
    if (optional.scope === undefined) delete scopedRecord.scope;
    this.rows.set(approvalKey(record, optional), scopedRecord);
  }

  async listByScope(_required: Record<string, never>, { scope }: { scope?: string } = {}): Promise<ExternalMcpToolApprovalRecord[]> {
    return [...this.rows.values()].filter((row) => row.scope === scope);
  }

  async delete(input: { serverId: string; toolName: string }, optional: { scope?: string } = {}): Promise<boolean> {
    return this.rows.delete(approvalKey(input, optional));
  }
}

/** In-memory {@link ConversationToolApprovalStore}, for DB-less compositions and tests. */
export function createInMemoryConversationToolApprovalStore(_required: Record<string, never>): ConversationToolApprovalStore {
  const rows = new Map<string, string>();
  const keyOf = (key: ConversationToolApprovalKey) => JSON.stringify([key.conversationId, key.principalId, key.connectionId, key.toolName]);
  return {
    async has(key) {
      return rows.get(keyOf(key)) === key.fingerprint;
    },
    async hasIdentity(key) {
      for (const [encoded, fingerprint] of rows) {
        const [, principalId, connectionId, toolName] = JSON.parse(encoded) as string[];
        if (principalId === key.principalId && connectionId === key.connectionId && toolName === key.toolName && fingerprint === key.fingerprint) return true;
      }
      return false;
    },
    async grant({ key }) {
      rows.set(keyOf(key), key.fingerprint);
    },
  };
}
