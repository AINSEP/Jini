/**
 * @file Plugin-contributed search providers (subpath `@jini-ai/search/contribution`, node).
 *
 * A plugin ships a manifest at its package root naming plain-JS provider modules:
 *
 * ```json
 * { "schemaVersion": 1, "providers": [{ "id": "meilisearch", "label": "Meilisearch", "module": "dist/provider.mjs" }] }
 * ```
 *
 * The host loads it through the one executable loader (activation, bundled digest, contained path)
 * and offers the results to its registry:
 *
 * ```ts
 * const definition = defineSearchProviderContribution({
 *   filename: 'host-search-providers.json',
 *   define: spec => defineProviderContribution(spec, { onReadError }), // agent-plugins' loader, host-bound
 * });
 * const loaded = await loader.loadPluginContributions({ workspaceId, definition });
 * const { accepted, refusals } = contributeProviders({ registry, loaded }); // agent-plugins' function
 * ```
 *
 * Every fault (bad JSON, bad entry, duplicate id, bad export, restricted vendor, id mismatch) is a
 * refusal string, never a throw: a broken plugin must not crash boot.
 */
import { SEARCH_CONTRACT, type SearchProvider } from './contract.js';
import { validateSearchProvider } from './registry.js';

export const SEARCH_PROVIDER_MANIFEST_SCHEMA_VERSION = 1;

/** One manifest entry: the provider id, its label and the plain-JS module that exports it. */
export interface SearchProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly module: string;
}

/** The parse result agent-plugins' loader expects: the entries, or why the manifest is refused. */
export type SearchManifestParseResult =
  | { readonly ok: true; readonly descriptors: readonly SearchProviderDescriptor[] }
  | { readonly ok: false; readonly reason: string };

type Shape = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Shape => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Relative, forward-looking `.mjs` path; on-disk containment is still enforced by the loader at import. */
const isRelativeModule = (value: string): boolean => value.endsWith('.mjs') && !/^([/\\]|[A-Za-z]:)/.test(value);

/** One manifest entry, or why it is invalid. Unknown keys are ignored (only these three are kept). */
function parseEntry(entry: unknown, index: number): SearchProviderDescriptor | string {
  if (!isRecord(entry)) return `providers[${index}] must be an object`;
  const { id, label, module } = entry;
  if (typeof id !== 'string') return `providers[${index}].id must be a string`;
  if (typeof label !== 'string' || label.trim() === '') return `providers[${index}].label must be a non-empty string`;
  if (typeof module !== 'string' || !isRelativeModule(module)) return `providers[${index}].module must be a relative .mjs path`;
  return { id, label, module };
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return undefined; }
}

/**
 * Parse a search provider manifest. The id grammar is checked later, per entry, before its module
 * is imported (so one bad id refuses one provider, not the whole manifest).
 * @complexity O(entries).
 */
export function parseSearchProviderManifest(required: { readonly raw: string }, _optional: Record<string, never> = {}): SearchManifestParseResult {
  const manifest = parseJson(required.raw);
  if (!isRecord(manifest)) return { ok: false, reason: 'it must be a JSON object' };
  if (manifest.schemaVersion !== SEARCH_PROVIDER_MANIFEST_SCHEMA_VERSION) return { ok: false, reason: `schemaVersion must be ${SEARCH_PROVIDER_MANIFEST_SCHEMA_VERSION}` };
  if (!Array.isArray(manifest.providers)) return { ok: false, reason: 'providers must be an array' };
  const descriptors: SearchProviderDescriptor[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of manifest.providers.entries()) {
    const parsed = parseEntry(entry, index);
    if (typeof parsed === 'string') return { ok: false, reason: parsed };
    if (seen.has(parsed.id)) return { ok: false, reason: `provider id '${parsed.id}' is declared twice` };
    seen.add(parsed.id);
    descriptors.push(parsed);
  }
  return { ok: true, descriptors };
}

/**
 * The module's default export as a search provider, or why not.
 *
 * Why vendors may not declare `acceptsRestricted`: a plugin provider sends documents to a third
 * party the site owner does not operate, and audience filtering there would rest on that vendor's
 * filter semantics and key handling. Restricted (members-only, audience-limited) content therefore
 * only ever lives in the host's own built-in provider, which is registered by the composition root
 * as a core provider and never through this path. Refusing the flag here keeps the indexer's
 * public-only routing honest: a plugin cannot opt itself into receiving restricted documents.
 */
export function validateContributedSearchProvider(required: { readonly exported: unknown }, _optional: Record<string, never> = {}): SearchProvider | string {
  const reason = validateSearchProvider({ provider: required.exported });
  if (reason !== undefined) return `its module's default export is not a search provider: ${reason}`;
  const provider = required.exported as SearchProvider;
  if (provider.capabilities.acceptsRestricted) return 'a plugin provider must not accept restricted content (only the built-in provider may)';
  return provider;
}

/** What search hands the host's contribution machinery (agent-plugins' `defineProviderContribution`). */
export interface SearchContributionSpec {
  readonly contract: string;
  readonly filename: string;
  readonly parse: typeof parseSearchProviderManifest;
  readonly validate: typeof validateContributedSearchProvider;
}

/** What the wrapper touches of the definition the host builds: the loader's `load`, and nothing else. */
export type SearchContributionLoaded = { readonly definition: { readonly provider: { readonly id: string } } } | string;
export interface SearchContributionBase {
  load(input: { readonly descriptor: { readonly id: string }; readonly plugin: { readonly pluginId: string } }): SearchContributionLoaded | Promise<SearchContributionLoaded>;
}

/**
 * Define the search provider contribution for a host-chosen manifest filename.
 * Search keeps its parser, its restricted-content refusal and the manifest-id check; the host
 * supplies only the loader: `define` is agent-plugins' `defineProviderContribution`, with the host's
 * read/import recovery policy bound inside it.
 * @param required.filename - The manifest file a plugin ships at its package root.
 * @param required.define - Builds the executable contribution from {@link SearchContributionSpec}.
 * @returns A definition for `loadPluginContributions`; its items go to agent-plugins' `contributeProviders`.
 * @complexity O(1); each load is one contained import per declared provider.
 */
export function defineSearchProviderContribution<Base extends SearchContributionBase>(
  required: { readonly filename: string; readonly define: (spec: SearchContributionSpec) => Base },
  _optional: Record<string, never> = {},
): Base {
  const base = required.define({
    contract: SEARCH_CONTRACT, filename: required.filename,
    parse: parseSearchProviderManifest, validate: validateContributedSearchProvider,
  });
  return {
    ...base,
    load: async (input: Parameters<Base['load']>[0]) => {
      const loaded = await base.load(input);
      if (typeof loaded === 'string') return loaded;
      const { descriptor, plugin } = input;
      const providerId = loaded.definition.provider.id;
      // The registry keys by the manifest id while services and settings name the provider by its
      // own id; a mismatch would make one provider answer under two names.
      if (providerId === descriptor.id) return loaded;
      return `${SEARCH_CONTRACT} provider '${descriptor.id}' from '${plugin.pluginId}' was not loaded: its module's provider id '${providerId}' differs from the manifest id`;
    },
  };
}
