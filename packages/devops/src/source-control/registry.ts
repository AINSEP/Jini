import type { SourceControlProviderOperations, DescriptorExtensionReader, LoadedSourceControlProvider, ProviderCatalogPort, SourceControlProvider, SourceControlProviderDescriptor, SourceControlProviderKit, SourceControlProviderModule, SourceControlProviderRegistry } from './contracts.js';

type ParseResult = { ok: true; descriptors: SourceControlProviderDescriptor[] } | { ok: false; reason: string };
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** Shared relative-path rule: no backslash, colon or control character; no empty, `.` or `..` segment. */
function safeRelativePath(value: string): boolean {
  return !/[\\\x00-\x1f\x7f:]/.test(value) && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}
/** True for `https://host[:port]` exactly — what `new URL(x).origin` gives back. @complexity O(1). */
function httpsOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; } catch { return false; }
}
export interface DescriptorPathPolicy {
  /** Trusted catalogs may defer module containment to their own fail-closed import gate. */
  modulePath?(required: { path: string }): boolean;
  folderPath?(required: { path: string }): boolean;
}
function folderPathAllowed(entry: unknown, policy: DescriptorPathPolicy): boolean {
  if (typeof entry !== 'string' || entry.length > 200) return false;
  return policy.folderPath ? policy.folderPath({ path: entry }) : safeRelativePath(entry);
}
function pathList(value: unknown, policy: DescriptorPathPolicy = {}): value is string[] {
  return Array.isArray(value) && value.length <= 20 && value.every(entry => folderPathAllowed(entry, policy));
}
function providerId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && !/\s/.test(value) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
function providerLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 100;
}
function optionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
}
function moduleAllowed(value: unknown, policy: DescriptorPathPolicy): boolean {
  // The `.mjs` rule holds even when a trusted policy replaces the relative-path rule.
  if (typeof value !== 'string' || !value.endsWith('.mjs')) return false;
  return policy.modulePath ? policy.modulePath({ path: value }) : safeRelativePath(value);
}
/** Field checks in declaration order; each runs only after every earlier one passed. */
function descriptorFieldError(entry: Record<string, unknown>, at: string, policy: DescriptorPathPolicy): string | undefined {
  const checks: ReadonlyArray<readonly [() => boolean, string]> = [
    [() => providerId(entry.id), `${at}.id must be a lowercase hyphenated id`],
    [() => providerLabel(entry.label), `${at}.label must be a non-empty string`],
    [() => httpsOrigin(entry.apiOrigin), `${at}.apiOrigin must be an https origin with no path`],
    [() => optionalPositiveInteger(entry.maxFileBytes), `${at}.maxFileBytes must be a positive integer`],
    [() => entry.reservedPaths === undefined || pathList(entry.reservedPaths, policy), `${at}.reservedPaths must be a list of at most 20 relative folder paths`],
    [() => entry.workflowPaths === undefined || pathList(entry.workflowPaths, policy), `${at}.workflowPaths must be a list of at most 20 relative folder paths`],
    [() => moduleAllowed(entry.module, policy), `${at}.module must be a relative path ending in .mjs`],
  ];
  return checks.find(([passes]) => !passes())?.[1];
}
function parseDescriptor(entry: unknown, at: string, readExtensions: DescriptorExtensionReader, policy: DescriptorPathPolicy): SourceControlProviderDescriptor | string {
  if (!object(entry)) return `${at} must be an object`;
  const fieldError = descriptorFieldError(entry, at, policy);
  if (fieldError !== undefined) return fieldError;
  const extras = readExtensions({ entry, at });
  if (!extras.ok) return extras.reason;
  const { id, label, apiOrigin, maxFileBytes, reservedPaths, workflowPaths, module } = entry as Record<string, unknown> & { id: string; label: string; apiOrigin: string; module: string };
  return { ...extras.extensions, id, label, apiOrigin, module, ...(typeof maxFileBytes === 'number' ? { maxFileBytes } : {}), ...(pathList(reservedPaths, policy) ? { reservedPaths } : {}), ...(pathList(workflowPaths, policy) ? { workflowPaths } : {}) };
}
/** Parse generic host facts; the caller validates credential/i18n extensions. Unknown keys are ignored. */
export function parseSourceControlProvidersFile(required: { raw: string; readExtensions: DescriptorExtensionReader }, optional: DescriptorPathPolicy = {}): ParseResult {
  let value: unknown;
  try { value = JSON.parse(required.raw); } catch { return { ok: false, reason: 'not valid JSON' }; }
  if (!object(value) || value.schemaVersion !== 1) return { ok: false, reason: 'schemaVersion must be 1' };
  if (!Array.isArray(value.providers)) return { ok: false, reason: 'providers must be an array' };
  const descriptors: SourceControlProviderDescriptor[] = [];
  for (const [index, entry] of value.providers.entries()) {
    const descriptor = parseDescriptor(entry, `providers[${index}]`, required.readExtensions, optional);
    if (typeof descriptor === 'string') return { ok: false, reason: descriptor };
    if (descriptors.some(prior => prior.id === descriptor.id)) return { ok: false, reason: `providers[${index}].id '${descriptor.id}' is declared twice` };
    descriptors.push(descriptor);
  }
  return { ok: true, descriptors };
}
export function sourceControlProviderModuleError({ value }: { value: unknown }, _optional = {}): string | null {
  if (!object(value) || typeof value.create !== 'function') return 'its module has no create() function';
  if (value.validateTarget !== undefined && typeof value.validateTarget !== 'function') return "its module's validateTarget is not a function";
  return null;
}
type CatalogItem = Awaited<ReturnType<ProviderCatalogPort['list']>>[number];
type RegistryLoadArgs = Parameters<typeof loadSourceControlProviderRegistry>[0];
interface RegistryAccumulator { providers: LoadedSourceControlProvider[]; refusals: string[]; switchedOff: Map<string, string> }

function byPluginId(a: CatalogItem, b: CatalogItem): number {
  if (a.pluginId < b.pluginId) return -1;
  return a.pluginId > b.pluginId ? 1 : 0;
}
/** Parse one catalog descriptor file; a throwing extension reader is that plugin's refusal only. */
function parseCatalogDescriptors(required: { descriptorText: string; args: RegistryLoadArgs }): ParseResult {
  try { return parseSourceControlProvidersFile({ raw: required.descriptorText, readExtensions: required.args.readExtensions }); }
  catch (error) { return { ok: false, reason: required.args.describeError({ error }) }; }
}
/** Import each declared module through the catalog's gate, isolating every provider's fault. */
async function importTrustedProviders(required: { item: Extract<CatalogItem, { state: 'trusted' }>; descriptors: SourceControlProviderDescriptor[]; args: RegistryLoadArgs; into: RegistryAccumulator }): Promise<void> {
  const { item, args, into } = required;
  for (const descriptor of required.descriptors) {
    try {
      const candidate = await item.importModule({ relativePath: descriptor.module });
      const reason = sourceControlProviderModuleError({ value: candidate });
      if (reason) into.refusals.push(`${item.pluginId}/${descriptor.id}: ${reason}`);
      else into.providers.push({ descriptor, pluginId: item.pluginId, module: candidate as SourceControlProviderModule });
    } catch (error) { into.refusals.push(`${item.pluginId}/${descriptor.id}: ${args.describeError({ error })}`); }
  }
}
async function loadCatalogItem(required: { item: CatalogItem; args: RegistryLoadArgs; into: RegistryAccumulator }): Promise<void> {
  const { item, into } = required;
  if (item.state === 'refused') { into.refusals.push(`${item.pluginId}: ${item.reason}`); return; }
  const parsed = parseCatalogDescriptors({ descriptorText: item.descriptorText, args: required.args });
  if (!parsed.ok) { into.refusals.push(`${item.pluginId}: ${parsed.reason}`); return; }
  if (item.state === 'inactive') {
    // Inactive plugins never import; the first plugin in id order owns each switched-off id.
    for (const descriptor of parsed.descriptors) if (!into.switchedOff.has(descriptor.id)) into.switchedOff.set(descriptor.id, item.pluginId);
    return;
  }
  await importTrustedProviders({ item, descriptors: parsed.descriptors, args: required.args, into });
}
/** Fresh instance-local registry; only the catalog can grant the ability to import trusted modules. */
export async function loadSourceControlProviderRegistry(required: {
  workspaceId: string; descriptorFileName: string; catalog: ProviderCatalogPort; readExtensions: DescriptorExtensionReader;
  describeError(required: { error: unknown }): string;
}): Promise<SourceControlProviderRegistry> {
  const packages = [...await required.catalog.list({ workspaceId: required.workspaceId, descriptorFileName: required.descriptorFileName })].sort(byPluginId);
  const into: RegistryAccumulator = { providers: [], refusals: [], switchedOff: new Map<string, string>() };
  for (const item of packages) await loadCatalogItem({ item, args: required, into });
  const frozen = Object.freeze(into.providers.slice());
  return { list: () => frozen, get: ({ providerId }) => frozen.find(provider => provider.descriptor.id === providerId), refusals: Object.freeze(into.refusals.slice()), switchedOff: into.switchedOff };
}
/** Build operations and host facts without allowing module operations to overwrite declared facts. */
export interface SharedLoadedProvider<Kit, Operations> {
  readonly descriptor: SourceControlProviderDescriptor;
  readonly module: { create(required: { kit: Kit }): Operations; validateTarget?: (required: { owner: string; repo: string }) => string | null };
}
export function buildLoadedSourceControlProvider<Kit, Operations>(required: { loaded: SharedLoadedProvider<Kit, Operations>; kit: Kit }, _optional = {}): Operations & import('./contracts.js').SourceControlHostFacts & { validateTarget?: (required: { owner: string; repo: string }) => string | null } {
  const { loaded, kit } = required;
  const { id, label, apiOrigin, maxFileBytes, reservedPaths, workflowPaths } = loaded.descriptor;
  return { ...loaded.module.create({ kit }), ...(loaded.module.validateTarget ? { validateTarget: loaded.module.validateTarget } : {}), id, label, apiOrigin,
    ...(maxFileBytes !== undefined ? { maxFileBytes } : {}), ...(reservedPaths !== undefined ? { reservedPaths } : {}), ...(workflowPaths !== undefined ? { workflowPaths } : {}) };
}
export interface SharedProviderRegistry<Kit, Operations> {
  list(required: Record<string, never>): readonly SharedLoadedProvider<Kit, Operations>[];
  get(required: { providerId: string }): SharedLoadedProvider<Kit, Operations> | undefined;
  readonly refusals: readonly string[];
}
export interface SharedBuildProviderArgs<Kit = SourceControlProviderKit, Operations = SourceControlProviderOperations, Registry extends SharedProviderRegistry<Kit, Operations> = SharedProviderRegistry<Kit, Operations>> {
  workspaceId: string; kit: Kit;
  load(required: { workspaceId: string }): Promise<Registry>;
  noProviderMessage(required: { registry: Registry; providerId?: string }): string;
}

export type BuildSourceControlProviderResult = { ok: true; provider: SourceControlProvider } | { ok: false; message: string; refusals: readonly string[] };
export interface BuildProviderArgs {
  workspaceId: string; providerId: string; kit: SourceControlProviderKit;
  load(required: { workspaceId: string }): Promise<SourceControlProviderRegistry>;
  noProviderMessage(required: { registry: SourceControlProviderRegistry; providerId: string }): string;
}
/** Operator navigation/copy is supplied by the host, with no descriptor or product defaults. */
export async function buildSourceControlProvider<Kit = SourceControlProviderKit, Operations = SourceControlProviderOperations, Registry extends SharedProviderRegistry<Kit, Operations> = SharedProviderRegistry<Kit, Operations>>(required: Omit<SharedBuildProviderArgs<Kit, Operations, Registry>, "noProviderMessage"> & { providerId: string; noProviderMessage(required: { registry: Registry; providerId: string }): string }, _optional = {}) {
  const registry = await required.load({ workspaceId: required.workspaceId });
  const loaded = registry.get({ providerId: required.providerId });
  if (!loaded) return { ok: false as const, message: required.noProviderMessage({ registry, providerId: required.providerId }), refusals: registry.refusals };
  return { ok: true as const, provider: buildLoadedSourceControlProvider<Kit, Operations>({ loaded, kit: required.kit }) };
}
export interface BuildProvidersArgs {
  workspaceId: string; kit: SourceControlProviderKit;
  load(required: { workspaceId: string }): Promise<SourceControlProviderRegistry>;
  noProviderMessage(required: { registry: SourceControlProviderRegistry }): string;
}
/** Build every enabled provider over the same guarded kit, in catalog order. */
export async function buildSourceControlProviders<Kit = SourceControlProviderKit, Operations = SourceControlProviderOperations, Registry extends SharedProviderRegistry<Kit, Operations> = SharedProviderRegistry<Kit, Operations>>(required: SharedBuildProviderArgs<Kit, Operations, Registry>, _optional = {}) {
  const registry = await required.load({ workspaceId: required.workspaceId });
  return { providers: registry.list({}).map(loaded => buildLoadedSourceControlProvider<Kit, Operations>({ loaded, kit: required.kit })), refusals: registry.refusals, noProviderMessage: required.noProviderMessage({ registry }) };
}
/** Build and select a provider for one custom credential's API origin. */
export async function buildSourceControlProviderForApi<Kit = SourceControlProviderKit, Operations = SourceControlProviderOperations, Registry extends SharedProviderRegistry<Kit, Operations> = SharedProviderRegistry<Kit, Operations>>(required: SharedBuildProviderArgs<Kit, Operations, Registry> & { baseUrl: string }, optional: { missingProviderMessage?: (required: { origin: string | undefined; baseUrl: string }) => string } = {}) {
  const built = await buildSourceControlProviders<Kit, Operations, Registry>(required);
  const picked = pickSourceControlProviderForApi({ providers: built.providers, baseUrl: required.baseUrl, noProviderMessage: built.noProviderMessage }, optional);
  if (picked.ok) return picked;
  return { ...picked, refusals: built.refusals };
}
/** Find the folder or ancestor that has provider-defined reserved semantics, ignoring case. */
export function findReservedPath(required: { folder: string }, optional: { reservedPaths?: readonly string[] } = {}): string | undefined {
  const lower = required.folder.toLowerCase();
  return optional.reservedPaths?.find(reserved => lower === reserved.toLowerCase() || lower.startsWith(`${reserved.toLowerCase()}/`));
}
/** Workflow recognition is case-sensitive and relative to repository root. */
export function isUnderWorkflowPath(required: { filePath: string }, optional: { workflowPaths?: readonly string[] } = {}): boolean {
  return optional.workflowPaths?.some(folder => required.filePath.startsWith(`${folder}/`)) ?? false;
}
/** URL origin or undefined for malformed URLs. */
export function originOf(required: { url: string }): string | undefined {
  try { return new URL(required.url).origin; } catch { return undefined; }
}
/** Exact API-origin match first; a sole provider may serve a self-hosted origin. */
export function pickSourceControlProviderForApi<Provider extends { apiOrigin: string }>(required: { providers: readonly Provider[]; baseUrl: string; noProviderMessage: string }, optional: { missingProviderMessage?: (required: { origin: string | undefined; baseUrl: string }) => string } = {}): { ok: true; provider: Provider } | { ok: false; message: string } {
  const origin = originOf({ url: required.baseUrl });
  const match = required.providers.find(provider => originOf({ url: provider.apiOrigin }) === origin) ?? (required.providers.length === 1 ? required.providers[0] : undefined);
  if (match) return { ok: true, provider: match };
  return { ok: false, message: required.providers.length === 0 ? required.noProviderMessage : (optional.missingProviderMessage?.({ origin, baseUrl: required.baseUrl }) ?? `No enabled provider supplies source control for ${origin ?? required.baseUrl}.`) };
}
