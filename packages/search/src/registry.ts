/**
 * @file The search provider registry: core's shared `createProviderRegistry` bound to the search
 * contract, plus the one shape check every search provider (built-in, plugin, reference) passes.
 *
 * Registration policy is core's: a malformed or duplicate built-in throws at boot, a malformed or
 * duplicate plugin contribution becomes a refusal line. This file only adds what is specific to
 * search: what a well-formed {@link SearchProvider} looks like at runtime.
 */
import {
  createProviderRegistry, PROVIDER_ID_PATTERN, type ProviderDefinition, type ProviderRegistry,
} from '@jini-ai/core/provider-registry';
import { BUILTIN_SEARCH_PROVIDER_ID, SEARCH_CONTRACT, type SearchProvider } from './contract.js';

export type SearchProviderRegistry = ProviderRegistry<SearchProvider>;

const CAPABILITY_FLAGS = ['acceptsRestricted', 'typoTolerance', 'asyncIndexing'] as const;
const METHODS = ['ensureIndex', 'dropIndex', 'upsert', 'remove', 'query', 'revisionOf'] as const;

type Shape = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Shape => typeof value === 'object' && value !== null;
const isStringArray = (value: unknown): boolean => Array.isArray(value) && value.every(item => typeof item === 'string');

function identityFault(provider: Shape): string | undefined {
  if (typeof provider.id !== 'string' || !PROVIDER_ID_PATTERN.test(provider.id)) return `id must be a string matching ${PROVIDER_ID_PATTERN.source}`;
  if (typeof provider.label !== 'string' || provider.label.trim() === '') return 'label must be a non-empty string';
  if (!isStringArray(provider.credentialKeys)) return 'credentialKeys must be an array of strings';
  return undefined;
}

function capabilitiesFault(capabilities: unknown): string | undefined {
  if (!isRecord(capabilities)) return 'capabilities must be an object';
  const flag = CAPABILITY_FLAGS.find(name => typeof capabilities[name] !== 'boolean');
  if (flag !== undefined) return `capabilities.${flag} must be a boolean`;
  const { maxBatch, locales } = capabilities;
  if (typeof maxBatch !== 'number' || !Number.isSafeInteger(maxBatch) || maxBatch < 1) return 'capabilities.maxBatch must be a positive integer';
  if (locales !== 'any' && !isStringArray(locales)) return "capabilities.locales must be 'any' or an array of strings";
  return undefined;
}

/**
 * `awaitTask` is required exactly when writes may answer `pending`; a synchronous provider may
 * still ship one, but it must then be a function (the indexer never calls it, a wrong type is a bug).
 */
function methodsFault(provider: Shape, asyncIndexing: boolean): string | undefined {
  const missing = METHODS.find(name => typeof provider[name] !== 'function');
  if (missing !== undefined) return `${missing} must be a function`;
  const awaitTask = provider.awaitTask;
  if (asyncIndexing && typeof awaitTask !== 'function') return 'awaitTask must be a function when capabilities.asyncIndexing is true';
  if (awaitTask !== undefined && typeof awaitTask !== 'function') return 'awaitTask must be a function when present';
  return undefined;
}

/**
 * Runtime shape check of a search provider (the registry's `validate`, and the plugin contribution's
 * export check). Never throws.
 * @param required.provider - Anything; typically a plugin module's default export.
 * @returns `undefined` when well-formed, otherwise the first reason it is not.
 * @complexity O(credentialKeys + locales).
 */
export function validateSearchProvider(required: { readonly provider: unknown }, _optional: Record<string, never> = {}): string | undefined {
  const { provider } = required;
  if (!isRecord(provider)) return 'a search provider must be an object';
  return identityFault(provider)
    ?? capabilitiesFault(provider.capabilities)
    // capabilitiesFault passed, so capabilities is a record with a boolean asyncIndexing.
    ?? methodsFault(provider, (provider.capabilities as Shape).asyncIndexing === true);
}

/**
 * Build the host's search provider registry.
 * @param optional.seed - Core (built-in) providers, registered with the throwing policy.
 * @param optional.defaultProviderId - Defaults to the owner's built-in provider id.
 * @throws {ProviderRegistryError} When a seed provider is malformed or duplicated.
 * @complexity O(seed) to build; lookups O(1).
 */
export function createSearchProviderRegistry(
  _required: Record<string, never> = {},
  optional: { readonly seed?: readonly ProviderDefinition<SearchProvider>[]; readonly defaultProviderId?: string } = {},
): SearchProviderRegistry {
  const { seed, defaultProviderId = BUILTIN_SEARCH_PROVIDER_ID } = optional;
  return createProviderRegistry<SearchProvider>({ contract: SEARCH_CONTRACT }, {
    defaultProviderId, validate: validateSearchProvider, ...(seed === undefined ? {} : { seed }),
  });
}
