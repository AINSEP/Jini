import type { AgentPluginMcpRecord, AgentPluginMcpProjectionPorts, AgentPluginMcpProjections } from '../service-ports.js';
import type { LoadPluginCredentialCards } from '../../custom-credentials/plugin-credential-card.js';
import type { ApiConnectionHost } from '../../api-connections/host.js';

type ConnectionRow = Pick<AgentPluginMcpRecord, 'provisionedByPluginId' | 'authMode' | 'oauthStatus' | 'sealedOAuth'>;
export type AgentPluginConnectionStatus = 'connected' | 'disconnected' | 'pending' | 'needs_reauth';

/** Token-free read model for the Agent Plugins screen. Activation and account state are separate:
 * disabled plugins retain their saved sign-in. One MCP roster read, one card catalog read and one
 * API catalog read; API status reads are per declared connection, with no provider HTTP calls.
 * @complexity O(m + c + a) time/space in MCP rows, credential cards and declared API connections. */
export async function loadAgentPluginConnectionStatuses(required: Pick<AgentPluginMcpProjectionPorts, 'projections'> & {
  workspaceId: string;
  mcp: { listByWorkspaceId: (workspaceId: string) => Promise<readonly ConnectionRow[]> };
  loadCards?: LoadPluginCredentialCards;
  apiConnections?: Pick<ApiConnectionHost, 'listConnections' | 'statusOf'>;
}, _optional = {}): Promise<ReadonlyMap<string, AgentPluginConnectionStatus>> {
  const [rows, cards, connections] = await Promise.all([
    required.mcp.listByWorkspaceId(required.workspaceId), required.loadCards?.(required.workspaceId) ?? [],
    required.apiConnections?.listConnections({}) ?? [],
  ]);
  const states = new Map<string, AgentPluginConnectionStatus[]>();
  addMcpStatuses({ rows, states, projections: required.projections });
  await addApiStatuses({ connections, host: required.apiConnections, states });
  // A never-provisioned sign-in is still visibly absent. Plugins with no account declaration
  // (skills/local tools) get no badge; an unrelated manual MCP server cannot sign them in.
  addUnconnectedCards({ cards, states });
  return new Map([...states].map(([pluginId, statuses]) => [pluginId, summarizeStatus({ statuses })]));
}

/** Existing auth readers own credential classification; this projection never opens a token. */
function mcpSignInStatus({ row, projections }: { row: ConnectionRow; projections: AgentPluginMcpProjections }, _optional = {}): AgentPluginConnectionStatus | undefined {
  if (projections.hasStaticAccessToken(row)) return 'connected';
  if (row.authMode !== 'oauth') return undefined;
  return projections.oauthStatus(row);
}

/** A partial sign-in must not claim that every connection needed by a plugin is ready. */
function summarizeStatus({ statuses }: { statuses: readonly AgentPluginConnectionStatus[] }, _optional = {}): AgentPluginConnectionStatus {
  for (const status of ['needs_reauth', 'pending', 'disconnected'] as const) if (statuses.includes(status)) return status;
  return 'connected';
}

/** Accumulate in locally owned groups, avoiding repeated array copies for multi-server plugins. */
function appendStatus({ states, pluginId, status }: {
  states: Map<string, AgentPluginConnectionStatus[]>; pluginId: string; status: AgentPluginConnectionStatus;
}, _optional = {}): void {
  const group = states.get(pluginId) ?? [];
  group.push(status);
  states.set(pluginId, group);
}

function addMcpStatuses({ rows, states, projections }: {
  rows: readonly ConnectionRow[]; states: Map<string, AgentPluginConnectionStatus[]>; projections: AgentPluginMcpProjections;
}, _optional = {}): void {
  for (const row of rows) {
    if (!row.provisionedByPluginId) continue;
    const status = mcpSignInStatus({ row, projections });
    if (status) appendStatus({ states, pluginId: row.provisionedByPluginId, status });
  }
}

async function addApiStatuses({ connections, host, states }: {
  connections: Awaited<ReturnType<ApiConnectionHost['listConnections']>>;
  host: Pick<ApiConnectionHost, 'statusOf'> | undefined; states: Map<string, AgentPluginConnectionStatus[]>;
}, _optional = {}): Promise<void> {
  if (!host) return;
  for (const connection of connections) {
    const { status } = await host.statusOf({ connection });
    appendStatus({ states, pluginId: connection.pluginId,
      status: status === 'reconnect-required' || status === 'revocation-pending' ? 'needs_reauth' : status });
  }
}

function addUnconnectedCards({ cards, states }: {
  cards: Awaited<ReturnType<LoadPluginCredentialCards>>; states: Map<string, AgentPluginConnectionStatus[]>;
}, _optional = {}): void {
  for (const card of cards) {
    if (card.pluginId && card.saveKind === 'oauth' && !states.has(card.pluginId)) states.set(card.pluginId, ['disconnected']);
  }
}
