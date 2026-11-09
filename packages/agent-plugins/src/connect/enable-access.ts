/** Bind Jini's grant plan to the existing external-MCP rows and plugin enable card. */
import { ToolInputError, redactSecrets, type AccessApprovalResource } from '@jini-ai/core';
import { planAgentPluginToolGrant, type AgentPluginToolGrant, type AgentPluginDeclaredTools } from '@jini-ai/agent-plugins/lifecycle';
import type { AgentPluginMcpRecord, AgentPluginMcpContext, AgentPluginMcpProjectionPorts, AgentPluginMcpProjections } from '../service-ports.js';
import type { AgentPluginMcpPort } from '../service-ports.js';
import { findAgentPluginMcpServerDefaults, planAgentPluginMcpFederation, type PlannedAgentPluginMcpUpsert } from './federate-mcp.js';
import type { McpServerConfig } from '../mcp-metadata.js';

/** Translate persisted host columns to Jini's grant contract. O(n) in stored list bytes; no I/O. */
export function storedAgentPluginGrants({ row, projections }: { row: Pick<AgentPluginMcpRecord, 'enabled' | 'allowedToolNames' | 'writeAllowedToolNames'> | null; projections: AgentPluginMcpProjections }, _options = {}): AgentPluginToolGrant {
  if (!row) return { enabled: false, allow: [], write: [] };
  const grants = projections.readToolGrants(row, { strict: true });
  return { enabled: row.enabled, allow: grants.allowedToolNames, write: grants.writeAllowedToolNames };
}

/** Bind Jini's grant decision to the existing store's name and 64-tool bounds before card/write.
 * Production callers pass the composed ports; only the legacy no-ports Tovu signature binds Tovu's pair.
 * @throws ToolInputError with the store's validation reason (core-redacted) and a repair action.
 * @complexity O(a+w) names; no I/O or schema changes.
 */
export function validatedAgentPluginToolGrant(
  required: { current: AgentPluginToolGrant; declared: AgentPluginDeclaredTools },
  options: { reason?: 'sign-in' | 'owner-enable'; ports: AgentPluginMcpProjectionPorts },
): AgentPluginToolGrant | null {
  const ports = options.ports;
  const grant = planAgentPluginToolGrant(required, options);
  if (!grant) return null;
  try {
    return { enabled: true, allow: ports.projections.validateToolNames({ names: grant.allow, field: 'allowedToolNames' }), write: ports.projections.validateToolNames({ names: grant.write, field: 'writeAllowedToolNames' }) };
  } catch (error) {
    if (ports.classifyError({ error }) !== 'validation') throw error;
    throw new ToolInputError({ message: `The plugin's combined tool grant cannot be saved: ${redactSecrets({ input: (error as Error).message }, { redactPii: false })}. Review its tool selection with external_mcp_save before enabling it.` });
  }
}

/** Check the exact source identity, rather than inheriting grants from an id collision. O(1). */
function assertPluginSource({ row, pluginId, source }: { row: AgentPluginMcpRecord | null; pluginId: string; source: PlannedAgentPluginMcpUpsert }): void {
  if (!row) return;
  const declaredSignIn = row.authMode === source.authMode || (source.acceptsAccessToken && row.authMode === 'static_env');
  const matchesOwner = row.provisionedByPluginId === null || row.provisionedByPluginId === pluginId;
  if (matchesOwner && row.url === source.url && row.transport === 'streamable_http' && declaredSignIn) return;
  throw new ToolInputError({ message: `The '${source.connectionId}' connection was configured separately or points somewhere else. Open Settings → External MCP and review this connection’s address before connecting the plugin again. Its saved sign-in was kept.` });
}

/** One indexed row lookup, with the same Jini grant decision used by the writer. O(a+w). */
async function previewSource({ workspaceId, pluginId, source, servers, repo, ports }: { workspaceId: string; pluginId: string; source: PlannedAgentPluginMcpUpsert; servers: Readonly<Record<string, McpServerConfig>>; repo: AgentPluginMcpPort['repo']; ports: AgentPluginMcpProjectionPorts }) {
  const row = await repo.findByServerId({ workspaceId, serverId: source.connectionId });
  assertPluginSource({ row, pluginId, source });
  const current = storedAgentPluginGrants({ row, projections: ports.projections });
  const declared = findAgentPluginMcpServerDefaults(servers, { serverId: source.connectionId, url: source.url });
  const grant = declared ? validatedAgentPluginToolGrant({ current, declared }, { reason: 'owner-enable', ports }) : null;
  const snapshot = { pluginId, connectionId: source.connectionId, url: source.url, revision: row ? ports.projections.admissionRevision(row) : null, expected: row ? ports.projections.accessSnapshot({ record: row }) : null, current, declared, grant };
  const resource: Omit<AccessApprovalResource, 'scope'> | null = grant ? { id: source.connectionId, label: `External MCP source: ${redactSecrets({ input: source.url }, { redactPii: false })}`, previous: current, proposed: grant, revision: snapshot.revision } : null;
  return { snapshot, resource };
}

/** Read only this plugin's declared rows before and after approval. No credentials enter the
 * card or fingerprint; the existing admission revision binds the source without copying secrets
 * or making an ordinary OAuth token refresh invalidate an otherwise unchanged approval.
 * @returns Exact resulting access and a stable comparison key for the existing approval identity.
 * @throws ToolInputError for a conflicting endpoint/owner or unsupported declaration.
 * @complexity O(s*(a+w)) in declared servers and tool lists; s point reads, no network calls.
 */
export async function previewAgentPluginEnableAccess(
  { workspaceId, pluginId, servers, repo, ...context }: AgentPluginMcpProjectionPorts & { workspaceId: string; pluginId: string; servers: Readonly<Record<string, McpServerConfig>>; repo: AgentPluginMcpPort['repo'] },
  _options = {},
) {
  const ports: AgentPluginMcpProjectionPorts = { projections: context.projections, classifyError: context.classifyError };
  const planned = planAgentPluginMcpFederation({ servers });
  if (planned.skipped.length) throw new ToolInputError({ message: `The plugin connection cannot be enabled here: ${planned.skipped.map(entry => `${entry.serverKey}: ${entry.reason}`).join('; ')}` });
  const snapshots = [];
  const resources: Omit<AccessApprovalResource, 'scope'>[] = [];
  for (const source of planned.toUpsert) {
    const preview = await previewSource({ workspaceId, pluginId, source, servers, repo, ports });
    snapshots.push(preview.snapshot);
    if (preview.resource) resources.push(preview.resource);
  }
  return { key: JSON.stringify(snapshots), snapshots, resources };
}
