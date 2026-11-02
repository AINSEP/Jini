/** Unpublished release tooling. Reads metadata and hashes files without importing plugin code. */
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readPluginIdentity } from '@jini-ai/core/plugin-directory';
import {
  AGENT_PLUGINS_PACKAGE, AGENT_PLUGINS_ROOT, agentPluginPackages, isPublishedAgentPluginFile, type AgentPluginPackageRow,
} from '../../../scripts/lib/agent-plugin-packages.js';

interface BrowserProvider { kind: string; contractVersion: number; javascript: string }
interface PluginManifest {
  id?: string; name: string; version: string; description?: string; $schema?: string;
  extensions: Record<string, { id: string }>;
  contributes?: { providers: { contract: string; contractVersion: number }[] };
  browserProviders?: BrowserProvider[];
  integrity?: Record<string, string>;
}
interface PackageManifest { name: string; version: string; description: string }
type CatalogKind = 'provider' | 'agent';
/** Providers without their own `@jini-ai/plugin-<id>` package ship from this distribution's `plugins/*`. */
const PROVIDER_DISTRIBUTION = '@jini-ai/provider-plugins';
/** The catalog currently describes the Tovu host's identity (`extensions.tovu`). A per-host catalog
 * waits until a second host (Open Marketing) consumes it. */
export const CATALOG_HOST_NAMESPACE = 'tovu';
/** One catalog record. An agent entry resolves as `${packageName}/${path}` (`@jini-ai/agent-plugins/<id>`);
 * a provider entry's `path` is its artifact folder inside `packageName`. */
export interface CatalogEntry {
  kind: 'provider' | 'agent'; id: string; publisherIdentity: string;
  packageName: string; version: string; pluginVersion: string; path: string;
  contract: { id: string; version: string | number }; description: string;
  expectedDigests: Record<string, string> | null;
}
interface CatalogPorts {
  readJson(file: string): Promise<unknown>;
  integrity(input: { sourceDir: string }): Promise<Record<string, string>>;
}

/** Project existing manifests into display metadata; no activation or loading authority.
 * @param required Local id (provider id or agent plugin name) and both manifests.
 * @param optional `kind` (default: by manifest format) and the shipping npm package (default: `@jini-ai/plugin-<id>`).
 * @returns One entry with an explicit pending-digests marker, preserving the agent version.
 * @throws TypeError for a package/id mismatch, malformed identity, or missing contract.
 * @example catalogEntry({ id: 'fixture-provider', packageManifest, pluginManifest })
 * @complexity O(k) in manifest keywords/identity fields, with no I/O. */
export function catalogEntry(required: {
  id: string; packageManifest: PackageManifest; pluginManifest: PluginManifest;
}, optional: { kind?: CatalogKind; packageName?: string } = {}): CatalogEntry {
  const { id, packageManifest: pkg, pluginManifest: plugin } = required;
  if (pkg.name !== (optional.packageName ?? `@jini-ai/plugin-${id}`) || (plugin.id ?? plugin.name) !== id) {
    throw new TypeError(`Package and plugin identity disagree: ${id}`);
  }
  const kind = optional.kind ?? (plugin.$schema === undefined ? 'provider' : 'agent');
  return {
    ...(kind === 'agent' ? agentMetadata(required) : providerMetadata(required)), id,
    publisherIdentity: readPluginIdentity({ manifest: { ...plugin }, namespace: CATALOG_HOST_NAMESPACE, name: id }).id,
    packageName: pkg.name, version: pkg.version,
    description: plugin.description ?? plugin.name, expectedDigests: null,
  };
}

type ArtifactMetadata = Pick<CatalogEntry, 'kind' | 'path' | 'pluginVersion' | 'contract'>;

/** Agent payloads sit at `<name>/` of the agent-plugins package (its subpath) and keep their own manifest version. */
function agentMetadata({ id, pluginManifest: plugin }: { id: string; pluginManifest: PluginManifest }): ArtifactMetadata {
  if (plugin.$schema === undefined) throw new TypeError(`Missing agent plugin schema: ${id}`);
  return { kind: 'agent', path: id, pluginVersion: plugin.version,
    contract: { id: 'agent-plugins', version: plugin.$schema.split('/').at(-2)! } };
}

/** Server providers name their contribution contract. A browser-only provider (no server
 * contribution) is described by its first browser declaration; no dummy server contribution is added. */
function providerMetadata({ id, packageManifest: pkg, pluginManifest: plugin }: {
  id: string; packageManifest: PackageManifest; pluginManifest: PluginManifest;
}): ArtifactMetadata {
  const provider = plugin.contributes?.providers[0];
  const browser = plugin.browserProviders?.[0];
  let contract: CatalogEntry['contract'];
  if (provider) contract = { id: provider.contract, version: provider.contractVersion };
  else if (browser && plugin.contributes === undefined) contract = { id: `browser-provider:${browser.kind}`, version: browser.contractVersion };
  else throw new TypeError(`Missing provider contract: ${id}`);
  return { kind: 'provider', path: `plugins/${id}/${pkg.version}`, pluginVersion: pkg.version, contract };
}

/** One catalog source. Kind comes from where the source lives, never from its id.
 * `packageDir` is the shipping package's folder under the packages root. */
interface CatalogSource { kind: CatalogKind; id: string; packageName: string; packageDir: string; sourceDir: string; manifestName: string }

/** Provider sources live in `provider-plugins/src/<id>` and ship from `plugin-<id>` when that package exists,
 * else from provider-plugins itself; agent sources come from the layout table and ship as agent-plugins subpaths. */
function catalogSources(required: {
  packagesRoot: string; providerIds: readonly string[]; agentPlugins: readonly AgentPluginPackageRow[];
  standaloneProviderIds: ReadonlySet<string>;
}): CatalogSource[] {
  const providers = required.providerIds.map(id => {
    const standalone = required.standaloneProviderIds.has(id);
    return { kind: 'provider' as const, id, packageName: standalone ? `@jini-ai/plugin-${id}` : PROVIDER_DISTRIBUTION,
      packageDir: standalone ? `plugin-${id}` : 'provider-plugins',
      sourceDir: path.join(required.packagesRoot, 'provider-plugins/src', id), manifestName: 'jini.plugin.json' };
  });
  // Row source paths are repository-relative; the packages root sits directly under the repository root.
  const agents = required.agentPlugins.map(row => ({ kind: 'agent' as const, id: row.name, packageName: AGENT_PLUGINS_PACKAGE,
    packageDir: path.basename(AGENT_PLUGINS_ROOT), sourceDir: path.join(path.dirname(required.packagesRoot), row.sourceDir),
    manifestName: 'plugin.json' }));
  // Code-unit order, as the previous `ids.sort()`, so the generated catalog keeps its order.
  const order = (a: string, b: string) => (a < b ? -1 : Number(a > b));
  return [...providers, ...agents].sort((a, b) => order(a.id, b.id) || order(a.kind, b.kind));
}

/** Entries are keyed by (kind, id): a face and its provider may share a local id. Anything that would
 * still collapse two plugins into one record (same kind and id, or the same publisher identity across
 * kinds) is a hard error rather than a silent merge.
 * @throws TypeError naming the clashing key. */
function assertDistinctEntries(required: { entries: readonly CatalogEntry[] }): void {
  const keys = new Set<string>();
  const identities = new Set<string>();
  for (const entry of required.entries) {
    const key = `${entry.kind}:${entry.id}`;
    if (keys.has(key)) throw new TypeError(`Duplicate catalog entry: ${key}`);
    if (identities.has(entry.publisherIdentity)) throw new TypeError(`Catalog publisher identity clash: ${entry.publisherIdentity}`);
    keys.add(key);
    identities.add(entry.publisherIdentity);
  }
}

/** Generate a release catalog from reviewed packages and completed payloads via injected I/O.
 * No builder runs here: missing or stale payloads fail before a catalog is published.
 * @param required Packages root, provider source ids and agent layout rows (`agentPluginPackages`).
 * @param optional `standaloneProviderIds`: providers with their own `plugin-<id>` package (default: every
 *   provider id); the rest ship from `@jini-ai/provider-plugins`.
 * @returns Entries in stable (id, kind) order with the integrity owner's exact file digests.
 * @throws On I/O failure, manifest drift, absent executable integrity, digest mismatch or an identity clash.
 * @example await generateCatalog({ packagesRoot, providerIds, agentPlugins: agentPluginPackages, ports })
 * @complexity O(n log n + b) for n packages and b payload bytes; no network or plugin imports. */
export async function generateCatalog(required: {
  packagesRoot: string; providerIds: readonly string[]; agentPlugins: readonly AgentPluginPackageRow[]; ports: CatalogPorts;
}, optional: { standaloneProviderIds?: readonly string[] } = {}): Promise<CatalogEntry[]> {
  const { packagesRoot, ports } = required;
  const standaloneProviderIds = new Set(optional.standaloneProviderIds ?? required.providerIds);
  const entries: CatalogEntry[] = [];
  for (const source of catalogSources({ ...required, standaloneProviderIds })) {
    const root = path.join(packagesRoot, source.packageDir);
    const pkg = await ports.readJson(path.join(root, 'package.json')) as PackageManifest;
    const plugin = await ports.readJson(path.join(source.sourceDir, source.manifestName)) as PluginManifest;
    const entry = catalogEntry({ id: source.id, packageManifest: pkg, pluginManifest: plugin }, { kind: source.kind, packageName: source.packageName });
    const artifactRoot = path.join(root, entry.path);
    const artifact = await ports.readJson(path.join(artifactRoot, source.manifestName)) as PluginManifest;
    await sealEntry({ entry, plugin, artifact, artifactRoot, ports });
    entries.push(entry);
  }
  assertDistinctEntries({ entries });
  return entries;
}

/** Executable files a provider payload must carry: the server entry when it contributes server
 * providers, and each declared browser bundle. */
function providerEntryFiles(required: { plugin: PluginManifest }): string[] {
  const files = (required.plugin.browserProviders ?? []).map(browser => browser.javascript);
  return required.plugin.contributes ? ['server/index.mjs', ...files] : files;
}

/** An agent payload is its source folder, read in place: drop files the tarball never carries (tests). */
function publishedDigests(required: { kind: CatalogKind; digests: Record<string, string> }): Record<string, string> {
  if (required.kind === 'provider') return required.digests;
  return Object.fromEntries(Object.entries(required.digests).filter(([file]) => isPublishedAgentPluginFile({ path: file })));
}

/** Bind display metadata to completed payload files; reject stale manifests before publishing.
 * Agent digests describe files, not the host-specific installer archive encoding.
 * @throws TypeError on metadata/integrity drift or an empty payload. O(b + f) for bytes/files. */
async function sealEntry(required: {
  entry: CatalogEntry; plugin: PluginManifest; artifact: PluginManifest; artifactRoot: string; ports: CatalogPorts;
}): Promise<void> {
  const { entry, plugin, artifact, artifactRoot, ports } = required;
  const expected = { ...plugin, version: entry.pluginVersion };
  if (entry.kind === 'provider') expected.integrity = artifact.integrity;
  if (!isDeepStrictEqual(artifact, expected)) throw new TypeError(`Stale plugin metadata: ${entry.id}`);
  const digests = publishedDigests({ kind: entry.kind, digests: await ports.integrity({ sourceDir: artifactRoot }) });
  entry.expectedDigests = digests;
  if (entry.kind === 'provider' && !isDeepStrictEqual(artifact.integrity, digests)) {
    throw new TypeError(`Plugin integrity mismatch: ${entry.id}`);
  }
  const entryFiles = entry.kind === 'provider' ? providerEntryFiles({ plugin }) : [];
  if (entryFiles.some(file => !digests[file])) throw new TypeError(`Missing provider entry digest: ${entry.id}`);
  if (Object.keys(digests).length === 0) throw new TypeError(`Missing plugin digests: ${entry.id}`);
}

/** Release-only composition reuses the installer's integrity owner, never a vendor entry point.
 * Writes atomically only after every entry succeeds; propagates filesystem/integrity failures. */
async function writeCatalog(): Promise<void> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const packagesRoot = path.dirname(root);
  const names = await readdir(path.join(packagesRoot, 'provider-plugins/src'), { withFileTypes: true });
  const ids = names.filter(item => item.isDirectory() && !item.name.startsWith('__')).map(item => item.name);
  const packages = new Set(await readdir(packagesRoot));
  const { computePluginIntegrity } = await import('@jini-ai/plugins/host/node');
  const entries = await generateCatalog({ packagesRoot, providerIds: ids, agentPlugins: agentPluginPackages, ports: {
    readJson: async file => JSON.parse(await readFile(file, 'utf8')) as unknown,
    integrity: computePluginIntegrity,
  } }, { standaloneProviderIds: ids.filter(id => packages.has(`plugin-${id}`)) });
  const temporary = path.join(root, `.catalog-${process.pid}.json`);
  await writeFile(temporary, JSON.stringify(entries, null, 2) + '\n');
  await rename(temporary, path.join(root, 'catalog.json'));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await writeCatalog();
