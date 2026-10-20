/**
 * @file The executable tool contribution, defined on the lifecycle's one executable loader
 * (`defineExecutablePluginContribution`) so tool modules pass the same gates as every other seam
 * that runs plugin code: active plugin, bundled digest, contained `.mjs` path. No second loader.
 * The filename is the host's: Jini never names a product's contribution file.
 */
import { defineExecutablePluginContribution, type LoadedPluginContribution, type PluginContributionDefinition } from '../contribution-loader.js';
import type { AgentPluginToolCapabilities } from './capabilities.js';
import { parseAgentPluginToolsFile, type AgentPluginToolDescriptor } from './manifest.js';

/** What a tool module's default export must be. `input` has already passed the declared schema. */
export interface AgentPluginToolModule {
  readonly invoke: (
    required: { readonly input: Readonly<Record<string, unknown>>; readonly capabilities: AgentPluginToolCapabilities; readonly signal?: AbortSignal },
    optional?: Record<string, never>,
  ) => unknown;
  /** Human-readable resources the call would change, shown before confirmation. Required unless `read`. */
  readonly describeAffectedResources?: (required: { readonly input: Readonly<Record<string, unknown>> }, optional?: Record<string, never>) => unknown;
}

export type LoadedAgentPluginTool = LoadedPluginContribution<AgentPluginToolDescriptor, AgentPluginToolModule>;

/** The module's export as a tool module, or why not. Shape only; effect rules apply at projection. @complexity O(1). */
function validateToolModule({ exported }: { readonly exported: unknown }): AgentPluginToolModule | string {
  if (typeof exported !== 'object' || exported === null) return "its module's default export is not an object";
  const candidate = exported as Partial<Record<keyof AgentPluginToolModule, unknown>>;
  if (typeof candidate.invoke !== 'function') return "its module's default export has no invoke()";
  if (candidate.describeAffectedResources !== undefined && typeof candidate.describeAffectedResources !== 'function') return 'describeAffectedResources must be a function';
  return exported as AgentPluginToolModule;
}

/**
 * Defines the tool contribution for a host-chosen filename (e.g. `<product>-agent-tools.json`).
 * @param required.filename - The file a plugin ships at its package root to contribute tools.
 * @returns A definition for `loadPluginContributions`; executable, so activation is always required.
 * @complexity O(1); each load is one contained import per declared tool (Node caches per file URL).
 */
export function defineAgentPluginToolContribution(
  required: { readonly filename: string },
  _optional: Record<string, never> = {},
): PluginContributionDefinition<AgentPluginToolDescriptor, LoadedAgentPluginTool> {
  return defineExecutablePluginContribution<AgentPluginToolDescriptor, AgentPluginToolModule>({
    filename: required.filename, contribution: 'agent tools',
    parse: parseAgentPluginToolsFile, modulePath: ({ descriptor }) => descriptor.module, validate: validateToolModule,
    refusal: ({ plugin, descriptor, reason }) => `agent tool '${descriptor.name}' from '${plugin.pluginId}' was not loaded: ${reason}`,
  });
}
