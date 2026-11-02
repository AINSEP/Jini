import path from 'node:path';
import { isBundleInput, prebuildTarget, strippableReason } from './policies.js';
import type { PrebuildBuilt, Target } from './policies.js';
import type { PackagingFilesystemPort, PackageResolverPort, WorkspacePackagePackerPort, ProcessRunnerPort } from './ports.js';

const PACKAGE_JSON = 'package.json';

interface Manifest { name?: string; version?: string; dependencies?: Record<string, string> }
function manifest(directory: string, fs: PackagingFilesystemPort): Manifest {
  const file = path.join(directory, PACKAGE_JSON);
  return fs.exists({ path: file }) ? JSON.parse(Buffer.from(fs.read({ path: file })).toString('utf8')) as Manifest : {};
}
function safePackageName(name: string): void {
  if (!/^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name === '..') throw new Error(`Invalid package name: ${name}`);
}
export function isExcluded({ name, excluded }: { name: string; excluded: ReadonlySet<string> }): boolean {
  return excluded.has(name) || excluded.has(name.replace(/\\/g, '/').split('/')[0]!);
}
export function declaredDependencies({ packageDir, fs }: { packageDir: string; fs: PackagingFilesystemPort }): string[] {
  return Object.keys(manifest(packageDir, fs).dependencies ?? {});
}
export function stageDir(required: { source: string; destination: string; fs: PackagingFilesystemPort }, optional: { dropNestedModules?: boolean } = {}): void {
  required.fs.copy({ from: required.source, to: required.destination }, optional);
}
/** Host policy selects runtime edges; the planner still owns resolution/version safety. */
interface DependencyOptions {
  dependencies?: (required: { packageDir: string; fs: PackagingFilesystemPort }) => readonly string[];
}
type PlannedPackage = { directory: string; version: string | undefined };
/** Roots carry no destination: the caller staged them, so their edges can only land at the top level. */
type QueuedPackage = { directory: string; destination?: string };
function stagedPath(outDir: string, name: string): string { return path.join(outDir, 'node_modules', name); }
function resolveDependency(required: { from: string; name: string; fs: PackagingFilesystemPort; resolver: PackageResolverPort }): string {
  const { from, name, fs, resolver } = required;
  const resolved = resolver.resolve({ fromDirectory: from, packageName: name });
  if (!resolved) throw new Error(`Unresolved production dependency: ${from} -> ${name}`);
  return fs.realpath({ path: resolved });
}
interface ClosurePlan {
  outDir: string; excluded: ReadonlySet<string>; fs: PackagingFilesystemPort; resolver: PackageResolverPort;
  /** Planned copies keyed by staged destination; one source may be planned at several destinations. */
  staged: Map<string, PlannedPackage>; roots: ReadonlySet<string>; queue: QueuedPackage[];
}
/** Staged package directories from `destination` up to (excluding) the modules root, nearest first. */
function stagedAncestors(required: { outDir: string; destination: string | undefined }): string[] {
  const { outDir, destination } = required;
  const modulesDir = path.join(outDir, 'node_modules'), ancestors: string[] = [];
  for (let current = destination ?? modulesDir; current.startsWith(modulesDir + path.sep); current = path.dirname(current)) {
    if (path.basename(current) !== 'node_modules') ancestors.push(current);
  }
  return ancestors;
}
/** Where Node looks for `name` from a package staged at `destination`, nearest first, ending at the top level. */
function resolutionPath(required: { outDir: string; name: string; destination: string | undefined }): string[] {
  const { outDir, name, destination } = required;
  return [...stagedAncestors({ outDir, destination }).map(directory => path.join(directory, 'node_modules', name)), stagedPath(outDir, name)];
}
/** A planned copy, or a destination already on disk (which carries no source directory). */
function occupantAt(plan: ClosurePlan, required: { destination: string }): PlannedPackage | undefined {
  const { destination } = required;
  const planned = plan.staged.get(destination);
  if (planned || !plan.fs.exists({ path: destination })) return planned;
  return { directory: destination, version: plan.fs.exists({ path: path.join(destination, PACKAGE_JSON) }) ? manifest(destination, plan.fs).version : undefined };
}
/**
 * Flattening `name` from `directory` conflicts with an already planned copy from another directory
 * unless both carry the same known version, and with an already staged destination unless that
 * destination carries the same known version. Unversioned packages never count as the same.
 */
function compatible(required: { occupant: PlannedPackage; planned: PlannedPackage }): boolean {
  const { occupant, planned } = required;
  return occupant.directory === planned.directory || (planned.version !== undefined && occupant.version === planned.version);
}
/** npm's own position for `directory`: inside the source tree of a package staged on the dependent's path. */
function sourceLayoutPosition(plan: ClosurePlan, required: { from: QueuedPackage; directory: string }): string | undefined {
  for (const ancestor of stagedAncestors({ outDir: plan.outDir, destination: required.from.destination })) {
    const source = plan.staged.get(ancestor)?.directory;
    if (source && required.directory.startsWith(path.join(source, 'node_modules') + path.sep)) return ancestor + required.directory.slice(source.length);
  }
  return undefined;
}
function conflictError(required: { name: string; planned: PlannedPackage; from: QueuedPackage }): Error {
  const { name, planned, from } = required;
  return new Error(`Package version conflict while flattening ${name}: ${planned.directory} (${planned.version ?? 'unversioned'}) needed by ${from.directory}`);
}
/**
 * Choose where `planned` ships so Node resolves it from the dependent, or nothing when an existing
 * copy already serves it. A version that conflicts with the hoisted copy stays nested under its
 * dependent, preferring npm's own position, instead of failing or silently picking first-wins.
 * Supplied roots have no known position, so a conflict on their edges still throws.
 */
function placeDependency(plan: ClosurePlan, required: { from: QueuedPackage; name: string; planned: PlannedPackage }): string | undefined {
  const { from, name, planned } = required;
  const candidates = resolutionPath({ outDir: plan.outDir, name, destination: from.destination });
  const index = candidates.findIndex(candidate => occupantAt(plan, { destination: candidate }));
  const occupant = index < 0 ? undefined : occupantAt(plan, { destination: candidates[index]! });
  if (occupant && compatible({ occupant, planned })) return plan.staged.has(candidates[index]!) ? undefined : candidates[index];
  // Only positions nearer than the occupant are seen by Node; with no occupant, hoist like npm does.
  const open = index < 0 ? candidates : candidates.slice(0, index);
  const position = openPosition({ open, layout: sourceLayoutPosition(plan, { from, directory: planned.directory }), hoist: index < 0 });
  // A source already staged above the chosen spot means conflicting versions alternate down a cycle.
  if (!position || stagedAncestors({ outDir: plan.outDir, destination: path.dirname(position) }).some(ancestor => plan.staged.get(ancestor)?.directory === planned.directory)) throw conflictError({ name, planned, from });
  return position;
}
/** npm's position when Node can see it from the dependent; otherwise the top level (`hoist`) or the dependent's own node_modules. */
function openPosition(required: { open: readonly string[]; layout: string | undefined; hoist: boolean }): string | undefined {
  const { open, layout, hoist } = required;
  if (layout && open.includes(layout)) return layout;
  return hoist ? open.at(-1) : open[0];
}
/** Add one declared dependency of `from` to the plan (validated, resolved, placed) and queue each new destination once. */
function planDependency(plan: ClosurePlan, required: { from: QueuedPackage; name: string }): void {
  const { from, name } = required;
  safePackageName(name);
  if (isExcluded({ name, excluded: plan.excluded })) return;
  const directory = resolveDependency({ from: from.directory, name, fs: plan.fs, resolver: plan.resolver });
  if (plan.roots.has(directory)) return;
  const planned = { directory, version: manifest(directory, plan.fs).version };
  const destination = placeDependency(plan, { from, name, planned });
  if (!destination) return;
  plan.staged.set(destination, planned);
  plan.queue.push({ directory, destination });
}
/** Plan selected runtime edges before copying; unresolved/irreconcilable versions throw atomically.
 * Supplied roots are already owned by the caller and are never copied through a back edge.
 * A version that conflicts with the hoisted copy is staged nested under its dependent, so every
 * staged package still resolves its declared dependencies from where it sits.
 * @complexity O(packages × nesting depth + edges × ancestor depth) filesystem reads, O(packages) plan memory.
 * @example stageTransitiveDependencies({ roots, outDir, excluded, fs, resolver });
 */
export function stageTransitiveDependencies(required: {
  roots: readonly string[]; outDir: string; excluded: ReadonlySet<string>; fs: PackagingFilesystemPort; resolver: PackageResolverPort;
}, optional: DependencyOptions = {}): number {
  const { roots, fs } = required;
  const rootDirectories = new Set(roots.map(root => fs.realpath({ path: root })));
  const plan: ClosurePlan = { ...required, staged: new Map(), roots: rootDirectories, queue: [...rootDirectories].map(directory => ({ directory })) };
  for (let index = 0; index < plan.queue.length; index++) {
    const from = plan.queue[index]!;
    for (const name of (optional.dependencies ?? declaredDependencies)({ packageDir: from.directory, fs })) planDependency(plan, { from, name });
  }
  let count = 0;
  // Insertion order puts every dependent before the packages nested under it.
  for (const [destination, entry] of plan.staged) {
    if (fs.exists({ path: destination })) continue;
    stageDir({ source: entry.directory, destination, fs }, { dropNestedModules: true });
    count++;
  }
  return count;
}
/** Enumerate real package roots, treating scoped directories as containers. */
export function stagedPackageDirs({ modulesDir, fs }: { modulesDir: string; fs: PackagingFilesystemPort }): string[] {
  if (!fs.exists({ path: modulesDir })) return [];
  return fs.entries({ path: modulesDir }).filter(entry => !entry.startsWith('.')).flatMap(entry => {
    const full = path.join(modulesDir, entry);
    if (!entry.startsWith('@')) return fs.exists({ path: path.join(full, PACKAGE_JSON) }) ? [full] : [];
    return fs.entries({ path: full }).map(scoped => path.join(full, scoped)).filter(dir => fs.exists({ path: path.join(dir, PACKAGE_JSON) }));
  });
}
/** Resolve a dependency using Node's ancestor search, bounded to the shipped modules tree.
 * Symlinks escaping the payload cannot satisfy an edge. O(ancestor depth) filesystem probes.
 */
function shippedDependency({ directory, name, modulesDir, fs }: { directory: string; name: string; modulesDir: string; fs: PackagingFilesystemPort }, _optional = {}): boolean {
  const candidates: string[] = [];
  for (let current = directory; current.startsWith(modulesDir + path.sep); current = path.dirname(current)) candidates.push(path.join(current, 'node_modules', name));
  const found = [...candidates, path.join(modulesDir, name)].find(candidate => fs.exists({ path: path.join(candidate, PACKAGE_JSON) }));
  if (!found) return false;
  const relative = path.relative(fs.realpath({ path: modulesDir }), fs.realpath({ path: found }));
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

/** Inventory every staged package, including nested scopes, and report missing declared edges.
 * Hosts may select peers/optionals through the same policy seam as the staging planner.
 * @returns Ordered package-to-dependency diagnostics, suitable for host-specific refusal messages.
 * @throws Error if the staged modules tree is missing.
 * @complexity O(packages + edges × ancestor depth) filesystem probes; O(packages + gaps) memory.
 * @example missingClosureDependencies({ outDir, excluded, fs });
 */
export function missingClosureDependencies(required: { outDir: string; excluded: ReadonlySet<string>; fs: PackagingFilesystemPort }, optional: DependencyOptions = {}): string[] {
  const { outDir, excluded, fs } = required;
  const modulesDir = path.join(outDir, 'node_modules');
  if (!fs.exists({ path: modulesDir })) throw new Error('staged node_modules tree is missing');
  const packages = stagedPackageDirs({ modulesDir, fs });
  const missing: string[] = [], visited = new Set<string>();
  // Inventory nested packages even when no top-level dependency happens to reference them.
  for (const directory of packages) {
    const real = fs.realpath({ path: directory });
    if (visited.has(real)) continue;
    visited.add(real);
    packages.push(...stagedPackageDirs({ modulesDir: path.join(directory, 'node_modules'), fs }));
    for (const name of (optional.dependencies ?? declaredDependencies)({ packageDir: directory, fs })) {
      safePackageName(name);
      if (!isExcluded({ name, excluded }) && !shippedDependency({ directory, name, modulesDir, fs })) missing.push(`${path.relative(modulesDir, directory)} -> ${name}`);
    }
  }
  return missing;
}

/** Refuse incomplete nested/hoisted closures; checkout ancestors cannot fill shipped gaps. */
export function assertClosureComplete(required: { outDir: string; excluded: ReadonlySet<string>; fs: PackagingFilesystemPort }, optional: DependencyOptions = {}): void {
  const missing = missingClosureDependencies(required, optional);
  if (missing.length) throw new Error(`staged tree is missing ${missing.length} declared dependencies:\n  ${missing.join('\n  ')}`);
}
/** Share the existing workspace build/pack/rewritten-tarball implementation via a host binding. */
export function stagePackedWorkspace(required: {
  repoRoot: string; packagesDir: string; rootNames: readonly string[]; destDir: string; packer: WorkspacePackagePackerPort;
}): ReturnType<WorkspacePackagePackerPort['pack']> {
  const { packer, ...input } = required;
  return packer.pack(input);
}
/** Run npm's dependency listing through an explicit process port, then parse with parseNpmLsPaths. */
export function productionDependencyOutput(required: { command: string; args: readonly string[]; cwd: string; shell: boolean; runner: ProcessRunnerPort }): string {
  const { runner, ...request } = required;
  const result = runner.run(request);
  if (result.exitCode !== 0) throw new Error(`dependency listing failed with exit ${result.exitCode}`);
  return result.stdout;
}
/** Source freshness scan ignores non-bundle inputs, hidden entries and dependency trees. */
export function newestMtime({ absolutePath, fs }: { absolutePath: string; fs: PackagingFilesystemPort }): number {
  if (!fs.exists({ path: absolutePath })) return 0;
  const info = fs.stat({ path: absolutePath });
  if (info.kind !== 'directory') return info.kind === 'file' && isBundleInput({ relPath: absolutePath }) ? info.mtimeMs : 0;
  let newest = 0;
  for (const entry of fs.entries({ path: absolutePath })) {
    if (entry.startsWith('.') || entry === 'node_modules' || !isBundleInput({ relPath: entry + '/' })) continue;
    newest = Math.max(newest, newestMtime({ absolutePath: path.join(absolutePath, entry), fs }));
  }
  return newest;
}
export function diskBytes({ absolutePath, fs }: { absolutePath: string; fs: PackagingFilesystemPort }): number {
  const info = fs.stat({ path: absolutePath });
  return info.kind === 'directory' ? fs.entries({ path: absolutePath }).reduce((sum, name) => sum + diskBytes({ absolutePath: path.join(absolutePath, name), fs }), 0) : info.diskBytes;
}
export interface StripTally { declaration: number; sourceMap: number; coverage: number; bytes: number }
/** Only staged roots are accepted; the caller must keep them separate from its source dependency tree. */
export function stripNonRuntimeFiles(required: { outDir: string; keepScopes: ReadonlySet<string>; fs: PackagingFilesystemPort }): StripTally {
  const { outDir, keepScopes, fs } = required;
  const modulesDir = path.join(outDir, 'node_modules');
  const tally: StripTally = { declaration: 0, sourceMap: 0, coverage: 0, bytes: 0 };
  if (!fs.exists({ path: modulesDir })) return tally;
  for (const directory of stagedPackageDirs({ modulesDir, fs })) {
    const coverage = path.join(directory, 'coverage');
    if (!fs.exists({ path: coverage }) || fs.stat({ path: coverage }).kind !== 'directory') continue;
    tally.bytes += diskBytes({ absolutePath: coverage, fs }); tally.coverage++; fs.remove({ path: coverage });
  }
  function stripFile(full: string, diskBytes: number): void {
    const reason = strippableReason({ relPath: path.relative(modulesDir, full).split(path.sep).join('/'), keepScopes });
    if (!reason) return;
    tally.bytes += diskBytes; tally[reason]++; fs.remove({ path: full });
  }
  function walk(directory: string): void {
    for (const name of fs.entries({ path: directory })) {
      const full = path.join(directory, name);
      const info = fs.stat({ path: full });
      if (info.kind === 'directory') walk(full);
      else stripFile(full, info.diskBytes);
    }
  }
  walk(modulesDir);
  return tally;
}
export interface PruneTally { prebuilds: number; buildInputs: number; bytes: number }
type PruneRemoval = { full: string; reason: 'prebuilds' | 'buildInputs' };
function serves(built: PrebuildBuilt, target: Target): boolean {
  return built.architectures.includes(target.arch) && (target.platform === built.platform || (target.platform === 'linux' && built.platform === 'linuxmusl'));
}
/** One staged package's removals; throws when its prebuilds cannot serve every target, before anything is removed. */
function packagePruneRemovals(required: { directory: string; modulesDir: string; targets: readonly Target[]; fs: PackagingFilesystemPort }): PruneRemoval[] {
  const { directory, modulesDir, targets, fs } = required;
  const prebuilds = path.join(directory, 'prebuilds');
  if (!fs.exists({ path: prebuilds })) return [];
  const entries = fs.entries({ path: prebuilds }).map(name => ({ name, built: prebuildTarget({ entryName: name }) }));
  const known = entries.filter((entry): entry is { name: string; built: PrebuildBuilt } => entry.built !== undefined);
  if (!targets.every(target => known.some(entry => serves(entry.built, target)))) throw new Error(`${path.relative(modulesDir, directory)} ships no prebuild for every requested target: ${targets.map(x => x.platform + '-' + x.arch).join(', ')}`);
  const foreign = known.filter(entry => !targets.some(target => serves(entry.built, target))).map(entry => ({ full: path.join(prebuilds, entry.name), reason: 'prebuilds' as const }));
  const buildInputs = ['deps', 'binding.gyp'].map(input => path.join(directory, input)).filter(full => fs.exists({ path: full })).map(full => ({ full, reason: 'buildInputs' as const }));
  return [...foreign, ...buildInputs];
}
/** Verify every target before removing foreign prebuilds or source build inputs. */
export function pruneNativePrebuilds(required: { outDir: string; targets: readonly Target[]; fs: PackagingFilesystemPort }): PruneTally {
  const { outDir, targets, fs } = required;
  if (!targets.length) throw new Error('at least one native target is required');
  const modulesDir = path.join(outDir, 'node_modules');
  const tally: PruneTally = { prebuilds: 0, buildInputs: 0, bytes: 0 };
  const removals = stagedPackageDirs({ modulesDir, fs }).flatMap(directory => packagePruneRemovals({ directory, modulesDir, targets, fs }));
  for (const { full, reason } of removals) { tally.bytes += diskBytes({ absolutePath: full, fs }); tally[reason]++; fs.remove({ path: full }); }
  return tally;
}
/** Runtime copy inventory is required, so no product shells or payload paths live in this package. */
export function stagePayloadFiles(required: { repoRoot: string; outDir: string; relativePaths: readonly string[]; fs: PackagingFilesystemPort }): void {
  const entries = required.relativePaths.map(relative => {
    if (!relative || path.isAbsolute(relative) || relative.replace(/\\/g, '/').split('/').some(x => x === '..' || x === '.')) throw new Error(`Unsafe payload path: ${relative}`);
    const from = path.join(required.repoRoot, relative);
    if (!required.fs.exists({ path: from })) throw new Error(`Missing payload input: ${relative}`);
    return { from, to: path.join(required.outDir, relative) };
  });
  for (const entry of entries) required.fs.copy(entry);
}

/** Detect Mach-O/ELF/PE magic from bytes; short files are valid inputs. */
export function hasNativeBinaryMagic({ bytes }: { bytes: Uint8Array }): boolean {
  const hex = Buffer.from(bytes.subarray(0, 4)).toString('hex');
  return ['feedface', 'feedfacf', 'cafebabe', 'cefaedfe', 'cffaedfe', '7f454c46', '4d5a'].some(prefix => hex.startsWith(prefix));
}
/** Stage npm with an explicit drop policy, refusing unsigned native binaries before any copy. */
export function stageBundledNpm(required: {
  npmSource: string; outDir: string; marker: string; droppedDirectoryNames: ReadonlySet<string>; droppedFileSuffixes: readonly string[]; fs: PackagingFilesystemPort;
}): { fileCount: number; bytes: number } {
  const { npmSource, outDir, marker, droppedDirectoryNames, droppedFileSuffixes, fs } = required;
  if (!marker || path.isAbsolute(marker) || marker.replace(/\\/g, '/').split('/').some(x => x === '.' || x === '..')) throw new Error('Invalid npm marker');
  if (!fs.exists({ path: path.join(npmSource, marker) })) throw new Error(`stageBundledNpm: no ${marker} under ${npmSource}`);
  const source = fs.realpath({ path: npmSource });
  const target = path.resolve(outDir);
  if (target === source || target.startsWith(source + path.sep) || source.startsWith(target + path.sep)) throw new Error('npm source and staging destination must be disjoint');
  if (!fs.readPrefix) throw new Error('stageBundledNpm: bounded prefix-read port is required');
  const readPrefix = fs.readPrefix.bind(fs);
  const excluded = ({ path: full, directory }: { path: string; directory: boolean }) => directory ? droppedDirectoryNames.has(path.basename(full)) : droppedFileSuffixes.some(suffix => full.endsWith(suffix));
  function assertNotNativeBinary(full: string): void {
    if (hasNativeBinaryMagic({ bytes: readPrefix({ path: full, maxBytes: 4 }) })) throw new Error(`stageBundledNpm: ${path.relative(source, full)} starts with native-binary magic bytes`);
  }
  function inspect(directory: string): void {
    for (const entry of fs.entries({ path: directory })) {
      const full = path.join(directory, entry);
      const info = fs.stat({ path: full });
      if (info.kind === 'other') throw new Error(`stageBundledNpm: nonregular input ${full}`);
      if (excluded({ path: full, directory: info.kind === 'directory' })) continue;
      if (info.kind === 'directory') inspect(full);
      else assertNotNativeBinary(full);
    }
  }
  inspect(source);
  fs.remove({ path: outDir });
  fs.copy({ from: source, to: outDir }, { exclude: excluded });
  let fileCount = 0;
  function count(directory: string): void {
    for (const name of fs.entries({ path: directory })) {
      const full = path.join(directory, name);
      if (fs.stat({ path: full }).kind === 'directory') count(full); else fileCount++;
    }
  }
  count(outDir);
  return { fileCount, bytes: diskBytes({ absolutePath: outDir, fs }) };
}
