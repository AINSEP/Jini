/** Projects executable plugins onto the host's existing ToolRegistry. Metadata/auth are host
 * ports; no separate catalog, executor, permission vocabulary, or approval engine is created. */
import { createToolRegistrationScope, requireInputRecord, ToolInputError, type ToolRegistry, type ToolRegistration, type ToolMetadata } from '@jini-ai/core';
import { pluginToolIdFor, type PluginContributionRegistry, type PluginAuthContext } from './contributions.js';
export interface PluginToolContributionPorts {
  readonly contributions: PluginContributionRegistry;
  readonly isEnabled: (required: { pluginId: string }, optional?: Record<string, never>) => Promise<boolean>;
  readonly resolveAuth: (required: { pluginId: string; principalId: string }, optional?: Record<string, never>) => Promise<PluginAuthContext | null>;
  readonly metadata: ToolMetadata;
}
/** Generation + durable activation are checked before authorization and after confirmation.
 * Arbitrary tier-3 handlers cannot establish read-only safety; the host supplies approval policy. */
export function buildPluginContributionToolRegistrations(required: PluginToolContributionPorts, _optional: Record<string, never> = {}): ToolRegistration[] {
  const { contributions } = required;
  return contributions.list({}).flatMap(snapshot => snapshot.tools.map(tool => {
    const active = async () => await required.isEnabled({ pluginId: snapshot.pluginId }) && contributions.list({}).includes(snapshot);
    return {
      descriptor: {
        id: pluginToolIdFor({ pluginId: snapshot.pluginId, name: tool.name }), description: tool.description,
        inputSchema: tool.inputSchema, readOnly: false, requiresConfirmation: required.metadata.approval?.confirmation !== 'direct',
        timeoutMs: 30000, maxOutputBytes: 65536, metadata: required.metadata,
      },
      policy: { authorize: async ctx => {
        if (!await active()) return 'deny';
        const auth = await required.resolveAuth({ pluginId: snapshot.pluginId, principalId: ctx.principal.id });
        return auth && await active() ? 'allow' : 'deny';
      } },
      handler: async ctx => {
        const auth = await required.resolveAuth({ pluginId: snapshot.pluginId, principalId: ctx.principal.id });
        if (!auth || !await active()) throw new ToolInputError({ message: 'Plugin tool is disabled or was reloaded.' });
        const input = requireInputRecord({ input: ctx.input });
        return tool.handler({ pluginId: snapshot.pluginId, sdk: snapshot.sdk, auth, input, signal: ctx.signal }, {});
      },
    } satisfies ToolRegistration;
  }));
}
/** Host lifecycle attaches one revocable scope to its existing registry. Disposal removes only
 * this scope's tools and subscription. A failed replacement leaves the previous generation. */
export function attachPluginContributionTools(required: PluginToolContributionPorts & { registry: ToolRegistry }, _optional: Record<string, never> = {}) {
  const scope = createToolRegistrationScope({ registry: required.registry });
  const refresh = () => scope.replace({ registrations: buildPluginContributionToolRegistrations(required) });
  refresh();
  const unsubscribe = required.contributions.subscribe({ onChanged: refresh });
  return { dispose(_required: Record<string, never>, _optional: Record<string, never> = {}) { unsubscribe(); scope.replace({ registrations: [] }); } };
}
