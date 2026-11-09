/**
 * @file Projects executable Agent Plugin tools (the host-named tools file + `.mjs` modules, admitted
 * by `@jini-ai/agent-plugins/lifecycle/tools`) onto the assistant's ToolRegistry.
 *
 * Reuses, in order: the lifecycle's trusted contribution loader (active plugin, bundled digest,
 * contained module path), Jini's tool projection (schema validation, revocable per-call
 * capabilities, affected-resource disclosure), the plugin tool contract's registration builder
 * (`p_<plugin>__<tool>` ids, enablement + authorization recheck before the handler), a core
 * registration scope (replaced when the plugin set changes), and the host's approval owner.
 *
 * Two host-specific adjustments, both explained where they happen: the contract's
 * `requiresConfirmation` flag is replaced by the approval owner's card (this host has no executor
 * confirmation transport, so that flag would park the call forever), and confirming tools carry no
 * executor deadline (the deadline would expire while the human reads the card, as for native tools).
 */
import { createToolRegistrationScope, type ToolAuthorizationContext, type ToolRegistration } from '@jini-ai/core';
import { adaptLegacyAuthorize, requireToolPermission } from '@jini-ai/core';
import type { AgentPluginExecutableContributionRegistry, AgentPluginExecutableRegistrationRequired } from './ports.js';
import { createAgentPluginToolProjection } from '../../lifecycle/tools/projection.js';
import type { AgentPluginToolEffect } from '../../lifecycle/tools/manifest.js';
import { APPROVAL_FAMILY_BY_EFFECT, createAgentPluginDisclosure } from './approval.js';
import {
  createAgentPluginToolCapabilities, createFrozenConnectionAccounts,
} from './host-capabilities.js';

interface ToolOwner { readonly pluginId: string; readonly effect: AgentPluginToolEffect }

/** Tool id → owning plugin and declared effect, from the contribution registry's current snapshots. @complexity O(t). */
function ownersById({ contributions, toolIdFor }: { contributions: AgentPluginExecutableContributionRegistry; toolIdFor: (required: { pluginId: string; name: string }) => string }): Map<string, ToolOwner> {
  const owners = new Map<string, ToolOwner>();
  for (const snapshot of contributions.list({})) {
    for (const tool of snapshot.tools) owners.set(toolIdFor({ pluginId: snapshot.pluginId, name: tool.name }), { pluginId: snapshot.pluginId, effect: tool.effect ?? 'destructive' });
  }
  return owners;
}

/**
 * Loads this workspace's executable Agent Plugin tools and keeps them registered on `registry`.
 * @param required.registry - The core ToolRegistry the assistant executes from (a registration scope needs it).
 * @param required.workspaceId - The workspace whose plugins, activation and connections apply.
 * @param required.host - Loader, connection accessor, guarded HTTP, limiter and optional artifact writer.
 * @param required.isActive - Fresh activation read for one plugin; must deny on any fault.
 * @param required.authorize - The workspace RBAC evaluator; callers need `required.toolPermission`.
 * @param required.toolPermission - The host's RBAC permission a principal needs to run any plugin tool.
 * @param required.applyApproval - The approval owner, applied to write and destructive tools.
 * @returns Refusal lines, `refresh` to reload the active set, and `dispose` to remove every tool.
 * @complexity O(t) tools plus one contained import per tool module (cached by Node).
 */
export async function registerAgentPluginExecutableTools<Registry extends AgentPluginExecutableContributionRegistry>(
  required: AgentPluginExecutableRegistrationRequired<Registry>,
  _optional: Record<string, never> = {},
): Promise<{ readonly refusals: readonly string[]; refresh(): Promise<{ readonly refusals: readonly string[] }>; dispose(): void }> {
  const { registry, workspaceId, host, withExtensionApprovalPolicy } = required;
  const { definition: toolContribution, toolIdFor: pluginToolIdFor } = required.contributions;
  const frozen = host.frozen ?? createFrozenConnectionAccounts();
  const capabilities = createAgentPluginToolCapabilities({ connections: host.connections, http: host.http, limiter: host.limiter, frozen, state: host.state, apiOrigins: host.apiOrigins }, host.artifacts ? { artifacts: host.artifacts } : {});
  const contributions = required.contributions.createRegistry({});
  const projection = createAgentPluginToolProjection({ registry: contributions, toolIdFor: pluginToolIdFor, capabilities, issuedTokens: host.issuedTokens });
  const disclose = createAgentPluginDisclosure({ source: projection, connections: host.connections, frozen, messages: required.disclosureMessages });
  const authorize = adaptLegacyAuthorize({ authorize: required.authorize });
  /** One fresh trust/activation load. Each generation's closures retain its own declaration. */
  async function loadTools() {
    const load = await host.loadContributions({ workspaceId, definition: toolContribution }, { orderByPluginId: true });
    const additionalTools = host.adminSurfaces ? await host.adminSurfaces.loadActionTools({ workspaceId, authorize, connectionKey: required.connectionKey }) : [];
    return { loaded: load.items, refusals: load.refusals, additionalTools };
  }
  const initial = await loadTools();
  let adminToolIds = new Set(initial.additionalTools.map(entry => pluginToolIdFor({ pluginId: entry.pluginId, name: entry.tool.name })));
  const { refusals } = projection.sync(initial);

  const ports = {
    contributions, isEnabled: required.isActive,
    resolveAuth: async ({ pluginId, principalId }: { pluginId: string; principalId: string }) => {
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: required.authorize }), workspaceId, principalId, permission: required.toolPermission }, { entityType: 'plugin', entityId: pluginId });
      return { access: 'admin' as const, principalId, workspaceId };
    },
    metadata: { approval: required.readApproval },
  };
  const adapt = (registration: ToolRegistration, owner: ToolOwner): ToolRegistration => {
    const toolId = registration.descriptor.id;
    // The contract asks the executor to confirm; the host's executor has no transport for that and would
    // park forever, so the approval owner's card below confirms instead (never less friction).
    const { requiresConfirmation: _parked, timeoutMs, ...descriptor } = registration.descriptor;
    const asks = owner.effect !== 'read';
    const gated = adminToolIds.has(toolId) ? { ...registration, policy: { ...registration.policy, authorize: async (ctx: ToolAuthorizationContext) => {
      if (await registration.policy.authorize(ctx) !== 'allow') return 'deny' as const;
      try {
        await requireToolPermission({ authorize, workspaceId, principalId: ctx.principal.id, permission: host.adminSurfaces!.permission });
        return 'allow' as const;
      } catch { return 'deny' as const; }
    } } } : registration;
    const nonDestructiveEffect = asks ? 'mutates-durable-state' : 'none';
    const sideEffects = owner.effect === 'destructive' ? 'deletes-durable-state' : nonDestructiveEffect;
    const classified = withExtensionApprovalPolicy({ registration: { ...gated, descriptor: { ...descriptor, readOnly: !asks, sideEffects, ...(asks ? {} : { timeoutMs }) } }, family: APPROVAL_FAMILY_BY_EFFECT[owner.effect] });
    // An admin action may be the one that signs a connection in, so its unconnected ones are left unbound.
    const skipUnconnected = adminToolIds.has(toolId);
    return asks ? required.applyApproval({ registration: classified }, { disclose: ({ ctx }) => disclose({ ctx, toolId, pluginId: owner.pluginId, workspaceId }, { skipUnconnected }) }) : classified;
  };
  const scope = createToolRegistrationScope({ registry });
  const refresh = () => {
    const owners = ownersById({ contributions, toolIdFor: pluginToolIdFor });
    scope.replace({ registrations: required.contributions.buildRegistrations(ports).map((registration) => {
      const owner = owners.get(registration.descriptor.id);
      // Both come from the same snapshots; refusing beats registering a tool with no approval family.
      if (!owner) throw new Error(`agent plugin tool '${registration.descriptor.id}' has no owning plugin, so its approval could not be classified`);
      return adapt(registration, owner);
    }) });
  };
  refresh();
  const unsubscribe = contributions.subscribe({ onChanged: refresh });
  let disposed = false;
  // One refresh at a time: an older load that finishes late would otherwise re-register the tools of
  // a plugin a newer load already saw disabled.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    refusals,
    refresh() {
      const run = queue.then(async () => {
        const next = await loadTools();
        if (disposed) throw new Error('Plugin tool registration was disposed.');
        adminToolIds = new Set(next.additionalTools.map(entry => pluginToolIdFor({ pluginId: entry.pluginId, name: entry.tool.name })));
        return projection.sync(next);
      });
      queue = run.catch(() => undefined);
      return run;
    },
    dispose() { disposed = true; unsubscribe(); scope.replace({ registrations: [] }); },
  };
}

