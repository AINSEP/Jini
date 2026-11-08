/**
 * @file How an executable Agent Plugin tool call is confirmed by the host, on the EXISTING approval
 * owner (`assistant/assistant-tool-approval-policy.ts` families + `applyToolApprovalPolicy`).
 * No second confirmation engine: this file only maps the plugin's declared effect to a reviewed
 * family and computes the card's extra rows.
 *
 * Before a write or destructive call is shown, the disclosure step freezes what the human approves:
 * the approval owner has already detached the input (request + target); this step reads the
 * account each of the call's connections is signed in as and binds them all to the call, so
 * execution refuses if a connection was switched to another account meanwhile, or if the call asks
 * for a connection its approval did not show. Which connections a call has is the projection's
 * answer (its validated top-level `connectionRef`), never a walk over the arguments here. Activation and authorization are rechecked by the
 * plugin tool contract right before the handler runs.
 */
import type { SurfaceCardDetail as SurfaceDetail } from '@jini-ai/core/contracts/cards';
import type { AgentPluginDisclosureMessages } from './ports.js';
import type { ToolExecutionContext } from '@jini-ai/core';
import type { AgentPluginToolDisclosure } from '../../lifecycle/tools/projection.js';
import type { AgentPluginToolEffect } from '../../lifecycle/tools/manifest.js';
import type { AgentPluginConnectionAccess, FrozenConnectionAccounts } from './host-capabilities.js';

/** The approval family each declared effect maps to (see the families' own comment). */
export const APPROVAL_FAMILY_BY_EFFECT = {
  read: 'agent-plugin-read', write: 'agent-plugin-write', destructive: 'agent-plugin-destructive',
} as const satisfies Readonly<Record<AgentPluginToolEffect, string>>;


/** The projection's disclosure entry point (`createAgentPluginToolProjection().describeAffectedResources`). */
export interface AgentPluginDisclosureSource {
  describeAffectedResources(required: { readonly toolId: string; readonly input: unknown }, optional?: Record<string, never>): Promise<AgentPluginToolDisclosure | null>;
}

/**
 * Builds the card rows for one confirming call and freezes its account.
 * @param required.source - The projection (validates input, asks the plugin what would change).
 * @param required.connections - Host connection accessor, scoped to the calling plugin and workspace.
 * @param required.frozen - Where the frozen accounts are bound for the capability port to enforce.
 * @returns `disclose({ ctx, toolId, pluginId, workspaceId })` → one Account row per connection the call
 *   may use (the projection's `connections`, the same set Jini's capability session enforces) + one row
 *   per affected resource. The accounts are always bound, even when empty: a call naming no connection
 *   is then refused any token at execution.
 * @throws Error when the tool was withdrawn or a connection is not connected (unless `skipUnconnected`:
 *   an admin action may sign one in, and an unconnected connection, left unbound, gets no token); ToolInputError for bad input.
 * @complexity O(c + r) rows plus one disclosure hook call and one account read per connection.
 */
export function createAgentPluginDisclosure(
  required: { readonly source: AgentPluginDisclosureSource; readonly connections: AgentPluginConnectionAccess; readonly frozen: FrozenConnectionAccounts; readonly messages: AgentPluginDisclosureMessages },
  _optional: Record<string, never> = {},
) {
  return async (
    { ctx, toolId, pluginId, workspaceId }: { readonly ctx: ToolExecutionContext; readonly toolId: string; readonly pluginId: string; readonly workspaceId: string },
    optional: { readonly skipUnconnected?: boolean } = {},
  ): Promise<readonly SurfaceDetail[]> => {
    const disclosure = await required.source.describeAffectedResources({ toolId, input: ctx.input });
    if (!disclosure) throw new Error(required.messages.withdrawn);
    const rows: SurfaceDetail[] = [];
    const accounts = new Map<string, string>();
    for (const connectionRef of disclosure.connections) {
      const account = await required.connections.readAccount({ workspaceId, pluginId, connectionRef });
      if (!account && optional.skipUnconnected) continue;
      if (!account) throw new Error(required.messages.notConnected);
      accounts.set(connectionRef, account.accountId);
      rows.push({ label: required.messages.accountLabel, value: account.displayName });
    }
    required.frozen.bind({ signal: ctx.signal, accounts });
    for (const resource of disclosure.resources) rows.push({ label: required.messages.affectsLabel, value: resource });
    return rows;
  };
}

