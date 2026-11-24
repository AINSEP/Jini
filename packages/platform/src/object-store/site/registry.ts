import { readFileSync } from "node:fs";
import path from "node:path";

import { createObjectStoreRegistry, OBJECT_STORE_CONTRACT, objectStoreProviderFault, type ObjectStoreProvider } from "@jini-ai/core/object-store";
import type { ProviderDefinition, ProviderRegistry } from "@jini-ai/core/provider-registry";

import { parseObjectStoresFile as parseObjectStoreDescriptors, type ObjectStoreDescriptor, type ObjectStoreEnvDeclaration, type ObjectStoresParseResult } from "../descriptors.js";
import { createLocalFsObjectStoreProvider } from "../local-fs.js";

/**
 * @file The site's object-store providers: the built-in `local` filesystem provider (the registry
 * default) plus every provider a trusted Agent Plugin contributes through
 * {@link OBJECT_STORES_FILENAME} — today the bundled s3-compatible plugin's `s3_compatible`.
 *
 * Plugin providers load through Jini's `defineProviderContribution`, so a provider module passes the
 * same gates as every executable seam (active plugin, bundled digest, contained `.mjs`); a bad one is
 * a refusal line, never a boot crash. Core owns the generic contract (`@jini-ai/core/object-store`);
 * this module is the generic site loader.
 *
 * ## Wiring
 * Generic over the host object `Host` a provider's `create()` receives and over the contribution
 * `Definition` the host's plugin loader accepts. The agent-plugins contribution seam
 * (`defineProviderContribution`, `contributeProviders`) and the host's plugin loaders
 * (`loadContributions`, `bundledContributionSources`, `loadPluginContributionsFromSource`) arrive
 * on each function's required args, bound by the host's composition root.
 */

/** The file a plugin ships at its root to contribute object-store providers: `{ schemaVersion: 1, providers: [{ id, module, label? }] }`,
 * parsed by `@jini-ai/platform/object-store`; ids are checked against the shared grammar before any module is imported. */
export const OBJECT_STORES_FILENAME = "jini-object-stores.json";

/** A provider whose `create()` receives the host object `Host` (signing, optional request tracing). */
export type SiteObjectStoreProvider<Host> = ObjectStoreProvider<Host>;

export interface LoadedObjectStoreRegistry<Host> {
  readonly registry: ProviderRegistry<SiteObjectStoreProvider<Host>>;
  /** Log-safe, one line per provider that was not loaded and why. */
  readonly refusals: readonly string[];
}

/** One plugin's loaded provider, as the host's contribution loader returns it. */
export interface LoadedObjectStoreContribution<Host> { readonly contract: string; readonly pluginId: string; readonly definition: ProviderDefinition<SiteObjectStoreProvider<Host>> }
export interface LoadedObjectStoreContributions<Host> { readonly items: readonly LoadedObjectStoreContribution<Host>[]; readonly refusals: readonly string[] }
/** A trusted bundled plugin package: whose it is and where its files live. */
export interface ObjectStoreSourcePlugin { readonly pluginId: string; readonly packageRoot: string }

/** The spec handed to the injected `defineProviderContribution` (agent-plugins' shared seam). */
export interface ObjectStoreContributionSpec<Host> {
  readonly contract: string;
  readonly filename: string;
  readonly parse: (input: { readonly raw: string }) => ObjectStoresParseResult;
  readonly validate: (input: { readonly exported: unknown }) => SiteObjectStoreProvider<Host> | string;
}

/** The agent-plugins contribution seam, bound by the host. */
export interface ObjectStoreContributionPorts<Host, Definition> {
  readonly defineProviderContribution: (spec: ObjectStoreContributionSpec<Host>) => Definition;
  readonly contributeProviders: (required: { readonly registry: ProviderRegistry<SiteObjectStoreProvider<Host>>; readonly loaded: LoadedObjectStoreContributions<Host> }) => { readonly refusals: readonly string[] };
}

/** The host's bundled-source enumerator (trusted, immutable product sources only). */
export type BundledObjectStoreSources = (required: { readonly sourceRoot: string; readonly filename: string }) => readonly ObjectStoreSourcePlugin[];

/** The shared contribution definition for {@link OBJECT_STORES_FILENAME}. @complexity O(1). */
function objectStoreContribution<Host, Definition>(required: Pick<ObjectStoreContributionPorts<Host, Definition>, "defineProviderContribution">, _optional: Record<string, never> = {}): Definition {
  return required.defineProviderContribution({
    contract: OBJECT_STORE_CONTRACT, filename: OBJECT_STORES_FILENAME,
    parse: ({ raw }) => parseObjectStoreDescriptors({ raw }),
    validate: ({ exported }) => objectStoreProviderFault({ provider: exported }) ?? exported as SiteObjectStoreProvider<Host>,
  });
}

/**
 * A registry seeded with `local` (rooted at the site's uploads folder), without plugin providers.
 * @complexity O(1).
 */
function seededRegistry<Host>(required: { readonly uploadsDir: string }): ProviderRegistry<SiteObjectStoreProvider<Host>> {
  return createObjectStoreRegistry<Host>({}, { seed: [{ id: "local", label: "This server's disk", provider: createLocalFsObjectStoreProvider({ rootDir: required.uploadsDir }) }] });
}

/**
 * This workspace's providers from its installed, activated Agent Plugins. Read fresh per call.
 * @complexity O(p) installed plugins, one import per declared provider.
 */
export async function loadObjectStoreRegistry<Host, Definition>(
  required: ObjectStoreContributionPorts<Host, Definition> & {
    readonly workspaceId: string;
    readonly uploadsDir: string;
    readonly loadContributions: (input: { readonly workspaceId: string; readonly definition: Definition }, optional: { readonly orderByPluginId: boolean }) => Promise<LoadedObjectStoreContributions<Host>>;
  },
  _optional: Record<string, never> = {}
): Promise<LoadedObjectStoreRegistry<Host>> {
  const registry = seededRegistry<Host>(required);
  const loaded = await required.loadContributions({ workspaceId: required.workspaceId, definition: objectStoreContribution(required) }, { orderByPluginId: true });
  return { registry, refusals: required.contributeProviders({ registry, loaded }).refusals };
}

/**
 * Providers read straight from this product's own bundled plugin SOURCE, with no
 * install/activation gate — for the operator env override, which must not depend on a plugin being
 * switched on. Never point `sourceRoot` at anything an operator or third party can write.
 * @complexity O(t) bundled providers, one import each.
 */
export async function loadBundledObjectStoreRegistry<Host, Definition>(
  required: ObjectStoreContributionPorts<Host, Definition> & {
    readonly uploadsDir: string;
    readonly sourceRoot: string;
    readonly bundledContributionSources: BundledObjectStoreSources;
    readonly loadPluginContributionsFromSource: (input: { readonly plugin: ObjectStoreSourcePlugin; readonly definition: Definition }) => Promise<LoadedObjectStoreContributions<Host>>;
  },
  _optional: Record<string, never> = {}
): Promise<LoadedObjectStoreRegistry<Host>> {
  const registry = seededRegistry<Host>(required);
  const definition = objectStoreContribution(required);
  const refusals: string[] = [];
  for (const plugin of required.bundledContributionSources({ sourceRoot: required.sourceRoot, filename: OBJECT_STORES_FILENAME })) {
    const loaded = await required.loadPluginContributionsFromSource({ plugin, definition });
    refusals.push(...required.contributeProviders({ registry, loaded }).refusals);
  }
  return { registry, refusals };
}

/** Synchronous media env mappings from immutable bundled sources; never imports provider modules.
 * @param required Product-owned source root and the host's bundled-source enumerator. @returns Mappings in declaration order.
 * @throws {Error} Unreadable/invalid data or duplicate selectors; an opt-in never silently becomes local. */
export function readBundledObjectStoreEnvDeclarations(required: { readonly sourceRoot: string; readonly bundledContributionSources: BundledObjectStoreSources }, _optional = {}): readonly ObjectStoreEnvDeclaration[] {
  const entries: ObjectStoreEnvDeclaration[] = [];
  for (const plugin of required.bundledContributionSources({ sourceRoot: required.sourceRoot, filename: OBJECT_STORES_FILENAME })) {
    const parsed = parseObjectStoreDescriptors({ raw: readFileSync(path.join(plugin.packageRoot, OBJECT_STORES_FILENAME), "utf8") });
    if (!parsed.ok) throw new Error(`Object store env declarations from '${plugin.pluginId}' were not loaded: ${parsed.reason}`);
    appendDeclaredEnvironments({ descriptors: parsed.descriptors, entries });
  }
  const selectors = new Set<string>();
  for (const entry of entries) {
    if (selectors.has(entry.selector)) throw new Error(`Object store env selector '${entry.selector}' is declared twice.`);
    selectors.add(entry.selector);
  }
  return entries;
}

function appendDeclaredEnvironments({ descriptors, entries }: { descriptors: readonly ObjectStoreDescriptor[]; entries: ObjectStoreEnvDeclaration[] }, _options = {}): void {
  for (const descriptor of descriptors) {
    if (descriptor.env) entries.push({ ...descriptor.env, providerId: descriptor.id });
  }
}
