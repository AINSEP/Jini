/** Bind Jini's grant plan to the existing external-MCP rows and plugin enable card. */
import { ToolInputError, redactSecrets, type AccessApprovalResource } from '@jini-ai/core';
import { planAgentPluginToolGrant, type AgentPluginToolGrant, type AgentPluginDeclaredTools } from '../lifecycle/enable-grants.js';
import type { AgentPluginMcpRecord, AgentPluginMcpProjectionPorts, AgentPluginMcpProjections } from './ports.js';
import type { AgentPluginMcpPort } from './ports.js';
import { findAgentPluginMcpServerDefaults, planAgentPluginMcpFederation, type AgentPluginMcpFederationMessages, type AgentPluginMcpTrustClassifier, type PlannedAgentPluginMcpUpsert } from './federate-mcp.js';
import type { McpServerConfig } from '../lifecycle/manifest.js';

/** @agent-note Product copy for the enable preview's refusals. Host input: the text names the host's own
 * settings screen; it must not echo a token (the connection id and nothing secret are passed). */
export interface AgentPluginEnableAccessMessages extends AgentPluginMcpFederationMessages {
  /** The row was configured separately or points somewhere else; its saved sign-in was kept. */
  sourceConfiguredSeparately(required: { readonly connectionId: string }): string;
}

/** Translate persisted host columns to Jini's grant contract. O(n) in stored list bytes; no I/O. */
export function storedAgentPluginGrants({ row, projections }: { row: Pick<AgentPluginMcpRecord, 'enabled' | 'allowedToolNames' | 'writeAllowedToolNames'> | null; projections: AgentPluginMcpProjections }, _options = {}): AgentPluginToolGrant {
  if (!row) return { enabled: false, allow: [], write: [] };
  const grants = projections.readToolGrants(row, { strict: true });
  return { enabled: row.enabled, allow: grants.allowedToolNames, write: grants.writeAllowedToolNames };
}

/** Bind Jini's grant decision to the existing store's name and 64-tool bounds before card/write.
 * Production callers pass the composed ports; only a host's legacy no-ports signature binds that host's pair.
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
function assertPluginSource({ row, pluginId, source, messages }: { row: AgentPluginMcpRecord | null; pluginId: string; source: PlannedAgentPluginMcpUpsert; messages: AgentPluginEnableAccessMessages }): void {
  if (!row) return;
  const declaredSignIn = row.authMode === source.authMode || (source.acceptsAccessToken && row.authMode === 'static_env');
  const matchesOwner = row.provisionedByPluginId === null || row.provisionedByPluginId === pluginId;
  if (matchesOwner && row.url === source.url && row.transport === 'streamable_http' && declaredSignIn) return;
  throw new ToolInputError({ message: messages.sourceConfiguredSeparately({ connectionId: source.connectionId }) });
}

/** One indexed row lookup, with the same Jini grant decision used by the writer. O(a+w). */
async function previewSource({ workspaceId, pluginId, source, servers, repo, ports, messages }: { workspaceId: string; pluginId: string; source: PlannedAgentPluginMcpUpsert; servers: Readonly<Record<string, McpServerConfig>>; repo: AgentPluginMcpPort['repo']; ports: AgentPluginMcpProjectionPorts; messages: AgentPluginEnableAccessMessages }) {
  const row = await repo.findByServerId({ workspaceId, serverId: source.connectionId });
  assertPluginSource({ row, pluginId, source, messages });
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
  { workspaceId, pluginId, servers, repo, classifyTrust, messages, ...context }: AgentPluginMcpProjectionPorts & { workspaceId: string; pluginId: string; servers: Readonly<Record<string, McpServerConfig>>; repo: AgentPluginMcpPort['repo']; classifyTrust: AgentPluginMcpTrustClassifier; messages: AgentPluginEnableAccessMessages },
  _options = {},
) {
  const ports: AgentPluginMcpProjectionPorts = { projections: context.projections, classifyError: context.classifyError };
  const planned = planAgentPluginMcpFederation({ servers }, { classifyTrust, messages });
  if (planned.skipped.length) throw new ToolInputError({ message: `The plugin connection cannot be enabled here: ${planned.skipped.map(entry => `${entry.serverKey}: ${entry.reason}`).join('; ')}` });
  const snapshots = [];
  const resources: Omit<AccessApprovalResource, 'scope'>[] = [];
  for (const source of planned.toUpsert) {
    const preview = await previewSource({ workspaceId, pluginId, source, servers, repo, ports, messages });
    snapshots.push(preview.snapshot);
    if (preview.resource) resources.push(preview.resource);
  }
  return { key: JSON.stringify(snapshots), snapshots, resources };
}
