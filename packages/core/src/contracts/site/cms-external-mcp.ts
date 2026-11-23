/**
 * @file The admin `external-mcp` wire DTOs (ADR-029): the JSON bodies the external-MCP admin routes
 * (`@jini-ai/cms/admin-http/routes/external-mcp/*`) answer with and an admin client reads. Declared
 * here, once, so the route specs and any client mirror read the same shapes without the client
 * depending on CMS. The routes' behaviour, error ladders and body readers stay in CMS; only the
 * declarations sit in Core.
 *
 * A server row is the host's read model (it carries safe hints only, never an env VALUE); the routes
 * read just `serverId` and `enabled`, so the row type is generic and a host passes its own view.
 * CMS's `routes/external-mcp/__tests__/dto-parity.test.ts` pins every route's answer against these.
 */

/** The fields every external-MCP server row carries on the wire; the host's read model adds the rest. */
export interface ExternalMcpServerSummaryDto { serverId: string; enabled: boolean }

/** A server row tagged with whether the runtime provisioned it (built-in) or the operator did. */
export type ExternalMcpOwnedServerDto<Server extends { serverId: string } = ExternalMcpServerSummaryDto> = Server & { builtIn: boolean };

/** `GET .../mcp-servers`: the workspace's roster, each row tagged with its ownership. */
export interface ExternalMcpListEnvelope<Server extends { serverId: string } = { serverId: string }> {
  servers: ExternalMcpOwnedServerDto<Server>[];
}

/** `PUT .../mcp-servers/:serverId`: the saved row; `restartRequired` is conservative by design. */
export interface ExternalMcpPutEnvelope<Server extends { serverId: string } = ExternalMcpServerSummaryDto> {
  server: ExternalMcpOwnedServerDto<Server>;
  restartRequired: true;
}

/** `DELETE .../mcp-servers/:serverId`. */
export interface ExternalMcpDeleteEnvelope { removed: true; restartRequired: true }

/** `GET .../mcp-servers/admissions`: the federation's report; `configFailures` only when the reader reported them. */
export interface ExternalMcpAdmissionsEnvelope { connections: unknown; configFailures?: unknown }

/** One saved "Always allow" grant as it is sent (the stored fingerprint never is). */
export interface ExternalMcpToolApprovalDto { serverId: string; toolName: string; grantedByPrincipalId: string; grantedAt: string }

/** `GET .../mcp-servers/tool-approvals`: sorted by server, then tool. */
export interface ExternalMcpToolApprovalsEnvelope { approvals: ExternalMcpToolApprovalDto[] }

/** `DELETE .../mcp-servers/:serverId/tool-approvals/:toolName`. */
export interface ExternalMcpToolApprovalRevokeEnvelope { removed: true }

/** `DELETE .../mcp-servers/:serverId/oauth`. */
export interface ExternalMcpOAuthDisconnectEnvelope { disconnected: true; restartRequired: true }
