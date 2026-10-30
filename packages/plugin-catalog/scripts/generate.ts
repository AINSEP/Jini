/** Unpublished release tooling. Reads metadata and hashes files without importing plugin code. */
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { readPluginIdentity } from '../../core/plugin-directory.js';

interface PluginManifest {
  id?: string; name: string; version: string; description?: string; $schema?: string;
  extensions: Record<string, { id: string }>;
  contributes?: { providers: { contract: string; contractVersion: number }[] };
  integrity?: Record<string, string>;
}
interface PackageManifest { name: string; version: string; description: string }
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
 * @returns One entry with an explicit pending-digests marker, preserving the agent version.
 * @throws TypeError for a package/id mismatch, malformed identity, or missing contract.
 * @example catalogEntry({ id: 'fixture-provider', packageManifest, pluginManifest })
 * @complexity O(k) in manifest keywords/identity fields, with no I/O. */
export function catalogEntry(required: {
  id: string; packageManifest: PackageManifest; pluginManifest: PluginManifest;
}, _optional: Record<string, never> = {}): CatalogEntry {
  const { id, packageManifest: pkg, pluginManifest: plugin } = required;
  if (pkg.name !== `@jini-ai/plugin-${id}` || (plugin.id ?? plugin.name) !== id) {
    throw new TypeError(`Package and plugin identity disagree: ${id}`);
  }
  return {
    ...artifactMetadata(required), id,
    publisherIdentity: readPluginIdentity({ manifest: { ...plugin }, namespace: 'tovu', name: id }).id,
    packageName: pkg.name, version: pkg.version,
    description: plugin.description ?? plugin.name, expectedDigests: null,
  };
}

/** Keep the two existing manifest formats distinct; missing provider contracts fail immediately. */
function artifactMetadata({ id, packageManifest: pkg, pluginManifest: plugin }: {
  id: string; packageManifest: PackageManifest; pluginManifest: PluginManifest;
}): Pick<CatalogEntry, 'kind' | 'path' | 'pluginVersion' | 'contract'> {
  if (plugin.$schema !== undefined) return { kind: 'agent', path: id, pluginVersion: plugin.version,
    contract: { id: 'agent-plugins', version: plugin.$schema.split('/').at(-2)! } };
  const provider = plugin.contributes?.providers[0];
  if (!provider) throw new TypeError(`Missing provider contract: ${id}`);
  return { kind: 'provider', path: `plugins/${id}/${pkg.version}`, pluginVersion: pkg.version,
    contract: { id: provider.contract, version: provider.contractVersion } };
}

/** Generate a release catalog from reviewed packages and completed payloads via injected I/O.
 * No builder runs here: missing or stale payloads fail before a catalog is published.
 * @returns Entries in stable id order with the integrity owner's exact file digests.
 * @throws On I/O failure, manifest drift, absent executable integrity, or digest mismatch.
 * @example await generateCatalog({ packagesRoot, ports })
 * @complexity O(n log n + b) for n packages and b payload bytes; no network or plugin imports. */
export async function generateCatalog(required: {
  packagesRoot: string; ids: readonly string[]; ports: CatalogPorts;
}, _optional: Record<string, never> = {}): Promise<CatalogEntry[]> {
  const { packagesRoot, ports } = required;
  const entries: CatalogEntry[] = [];
  for (const id of [...required.ids].sort()) {
    const root = path.join(packagesRoot, `plugin-${id}`);
    const pkg = await ports.readJson(path.join(root, 'package.json')) as PackageManifest;
    const agent = id === 'ui-ux-design';
    const manifestName = agent ? 'plugin.json' : 'jini.plugin.json';
    const source = agent ? `agent-plugins/${id}` : `provider-plugins/src/${id}`;
    const plugin = await ports.readJson(path.join(packagesRoot, source, manifestName)) as PluginManifest;
    const entry = catalogEntry({ id, packageManifest: pkg, pluginManifest: plugin });
    const artifactRoot = path.join(root, entry.path);
    const artifact = await ports.readJson(path.join(artifactRoot, manifestName)) as PluginManifest;
    await sealEntry({ entry, plugin, artifact, artifactRoot, ports });
    entries.push(entry);
  }
  return entries;
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
  entry.expectedDigests = await ports.integrity({ sourceDir: artifactRoot });
  if (entry.kind === 'provider' && !isDeepStrictEqual(artifact.integrity, entry.expectedDigests)) {
    throw new TypeError(`Plugin integrity mismatch: ${entry.id}`);
  }
  if (entry.kind === 'provider' && !entry.expectedDigests['server/index.mjs']) throw new TypeError(`Missing provider entry digest: ${entry.id}`);
  if (Object.keys(entry.expectedDigests).length === 0) throw new TypeError(`Missing plugin digests: ${entry.id}`);
}

/** Release-only composition reuses the installer's integrity owner, never a vendor entry point.
 * Writes atomically only after every entry succeeds; propagates filesystem/integrity failures. */
async function writeCatalog(): Promise<void> {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const packagesRoot = path.dirname(root);
  const names = await readdir(path.join(packagesRoot, 'provider-plugins/src'), { withFileTypes: true });
  const ids = names.filter(item => item.isDirectory() && !item.name.startsWith('__')).map(item => item.name);
  const { computePluginIntegrity } = await import('../../plugins/src/host/node/install.js');
  const entries = await generateCatalog({ packagesRoot, ids: [...ids, 'ui-ux-design'], ports: {
    readJson: async file => JSON.parse(await readFile(file, 'utf8')) as unknown,
    integrity: computePluginIntegrity,
  } });
  const temporary = path.join(root, `.catalog-${process.pid}.json`);
  await writeFile(temporary, JSON.stringify(entries, null, 2) + '\n');
  await rename(temporary, path.join(root, 'catalog.json'));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await writeCatalog();
