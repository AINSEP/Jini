/**
 * @file Plugin-contributed providers for `@jini-ai/core`'s `createProviderRegistry` (FROZEN CONTRACT,
 * 2026-10-21). Lives here rather than in core because core cannot import agent-plugins (agent-plugins
 * already depends on core). Defined on the one executable loader (`defineExecutablePluginContribution`)
 * so a provider module passes the same gates as every other seam that runs plugin code: active
 * plugin, bundled digest, contained `.mjs` path. No second loader.
 *
 * Every failure is a refusal line, never a throw: a broken or duplicate plugin provider must not
 * crash boot (core/built-in registrations keep the registry's throwing policy).
 */
import { PROVIDER_ID_PATTERN, type ProviderDefinition, type ProviderRegistry } from '@jini-ai/core/provider-registry';
import {
  defineExecutablePluginContribution, type PluginContributionDefinition, type PluginContributionResult,
} from './contribution-loader.js';

/** The minimum a provider manifest entry declares; a seam's parser may add fields. */
export interface ProviderContributionDescriptor {
  readonly id: string;
  /** Plain-JS module inside the plugin root (`.mjs`); containment is checked on disk at import. */
  readonly module: string;
  readonly label?: string;
}

export interface LoadedProviderContribution<T> {
  readonly contract: string;
  readonly pluginId: string;
  readonly definition: ProviderDefinition<T>;
}

/**
 * Defines the contribution of providers for one contract (e.g. `mail`) from a host-chosen file.
 * The id is checked before the module is imported, so a malformed entry never runs code.
 * @param required.contract - Must equal the target registry's `contract`.
 * @param required.filename - The file a plugin ships at its package root to contribute providers.
 * @param required.parse - The seam's manifest parser.
 * @param required.validate - The module export as a provider of this contract, or why not.
 * @param optional - The loader's read/import recovery policy. Unlike the bare executable loader, absent
 *   policies default to refusal lines (`could not be read`, `its module failed to load`) instead of
 *   propagating the fault, so one unreadable manifest or throwing module never discards the healthy
 *   contributions loaded alongside it. Pass `onReadError: () => []` to tolerate a missing manifest.
 * @returns A definition for `loadPluginContributions`; executable, so activation is always required.
 * @complexity O(1); each load is one contained import per declared provider.
 */
export function defineProviderContribution<D extends ProviderContributionDescriptor, T>(
  required: {
    readonly contract: string;
    readonly filename: string;
    readonly parse: PluginContributionDefinition<D, LoadedProviderContribution<T>>['parse'];
    readonly validate: (required: { readonly exported: unknown }) => T | string;
  },
  optional: {
    readonly onReadError?: PluginContributionDefinition<D, LoadedProviderContribution<T>>['onReadError'];
    readonly importRefusalReason?: string;
    readonly importErrorReason?: string;
  } = {},
): PluginContributionDefinition<D, LoadedProviderContribution<T>> {
  const { contract } = required;
  const refusal = ({ plugin, descriptor, reason }: { readonly plugin: { readonly pluginId: string }; readonly descriptor: D; readonly reason: string }) =>
    `${contract} provider '${String(descriptor.id)}' from '${plugin.pluginId}' was not loaded: ${reason}`;
  const { filename } = required;
  const executable = defineExecutablePluginContribution<D, T>({
    filename, contribution: `${contract} providers`, parse: guardedParse({ parse: required.parse }),
    modulePath: ({ descriptor }) => descriptor.module, validate: required.validate, refusal,
  }, {
    onReadError: optional.onReadError ?? (({ plugin }) => [`${contract} providers from '${plugin.pluginId}' were not loaded: ${filename} could not be read`]),
    importErrorReason: optional.importErrorReason ?? 'its module failed to load',
    ...(optional.importRefusalReason === undefined ? {} : { importRefusalReason: optional.importRefusalReason }),
  });
  const loadOne: typeof executable.load = async (input) => {
    const { plugin, descriptor } = input;
    if (typeof descriptor.id !== 'string' || !PROVIDER_ID_PATTERN.test(descriptor.id)) {
      return refusal({ plugin, descriptor, reason: `its id must match ${PROVIDER_ID_PATTERN.source}` });
    }
    const loaded = await executable.load(input);
    if (typeof loaded === 'string') return loaded;
    const { id, label } = descriptor;
    return { contract, pluginId: loaded.pluginId, definition: { id, provider: loaded.module, ...(label === undefined ? {} : { label }) } };
  };
  return {
    ...executable,
    // Per-descriptor boundary: a hostile descriptor (e.g. a throwing getter) becomes one refusal and
    // the loader moves on to the next declaration.
    load: async (input) => {
      try { return await loadOne(input); }
      catch { return `${contract} provider from '${input.plugin.pluginId}' was not loaded: its declaration could not be read`; }
    },
  };
}

/** A throwing seam parser is a refused manifest, not a boot fault. */
function guardedParse<D>(
  required: { readonly parse: (input: { readonly raw: string }) => ReturnType<PluginContributionDefinition<D, unknown>['parse']> },
  _optional: Record<string, never> = {},
): PluginContributionDefinition<D, unknown>['parse'] {
  return (input) => {
    try { return required.parse(input); }
    catch { return { ok: false, reason: 'its parser failed' }; }
  };
}

/**
 * Offer loaded plugin providers to a registry and merge every refusal into one host-facing list:
 * the loader's (gate, manifest, import, validation) first, then the registry's (contract mismatch,
 * duplicate, invalid provider) in contribution order.
 * @returns The ids the registry accepted and every refusal line; never throws.
 * @complexity O(n) contributions.
 */
export function contributeProviders<T>(
  required: { readonly registry: ProviderRegistry<T>; readonly loaded: PluginContributionResult<LoadedProviderContribution<T>> },
  _optional: Record<string, never> = {},
): { readonly accepted: readonly string[]; readonly refusals: readonly string[] } {
  const { registry, loaded } = required;
  const before = registry.refusals().length;
  const accepted: string[] = [];
  for (const item of loaded.items) {
    if (registry.contribute({ definition: item.definition, pluginId: item.pluginId, contract: item.contract })) accepted.push(item.definition.id);
  }
  const registryRefusals = registry.refusals().slice(before).map(refusal => refusal.message);
  return { accepted, refusals: [...loaded.refusals, ...registryRefusals] };
}
