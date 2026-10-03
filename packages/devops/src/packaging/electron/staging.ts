import path from 'node:path';
import { isBundleInput, prebuildTarget, strippableReason } from './policies.js';
import type { Target } from './policies.js';
import type { PackagingFilesystemPort, PackageResolverPort, WorkspacePackagePackerPort, ProcessRunnerPort } from './ports.js';

interface Manifest { name?: string; version?: string; dependencies?: Record<string, string> }
function manifest(directory: string, fs: PackagingFilesystemPort): Manifest {
  const file = path.join(directory, 'package.json');
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
/** Plan the production closure first. Fail unresolved/conflicting versions before copying anything. */
export function stageTransitiveDependencies(required: {
  roots: readonly string[]; outDir: string; excluded: ReadonlySet<string>; fs: PackagingFilesystemPort; resolver: PackageResolverPort;
}): number {
  const { roots, outDir, excluded, fs, resolver } = required;
  const visited = new Set(roots.map(root => fs.realpath({ path: root })));
  const queue = [...visited];
  const staged = new Map<string, { directory: string; version: string | undefined }>();
  for (let index = 0; index < queue.length; index++) {
    const from = queue[index]!;
    for (const name of declaredDependencies({ packageDir: from, fs })) {
      safePackageName(name);
      if (isExcluded({ name, excluded })) continue;
      const resolved = resolver.resolve({ fromDirectory: from, packageName: name });
      if (!resolved) throw new Error(`Unresolved production dependency: ${from} -> ${name}`);
      const directory = fs.realpath({ path: resolved });
      const version = manifest(directory, fs).version;
      const existing = staged.get(name);
      const destination = path.join(outDir, 'node_modules', name);
      const destinationVersion = fs.exists({ path: path.join(destination, 'package.json') }) ? manifest(destination, fs).version : undefined;
      if ((existing && existing.directory !== directory && (!version || existing.version !== version)) || (fs.exists({ path: destination }) && (!version || destinationVersion !== version))) throw new Error(`Package version conflict while flattening ${name}`);
      if (!existing) staged.set(name, { directory, version });
      if (!visited.has(directory)) { visited.add(directory); queue.push(directory); }
    }
  }
  let count = 0;
  for (const [name, entry] of staged) {
    const destination = path.join(outDir, 'node_modules', name);
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
    if (!entry.startsWith('@')) return fs.exists({ path: path.join(full, 'package.json') }) ? [full] : [];
    return fs.entries({ path: full }).map(scoped => path.join(full, scoped)).filter(dir => fs.exists({ path: path.join(dir, 'package.json') }));
  });
}
/** Check nested/hoisted dependencies only inside shipped modules; ancestors cannot fill gaps. */
export function assertClosureComplete(required: { outDir: string; excluded: ReadonlySet<string>; fs: PackagingFilesystemPort }): void {
  const { outDir, excluded, fs } = required;
  const modulesDir = path.join(outDir, 'node_modules');
  const missing: string[] = [];
  if (!fs.exists({ path: modulesDir })) throw new Error('staged node_modules tree is missing');
  for (const directory of stagedPackageDirs({ modulesDir, fs })) {
    for (const name of declaredDependencies({ packageDir: directory, fs })) {
      safePackageName(name);
      if (isExcluded({ name, excluded })) continue;
      if (!fs.exists({ path: path.join(modulesDir, name, 'package.json') }) && !fs.exists({ path: path.join(directory, 'node_modules', name, 'package.json') })) missing.push(`${path.relative(modulesDir, directory)} -> ${name}`);
    }
  }
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
  function walk(directory: string): void {
    for (const name of fs.entries({ path: directory })) {
      const full = path.join(directory, name);
      const info = fs.stat({ path: full });
      if (info.kind === 'directory') { walk(full); continue; }
      const reason = strippableReason({ relPath: path.relative(modulesDir, full).split(path.sep).join('/'), keepScopes });
      if (!reason) continue;
      tally.bytes += info.diskBytes; tally[reason]++; fs.remove({ path: full });
    }
  }
  walk(modulesDir);
  return tally;
}
export interface PruneTally { prebuilds: number; buildInputs: number; bytes: number }
/** Verify every target before removing foreign prebuilds or source build inputs. */
export function pruneNativePrebuilds(required: { outDir: string; targets: readonly Target[]; fs: PackagingFilesystemPort }): PruneTally {
  const { outDir, targets, fs } = required;
  if (!targets.length) throw new Error('at least one native target is required');
  const modulesDir = path.join(outDir, 'node_modules');
  const tally: PruneTally = { prebuilds: 0, buildInputs: 0, bytes: 0 };
  const removals: { full: string; reason: 'prebuilds' | 'buildInputs' }[] = [];
  for (const directory of stagedPackageDirs({ modulesDir, fs })) {
    const prebuilds = path.join(directory, 'prebuilds');
    if (!fs.exists({ path: prebuilds })) continue;
    const entries = fs.entries({ path: prebuilds }).map(name => ({ name, built: prebuildTarget({ entryName: name }) }));
    const serves = (built: NonNullable<ReturnType<typeof prebuildTarget>>, target: Target) => built.architectures.includes(target.arch) && (target.platform === built.platform || (target.platform === 'linux' && built.platform === 'linuxmusl'));
    if (!targets.every(target => entries.some(entry => entry.built && serves(entry.built, target)))) throw new Error(`${path.relative(modulesDir, directory)} ships no prebuild for every requested target: ${targets.map(x => x.platform + '-' + x.arch).join(', ')}`);
    for (const entry of entries) if (entry.built && !targets.some(target => serves(entry.built!, target))) removals.push({ full: path.join(prebuilds, entry.name), reason: 'prebuilds' });
    for (const input of ['deps', 'binding.gyp']) if (fs.exists({ path: path.join(directory, input) })) removals.push({ full: path.join(directory, input), reason: 'buildInputs' });
  }
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
  function inspect(directory: string): void {
    for (const entry of fs.entries({ path: directory })) {
      const full = path.join(directory, entry);
      const info = fs.stat({ path: full });
      if (info.kind === 'other') throw new Error(`stageBundledNpm: nonregular input ${full}`);
      if (excluded({ path: full, directory: info.kind === 'directory' })) continue;
      if (info.kind === 'directory') inspect(full);
      else if (hasNativeBinaryMagic({ bytes: readPrefix({ path: full, maxBytes: 4 }) })) throw new Error(`stageBundledNpm: ${path.relative(source, full)} starts with native-binary magic bytes`);
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
