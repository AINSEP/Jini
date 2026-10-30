/** Workspace/publish wiring for the isolation policy; never builds or loads plugin code. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPluginPackageIsolation, type PluginIsolationManifest } from './check-plugin-isolation.js';
import { discoverJiniPackages, type JiniPackageEntry } from './lib/pack-jini-packages.js';
import { assertPackedExports } from './lib/packed-exports.js';

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
    const result = JSON.parse(execFileSync('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--cache', join(scratch, 'cache'), '--pack-destination', scratch],
      { cwd: entry.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as { filename: string }[];
    // npm's inventory is useful to readers, but tar's inventory is the published evidence.
    const archive = join(scratch, result[0]!.filename);
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
  if (!inventory.manifest.name.startsWith('@jini-ai/plugin-')) return;
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
  const pluginIds = packages.map(entry => entry.pkg.name!)
    .filter(name => name.startsWith('@jini-ai/plugin-') && name !== '@jini-ai/plugin-catalog')
    .map(name => name.slice('@jini-ai/plugin-'.length));
  const violations: PluginPackageViolation[] = [];
  for (const entry of packages) {
    try {
      const ports = { resolveLocalDependency: ({ specifier }: { specifier: string }) => localDependency({ entry, specifier }) };
      assertPluginPackageIsolation({ manifest: entry.pkg as PluginIsolationManifest, packedPaths: [], pluginIds }, ports);
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

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const violations = checkPluginPackages({ repoRoot: fileURLToPath(new URL('..', import.meta.url)) },
    process.argv.includes('--packed') ? { inspectPackage: inspectPluginPackageTarball } : {});
  for (const violation of violations) console.error(`${violation.rule} ${violation.file}: ${violation.reason}`);
  if (violations.length) process.exitCode = 1;
}
