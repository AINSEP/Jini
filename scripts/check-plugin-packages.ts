/** Workspace/publish wiring for the isolation policy; never builds or loads plugin code. */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as semver from 'semver';
import { isDeepStrictEqual } from 'node:util';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertAgentPluginSubpathExports, assertPluginPackageIsolation, type PluginIsolationManifest } from './check-plugin-isolation.js';
import { AGENT_PLUGINS_PACKAGE, isPublishedAgentPluginFile } from './lib/agent-plugin-packages.js';
import { discoverJiniPackages, type JiniPackageEntry } from './lib/pack-jini-packages.js';
import { parseNpmPackJson } from './lib/npm-pack-json.js';
import { assertPackedExports } from './lib/packed-exports.js';
import { catalogEntry, type CatalogEntry } from '../packages/plugin-catalog/scripts/generate.js';
import { computePluginIntegrity } from '@jini-ai/plugins/host/node';

interface PackageInventory { manifest: PluginIsolationManifest & { exports?: unknown }; packedPaths: readonly string[] }
export interface PluginPackageCheckPorts {
  /** Omit for the source guard; publish supplies the real tarball inspector below. */
  inspectPackage?: (input: { entry: JiniPackageEntry }) => PackageInventory;
}
export interface PluginPackageViolation { rule: string; file: string; reason: string }

/** Pack the already-built publish files and inspect the archive, with lifecycle scripts disabled.
 * @returns The actual packed manifest and tar inventory; never rewrites dependency declarations.
 * @throws npm/tar/I/O errors, including missing build output checked by the caller's export gate.
 * @complexity One pack and two archive reads per package; scratch bytes are removed on every exit.
 */
export function inspectPluginPackageTarball(
  { entry }: { entry: JiniPackageEntry }, _optional: Record<string, never> = {},
): PackageInventory {
  const scratch = mkdtempSync(join(tmpdir(), 'jini-plugin-pack-'));
  try {
    const packed = parseNpmPackJson({ stdout: execFileSync('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', join(scratch, 'cache'), '--pack-destination', scratch],
      { cwd: entry.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) });
    // npm's inventory is useful to readers, but tar's inventory is the published evidence.
    const archive = join(scratch, packed.filename);
    const manifest = JSON.parse(execFileSync('tar', ['-xzOf', archive, 'package/package.json'], { encoding: 'utf8' })) as PackageInventory['manifest'];
    const packedPaths = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    return { manifest, packedPaths };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

/** Resolve local dependency identities through manifests, including disguised directory names. */
function localDependency(required: { entry: JiniPackageEntry; specifier: string }, _optional: Record<string, never> = {}): string | undefined {
  const directory = resolve(required.entry.dir, required.specifier.replace(/^(?:file|link|portal|workspace):/, ''));
  return (JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: string }).name;
}

/** Require reviewable attribution even if a package accidentally narrows its publish file list. */
function requirePluginDocuments({ inventory }: { inventory: PackageInventory }, _optional: Record<string, never> = {}): void {
  if (!inventory.manifest.name.startsWith('@jini-ai/plugin-') && !['@jini-ai/agent-plugins', '@jini-ai/provider-plugins'].includes(inventory.manifest.name)) return;
  const files = new Set(inventory.packedPaths.map(file => file.replace(/^(?:\.\/)?package\//, '')));
  for (const file of ['package.json', 'README.md', 'LICENSE', 'NOTICE']) {
    if (!files.has(file)) throw new TypeError(`${inventory.manifest.name}: missing packed ${file}`);
  }
}

/** Check every workspace package so a core tarball cannot hide a plugin payload.
 * @param required Workspace root; discovery uses the existing pnpm-workspace reader.
 * @param optional Tarball inspection port for the release gate; omitted for manifest-only guards.
 * @returns Per-package violations, including inspection failures; no failure becomes a skipped check.
 * @complexity O(P + D + F) metadata traversal, plus the policy's path checks and optional pack I/O.
 */
export function checkPluginPackages(
  required: { repoRoot: string }, optional: PluginPackageCheckPorts = {},
): PluginPackageViolation[] {
  const packages = [...discoverJiniPackages(required.repoRoot).values()];
  const sourceRoot = join(required.repoRoot, 'packages/provider-plugins/src');
  const providerIds = existsSync(sourceRoot) ? readdirSync(sourceRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith('__')).map(entry => entry.name) : [];
  const pluginIds = [...providerIds, ...packages.map(entry => entry.pkg.name!)
    .filter(name => name.startsWith('@jini-ai/plugin-') && name !== '@jini-ai/plugin-catalog')
    .map(name => name.slice('@jini-ai/plugin-'.length))];
  const violations: PluginPackageViolation[] = [];
  for (const entry of packages) {
    try {
      const ports = { resolveLocalDependency: ({ specifier }: { specifier: string }) => localDependency({ entry, specifier }) };
      assertPluginPackageIsolation({ manifest: entry.pkg as PluginIsolationManifest, packedPaths: [], pluginIds }, ports);
      // Agent plugin subpaths: each export reaches only its own folder (the packed manifest copies these exports).
      if (entry.pkg.name === AGENT_PLUGINS_PACKAGE) assertAgentPluginSubpathExports({ manifest: entry.pkg as PluginIsolationManifest });
      if (entry.pkg.private === true || !optional.inspectPackage) continue;
      const inventory = optional.inspectPackage({ entry });
      assertPluginPackageIsolation({ ...inventory, pluginIds }, ports);
      assertPackedExports(inventory);
      requirePluginDocuments({ inventory });
    } catch (error) {
      violations.push({ rule: 'P1-plugin-isolation', file: relative(required.repoRoot, join(entry.dir, 'package.json')),
        reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return violations;
}

type ReleasePorts = { publishedPackage(input: { name: string; version: string }): Promise<string | undefined> };
type PluginManifest = Parameters<typeof catalogEntry>[0]['pluginManifest'];

/** Read immutable registry tarballs, never lifecycle hooks. Only an explicit registry 404 is absent.
 * The caller owns scratch cleanup and caches packages shared by catalog records. */
async function publishedPluginPackage(required: { name: string; version: string; scratch: string }): Promise<string | undefined> {
  const result = spawnSync('npm', ['pack', `${required.name}@${required.version}`, '--ignore-scripts', '--json',
    '--cache', join(required.scratch, 'cache'), '--pack-destination', required.scratch], { encoding: 'utf8' });
  if (result.status !== 0) {
    if (/\bE404\b/.test(result.stderr)) return undefined;
    throw new Error(`Registry plugin lookup failed for ${required.name}@${required.version}: ${result.stderr}`);
  }
  const archive = join(required.scratch, parseNpmPackJson({ stdout: result.stdout }).filename);
  const destination = mkdtempSync(join(required.scratch, 'unpacked-'));
  execFileSync('tar', ['-xzf', archive, '-C', destination]);
  return join(destination, 'package');
}

async function pluginDigests(required: { root: string; kind: CatalogEntry['kind'] }): Promise<Record<string, string>> {
  const digests = await computePluginIntegrity({ sourceDir: required.root });
  return required.kind === 'provider' ? digests : Object.fromEntries(Object.entries(digests)
    .filter(([path]) => isPublishedAgentPluginFile({ path })));
}

/** Compare catalog metadata and hashes with the bytes the chosen release will actually serve. */
async function assertCatalogArtifact(required: { entry: CatalogEntry; packageRoot: string }): Promise<void> {
  const { entry, packageRoot } = required;
  const artifactRoot = join(packageRoot, entry.path);
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Parameters<typeof catalogEntry>[0]['packageManifest'];
  const plugin = JSON.parse(readFileSync(join(artifactRoot, entry.kind === 'agent' ? 'plugin.json' : 'jini.plugin.json'), 'utf8')) as PluginManifest;
  const digests = await pluginDigests({ root: artifactRoot, kind: entry.kind });
  const actual = { ...catalogEntry({ id: entry.id, packageManifest: pkg, pluginManifest: plugin }, { kind: entry.kind }), expectedDigests: digests };
  if (plugin.version !== entry.pluginVersion || !isDeepStrictEqual(actual, entry)
    || (entry.kind === 'provider' && !isDeepStrictEqual(plugin.integrity, digests))) {
    throw new TypeError(`Release catalog mismatch: ${entry.kind}:${entry.id} in ${entry.packageName}@${entry.version}`);
  }
}

/** Agent manifests have independent versions: changed published files require a newer inner version.
 * New plugins and never-published distributions have no previous content to invalidate. */
async function assertAgentVersion(required: { entry: CatalogEntry; previousRoot: string | undefined }): Promise<void> {
  const { entry, previousRoot } = required;
  if (!previousRoot) return;
  const artifactRoot = join(previousRoot, entry.path);
  const manifest = join(artifactRoot, 'plugin.json');
  if (!existsSync(manifest)) return;
  const previous = JSON.parse(readFileSync(manifest, 'utf8')) as PluginManifest;
  const digests = await pluginDigests({ root: artifactRoot, kind: 'agent' });
  if (isDeepStrictEqual(digests, entry.expectedDigests)) return;
  if (!semver.valid(entry.pluginVersion) || !semver.valid(previous.version) || !semver.gt(entry.pluginVersion, previous.version)) {
    throw new TypeError(`Agent plugin ${entry.id} changed without advancing ${previous.version}`);
  }
}

/** Guard the whole catalog before the first release upload, including filtered releases.
 * Selected pending versions use prepared tarball bytes; skipped versions must match immutable npm bytes.
 * @param required Sealed catalog and selected pending package@version → unpacked tarball roots.
 * @param optional Registry archive port for focused tests; production reads npm without publishing.
 * @throws On registry failure, absent unselected versions, metadata/digest drift or stale agent versions.
 * @complexity O(B + E) file hashing for payload bytes B and entries E; one archive per package version.
 */
export async function checkPluginReleaseConsistency(required: {
  entries: readonly CatalogEntry[]; pendingPackages: ReadonlyMap<string, string>;
}, optional: Partial<ReleasePorts> = {}): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'jini-plugin-release-'));
  const packages = new Map<string, Promise<string | undefined>>();
  const load = (name: string, version: string): Promise<string | undefined> => {
    const key = `${name}@${version}`;
    if (!packages.has(key)) packages.set(key, optional.publishedPackage
      ? optional.publishedPackage({ name, version }) : publishedPluginPackage({ name, version, scratch }));
    return packages.get(key)!;
  };
  try {
    for (const entry of required.entries) {
      const identity = `${entry.packageName}@${entry.version}`;
      const selectedIdentity = [...required.pendingPackages.keys()].find(key => key.startsWith(`${entry.packageName}@`));
      if (selectedIdentity && selectedIdentity !== identity) throw new TypeError(`Release catalog version mismatch: ${identity} versus ${selectedIdentity}`);
      const selected = required.pendingPackages.get(identity);
      const packageRoot = selected ?? await load(entry.packageName, entry.version);
      if (!packageRoot) throw new TypeError(`${entry.packageName}@${entry.version} is not published or selected for this release`);
      await assertCatalogArtifact({ entry, packageRoot });
      if (entry.kind === 'agent' && selected) await assertAgentVersion({ entry, previousRoot: await load(entry.packageName, 'latest') });
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const violations = checkPluginPackages({ repoRoot: fileURLToPath(new URL('..', import.meta.url)) },
    process.argv.includes('--packed') ? { inspectPackage: inspectPluginPackageTarball } : {});
  for (const violation of violations) console.error(`${violation.rule} ${violation.file}: ${violation.reason}`);
  if (violations.length) process.exitCode = 1;
}
