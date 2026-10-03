import type { DescriptorExtensionReader, LoadedSourceControlProvider, ProviderCatalogPort, SourceControlProvider, SourceControlProviderDescriptor, SourceControlProviderKit, SourceControlProviderModule, SourceControlProviderRegistry } from './contracts.js';

type ParseResult = { ok: true; descriptors: SourceControlProviderDescriptor[] } | { ok: false; reason: string };
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function relativeModule(value: unknown): value is string {
  return typeof value === 'string' && value.endsWith('.mjs') && !/[\\\x00-\x1f\x7f:]/.test(value) && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}
function httpsOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; } catch { return false; }
}
function pathList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 20 && value.every(entry => typeof entry === 'string' && entry.length <= 200 && !/[\\\x00-\x1f\x7f:]/.test(entry) && entry.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..'));
}
function parseDescriptor(entry: unknown, at: string, readExtensions: DescriptorExtensionReader): SourceControlProviderDescriptor | string {
  if (!object(entry)) return `${at} must be an object`;
  const { id, label, apiOrigin, maxFileBytes, reservedPaths, workflowPaths, module } = entry;
  if (typeof id !== 'string' || id.length > 64 || /\s/.test(id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return `${at}.id must be a lowercase hyphenated id`;
  if (typeof label !== 'string' || label.trim() === '' || label.length > 100) return `${at}.label must be a non-empty string`;
  if (!httpsOrigin(apiOrigin)) return `${at}.apiOrigin must be an https origin with no path`;
  if (maxFileBytes !== undefined && (typeof maxFileBytes !== 'number' || !Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0)) return `${at}.maxFileBytes must be a positive integer`;
  if (reservedPaths !== undefined && !pathList(reservedPaths)) return `${at}.reservedPaths must be a list of at most 20 relative folder paths`;
  if (workflowPaths !== undefined && !pathList(workflowPaths)) return `${at}.workflowPaths must be a list of at most 20 relative folder paths`;
  if (!relativeModule(module)) return `${at}.module must be a relative path ending in .mjs`;
  const extras = readExtensions({ entry, at });
  if (!extras.ok) return extras.reason;
  return { ...extras.extensions, id, label, apiOrigin, module, ...(typeof maxFileBytes === 'number' ? { maxFileBytes } : {}), ...(pathList(reservedPaths) ? { reservedPaths } : {}), ...(pathList(workflowPaths) ? { workflowPaths } : {}) };
}
/** Parse generic host facts; the caller validates credential/i18n extensions. Unknown keys are ignored. */
export function parseSourceControlProvidersFile(required: { raw: string; readExtensions: DescriptorExtensionReader }): ParseResult {
  let value: unknown;
  try { value = JSON.parse(required.raw); } catch { return { ok: false, reason: 'not valid JSON' }; }
  if (!object(value) || value.schemaVersion !== 1) return { ok: false, reason: 'schemaVersion must be 1' };
  if (!Array.isArray(value.providers)) return { ok: false, reason: 'providers must be an array' };
  const descriptors: SourceControlProviderDescriptor[] = [];
  for (const [index, entry] of value.providers.entries()) {
    const descriptor = parseDescriptor(entry, `providers[${index}]`, required.readExtensions);
    if (typeof descriptor === 'string') return { ok: false, reason: descriptor };
    if (descriptors.some(prior => prior.id === descriptor.id)) return { ok: false, reason: `providers[${index}].id '${descriptor.id}' is declared twice` };
    descriptors.push(descriptor);
  }
  return { ok: true, descriptors };
}
function moduleError(value: unknown): string | null {
  if (!object(value) || typeof value.create !== 'function') return 'its module has no create() function';
  if (value.validateTarget !== undefined && typeof value.validateTarget !== 'function') return "its module's validateTarget is not a function";
  return null;
}
/** Fresh instance-local registry; only the catalog can grant the ability to import trusted modules. */
export async function loadSourceControlProviderRegistry(required: {
  workspaceId: string; descriptorFileName: string; catalog: ProviderCatalogPort; readExtensions: DescriptorExtensionReader;
  describeError(required: { error: unknown }): string;
}): Promise<SourceControlProviderRegistry> {
  const packages = [...await required.catalog.list({ workspaceId: required.workspaceId, descriptorFileName: required.descriptorFileName })].sort((a, b) => a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : 0);
  const providers: LoadedSourceControlProvider[] = [];
  const refusals: string[] = [];
  const switchedOff = new Map<string, string>();
  for (const item of packages) {
    if (item.state === 'refused') { refusals.push(`${item.pluginId}: ${item.reason}`); continue; }
    let parsed: ParseResult;
    try { parsed = parseSourceControlProvidersFile({ raw: item.descriptorText, readExtensions: required.readExtensions }); }
    catch (error) { refusals.push(`${item.pluginId}: ${required.describeError({ error })}`); continue; }
    if (!parsed.ok) { refusals.push(`${item.pluginId}: ${parsed.reason}`); continue; }
    if (item.state === 'inactive') {
      for (const descriptor of parsed.descriptors) if (!switchedOff.has(descriptor.id)) switchedOff.set(descriptor.id, item.pluginId);
      continue;
    }
    for (const descriptor of parsed.descriptors) {
      try {
        const candidate = await item.importModule({ relativePath: descriptor.module });
        const reason = moduleError(candidate);
        if (reason) { refusals.push(`${item.pluginId}/${descriptor.id}: ${reason}`); continue; }
        providers.push({ descriptor, pluginId: item.pluginId, module: candidate as SourceControlProviderModule });
      } catch (error) { refusals.push(`${item.pluginId}/${descriptor.id}: ${required.describeError({ error })}`); }
    }
  }
  const frozen = Object.freeze(providers.slice());
  return { list: () => frozen, get: ({ providerId }) => frozen.find(provider => provider.descriptor.id === providerId), refusals: Object.freeze(refusals.slice()), switchedOff };
}
/** Build operations and host facts without allowing module operations to overwrite declared facts. */
export function buildLoadedSourceControlProvider(required: { loaded: LoadedSourceControlProvider; kit: SourceControlProviderKit }): SourceControlProvider {
  const { loaded, kit } = required;
  const { id, label, apiOrigin, maxFileBytes, reservedPaths, workflowPaths } = loaded.descriptor;
  return { ...loaded.module.create({ kit }), ...(loaded.module.validateTarget ? { validateTarget: loaded.module.validateTarget } : {}), id, label, apiOrigin,
    ...(maxFileBytes !== undefined ? { maxFileBytes } : {}), ...(reservedPaths !== undefined ? { reservedPaths } : {}), ...(workflowPaths !== undefined ? { workflowPaths } : {}) };
}
export type BuildSourceControlProviderResult = { ok: true; provider: SourceControlProvider } | { ok: false; message: string; refusals: readonly string[] };
export interface BuildProviderArgs {
  workspaceId: string; providerId: string; kit: SourceControlProviderKit;
  load(required: { workspaceId: string }): Promise<SourceControlProviderRegistry>;
  noProviderMessage(required: { registry: SourceControlProviderRegistry; providerId: string }): string;
}
/** Operator navigation/copy is supplied by the host, with no descriptor or product defaults. */
export async function buildSourceControlProvider(required: BuildProviderArgs): Promise<BuildSourceControlProviderResult> {
  const registry = await required.load({ workspaceId: required.workspaceId });
  const loaded = registry.get({ providerId: required.providerId });
  if (!loaded) return { ok: false, message: required.noProviderMessage({ registry, providerId: required.providerId }), refusals: registry.refusals };
  return { ok: true, provider: buildLoadedSourceControlProvider({ loaded, kit: required.kit }) };
}
export interface BuildProvidersArgs {
  workspaceId: string; kit: SourceControlProviderKit;
  load(required: { workspaceId: string }): Promise<SourceControlProviderRegistry>;
  noProviderMessage(required: { registry: SourceControlProviderRegistry }): string;
}
/** Build every enabled provider over the same guarded kit, in catalog order. */
export async function buildSourceControlProviders(required: BuildProvidersArgs): Promise<{ providers: readonly SourceControlProvider[]; refusals: readonly string[]; noProviderMessage: string }> {
  const registry = await required.load({ workspaceId: required.workspaceId });
  return { providers: registry.list({}).map(loaded => buildLoadedSourceControlProvider({ loaded, kit: required.kit })), refusals: registry.refusals, noProviderMessage: required.noProviderMessage({ registry }) };
}
/** Build and select a provider for one custom credential's API origin. */
export async function buildSourceControlProviderForApi(required: BuildProvidersArgs & { baseUrl: string }): Promise<BuildSourceControlProviderResult> {
  const built = await buildSourceControlProviders(required);
  const picked = pickSourceControlProviderForApi({ providers: built.providers, baseUrl: required.baseUrl, noProviderMessage: built.noProviderMessage });
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
export function pickSourceControlProviderForApi(required: { providers: readonly SourceControlProvider[]; baseUrl: string; noProviderMessage: string }): { ok: true; provider: SourceControlProvider } | { ok: false; message: string } {
  const origin = originOf({ url: required.baseUrl });
  const match = required.providers.find(provider => originOf({ url: provider.apiOrigin }) === origin) ?? (required.providers.length === 1 ? required.providers[0] : undefined);
  if (match) return { ok: true, provider: match };
  return { ok: false, message: required.providers.length === 0 ? required.noProviderMessage : `No enabled provider supplies source control for ${origin ?? required.baseUrl}.` };
}
