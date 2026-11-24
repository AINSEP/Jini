import path from "node:path";

import type { ProviderDefinition, ProviderRegistry } from "@jini-ai/core/provider-registry";

/**
 * @file Builds this workspace's media-generation provider registry ONCE at composition: the built-in
 * vendors (`@jini-ai/integrations/media-providers`'s default contribution set) plus every vendor an
 * Agent Plugin contributes — the same seam the mail adapters use
 * (`features/agent-plugins/mail-adapter-registry.ts`), on the shared `defineProviderContribution`.
 *
 * A plugin opts in by shipping the host-named manifest file (`ports.filename`, injected) at its root: a data-only
 * `{ schemaVersion: 1, providers: [{ id, module, label? }] }`. `module` is a plain-JS `.mjs` inside the
 * plugin whose default export is one `MediaProviderContribution` — `{ provider, models, adapters }`.
 * `id` is the registry key (the public `provider.id` with `-` -> `_`), so a mismatch is refused.
 *
 * TRUST RULE (fail closed), identical to mail: a module runs in this process, so it loads only when the
 * plugin is ACTIVE, its digest is one the host shipped, and the module stays inside the plugin root. Every
 * drop — a bad manifest, a bad module, a duplicate vendor or model — is a refusal line, never a throw.
 * Plugin vendors get credentials the same way built-ins do (saved workspace credential, resolved per
 * call by the tool); the registry itself never holds a secret.
 */

/** Structural slice of one vendor module's default export (`{ provider, models, adapters }`). */
export interface MediaProviderContributionShape { readonly provider: { readonly id: string; readonly label: string } }
/** One declared vendor in the manifest: `{ id, module, label? }`. */
export interface MediaProviderContributionDescriptor { readonly id: string; readonly module: string; readonly label?: string }
export interface LoadedMediaProviderItem<C extends MediaProviderContributionShape = MediaProviderContributionShape> { readonly contract: string; readonly pluginId: string; readonly definition: ProviderDefinition<C> }
export interface LoadedMediaProviderItems<C extends MediaProviderContributionShape = MediaProviderContributionShape> { readonly items: readonly LoadedMediaProviderItem<C>[]; readonly refusals: readonly string[] }
export interface MediaProviderRegistrySlice<C extends MediaProviderContributionShape = MediaProviderContributionShape> { readonly providers: ProviderRegistry<C> }

type ParseResult = { readonly ok: true; readonly descriptors: readonly MediaProviderContributionDescriptor[] } | { readonly ok: false; readonly reason: string };

/** The contribution spec handed to the injected `defineProviderContribution` (agent-plugins' shared seam). */
export interface MediaProviderContributionSpec<C extends MediaProviderContributionShape = MediaProviderContributionShape> {
  readonly contract: string;
  readonly filename: string;
  readonly parse: (input: { readonly raw: string }) => ParseResult;
  readonly validate: (input: { readonly exported: unknown }) => C | string;
}
export interface MediaProviderContributionSpecOptional {
  readonly onReadError: (input: { readonly plugin: { readonly pluginId: string } }) => readonly string[];
  readonly importErrorReason: string;
}

/** Cross-package collaborators the host binds (agent-plugins contribution seam + integrations registry). */
export interface MediaProviderRegistryContributionPorts<C extends MediaProviderContributionShape = MediaProviderContributionShape> {
  readonly contributeProviders: (required: { readonly registry: ProviderRegistry<C>; readonly loaded: LoadedMediaProviderItems<C> }) => { readonly refusals: readonly string[] };
  readonly registryId: (required: { readonly id: string }) => string;
}

export interface LoadedMediaProviderRegistry<Registry> {
  readonly registry: Registry;
  /** Log-safe, one sentence per plugin or vendor that was NOT loaded, and why. */
  readonly refusals: readonly string[];
}

/**
 * Loads plugin vendors into a fresh built-in registry. Call once per composition root (boot awaits it).
 *
 * @throws Nothing: even a filesystem fault listing the plugin directory degrades to the built-in
 *   vendors plus one refusal line, because image generation must not take boot down with it.
 * @complexity O(p) installed plugins, one small read plus one import per declared vendor.
 */
export async function loadMediaProviderRegistry<Registry extends MediaProviderRegistrySlice<C>, C extends MediaProviderContributionShape, Definition>(
  ctx: { readonly workspaceId: string },
  required: MediaProviderRegistryContributionPorts<C> & {
    /** The product-named manifest file a plugin ships at its root (host-owned, K3). */
    readonly filename: string;
    readonly contract: string;
    readonly createRegistry: () => Registry;
    readonly defineProviderContribution: (spec: MediaProviderContributionSpec<C>, optional: MediaProviderContributionSpecOptional) => Definition;
    readonly loadContributions: (input: { readonly workspaceId: string; readonly definition: Definition }, optional: { readonly orderByPluginId: boolean }) => Promise<LoadedMediaProviderItems<C>>;
  },
): Promise<LoadedMediaProviderRegistry<Registry>> {
  const registry = required.createRegistry();
  let loaded: LoadedMediaProviderItems<C>;
  try {
    loaded = await required.loadContributions({ ...ctx, definition: mediaProviderContribution<C, Definition>(required) }, { orderByPluginId: true });
  } catch (error) {
    return { registry, refusals: [`plugin media providers were not loaded: ${(error as Error).message}`] };
  }
  const refusals = [...loaded.refusals];
  for (const item of loaded.items) refusals.push(...contributeOne({ registry, item, ports: required }));
  return { registry, refusals };
}

/** The shared executable-contribution definition for this manifest. @complexity O(1). */
function mediaProviderContribution<C extends MediaProviderContributionShape, Definition>(
  required: { readonly filename: string; readonly contract: string; readonly defineProviderContribution: (spec: MediaProviderContributionSpec<C>, optional: MediaProviderContributionSpecOptional) => Definition },
  _optional: Record<string, never> = {},
): Definition {
  const { filename } = required;
  return required.defineProviderContribution({
    contract: required.contract,
    filename,
    parse: ({ raw }) => parseMediaProvidersFile({ raw }),
    validate: ({ exported }) => asContribution<C>({ candidate: exported }),
  }, {
    // Per-plugin recovery: an unreadable manifest or a module/containment I/O fault costs only that
    // plugin's vendors. Without these the fault reaches loadMediaProviderRegistry's outer catch, which
    // drops every other plugin's otherwise valid vendors with it.
    onReadError: ({ plugin }) => [`media providers from '${plugin.pluginId}' were not loaded: ${filename} could not be read`],
    importErrorReason: "module could not be read or imported",
  });
}

/**
 * Offers one plugin's vendor to the registry. A throw anywhere in that (a hostile getter in its
 * module's data, a registry fault) is that vendor's refusal line, so later plugins still load.
 * @complexity O(m) in the vendor's model count plus the registered models.
 */
function contributeOne<C extends MediaProviderContributionShape>(
  { registry, item, ports }: { readonly registry: MediaProviderRegistrySlice<C>; readonly item: LoadedMediaProviderItem<C>; readonly ports: MediaProviderRegistryContributionPorts<C> },
  _optional: Record<string, never> = {},
): readonly string[] {
  try {
    const matching = keepMatchingIds([item], ports);
    return ports.contributeProviders({ registry: registry.providers, loaded: matching }).refusals;
  } catch {
    return [`media provider '${item.definition.id}' from '${item.pluginId}' was not loaded: its contribution could not be registered`];
  }
}

/** Drops items whose manifest id is not the registry key of the vendor they export. @complexity O(n). */
function keepMatchingIds<C extends MediaProviderContributionShape>(items: readonly LoadedMediaProviderItem<C>[], ports: Pick<MediaProviderRegistryContributionPorts<C>, "registryId">): { items: LoadedMediaProviderItem<C>[]; refusals: string[] } {
  const kept: LoadedMediaProviderItem<C>[] = [];
  const refusals: string[] = [];
  for (const item of items) {
    const expected = ports.registryId({ id: item.definition.provider.provider.id });
    if (expected === item.definition.id) kept.push({ ...item, definition: { ...item.definition, label: item.definition.label ?? item.definition.provider.provider.label } });
    else refusals.push(`media provider '${item.definition.id}' from '${item.pluginId}' was not loaded: its module exports provider '${item.definition.provider.provider.id}' (registry id '${expected}')`);
  }
  return { items: kept, refusals };
}

/** Light structural check after the contained import; the registry's own validate does the rest. @complexity O(1). */
function asContribution<C extends MediaProviderContributionShape>({ candidate }: { candidate: unknown }, _optional = {}): C | string {
  if (!isPlainObject(candidate) || !isPlainObject(candidate.provider) || typeof candidate.provider.id !== "string") return "its module must export { provider, models, adapters }";
  return candidate as unknown as C;
}

/**
 * Parses a plugin's media-providers manifest (the injected `filename`). Pure. Unknown keys are ignored; the id grammar is
 * checked by the shared contribution before any module is imported.
 *
 * @complexity O(a) in the declared vendor count.
 */
export function parseMediaProvidersFile({ raw }: { readonly raw: string }, _optional: Record<string, never> = {}): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!isPlainObject(value) || value.schemaVersion !== 1) return { ok: false, reason: "schemaVersion must be 1" };
  if (!Array.isArray(value.providers)) return { ok: false, reason: "providers must be an array" };
  const descriptors: MediaProviderContributionDescriptor[] = [];
  for (const [index, entry] of value.providers.entries()) {
    const result = parseDescriptor({ entry, at: `providers[${index}]` });
    if (typeof result === "string") return { ok: false, reason: result };
    if (descriptors.some((seen) => seen.id === result.id)) return { ok: false, reason: `providers[${index}].id '${result.id}' is declared twice` };
    descriptors.push(result);
  }
  return { ok: true, descriptors };
}

/** One descriptor entry, or the reason it is invalid. @complexity O(1). */
function parseDescriptor({ entry, at }: { entry: unknown; at: string }, _optional = {}): MediaProviderContributionDescriptor | string {
  if (!isPlainObject(entry)) return `${at} must be an object`;
  const { id, module, label } = entry;
  if (typeof id !== "string") return `${at}.id must be a string`;
  if (typeof module !== "string" || !module.endsWith(".mjs") || path.posix.isAbsolute(module)) return `${at}.module must be a relative path ending in .mjs`;
  const labelRefusal = refuseLabel({ label, at });
  if (labelRefusal !== undefined) return labelRefusal;
  // `refuseLabel` above already refused every non-string label, so this guard only narrows for the compiler.
  return { id, module, ...(typeof label === "string" ? { label } : {}) };
}

/** The reason a descriptor's optional `label` is invalid, or `undefined` when absent or fine. @complexity O(1). */
function refuseLabel({ label, at }: { label: unknown; at: string }, _optional = {}): string | undefined {
  if (label !== undefined && (typeof label !== "string" || label.trim() === "")) return `${at}.label must be a non-empty string when present`;
  return undefined;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
