import type { AdminExternalMcpServer, ExternalMcpToolApprovalDto } from "@jini-ai/core/contracts/site/cms-external-mcp";

/**
 * @file What `useAlwaysAllow` needs from the outside world, as an interface rather than a direct
 * `lib/api` import — same split the integrations ports make.
 */
export interface AlwaysAllowPort {
  listExternalMcpToolApprovals(): Promise<{ approvals: ExternalMcpToolApprovalDto[] }>;
  /** For each server's label. */
  listExternalMcpServers(): Promise<{ servers: Pick<AdminExternalMcpServer, "serverId" | "label">[] }>;
  revokeExternalMcpToolApproval(input: { serverId: string; toolName: string }): Promise<{ removed: boolean }>;
}
