import path from 'node:path';

export interface Target { platform: string; arch: string }
export interface PrebuildBuilt { platform: string; architectures: string[] }
export interface StalenessShell { relative: string; marker: string; buildWith: string }

/** Independent live signals; a quiet sample still requires post-package byte verification. */
export function treeQuietProblems(required: {
  surface: string; watcherRunning: boolean; gitDirtyPaths?: readonly string[]; movingPaths?: readonly string[];
}): string[] {
  const problems: string[] = [];
  if (required.watcherRunning) problems.push(`a build watch process is rewriting ${required.surface}; stop it before packaging.`);
  if (required.gitDirtyPaths?.length) problems.push(`${required.surface} has uncommitted changes: ${required.gitDirtyPaths.join(', ')}.`);
  if (required.movingPaths?.length) problems.push(`${required.surface} is still being written to: ${required.movingPaths.join(', ')} changed during this check.`);
  return problems;
}
/** Conservative bundle-input policy, shared by source timestamp scanning. */
export function isBundleInput({ relPath }: { relPath: string }): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized.split('/').some(segment => segment === '__tests__' || segment === '__measurements__')) return false;
  return !/\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized);
}
/** Missing timestamps defer to the host's existence checks; there is no stale-build tolerance. */
export function shellStalenessFailure({ builtAt, sourceAt, shell }: { builtAt: number; sourceAt: number; shell: StalenessShell }): string | null {
  if (builtAt === 0 || sourceAt === 0 || builtAt >= sourceAt) return null;
  return `the built shell at ${shell.relative} is STALE — its ${shell.marker} is ${((sourceAt - builtAt) / 86_400_000).toFixed(1)} day(s) older than its own source. Rebuild it with: ${shell.buildWith}`;
}
/** npm's parseable output may contain duplicates and Windows CRLF endings. */
export function parseNpmLsPaths({ stdout, modulesDir, separator }: { stdout: string; modulesDir: string; separator: string }): string[] {
  const prefix = modulesDir + separator;
  return [...new Set(stdout.split(/\r?\n/).filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length)))].sort();
}
/** Unknown formats are retained rather than guessed to be incompatible. */
export function prebuildTarget({ entryName }: { entryName: string }): PrebuildBuilt | undefined {
  const tag = entryName.endsWith('.node') ? entryName.slice(0, -5) : entryName;
  const split = tag.indexOf('-');
  if (split <= 0) return undefined;
  const platform = tag.slice(0, split);
  const architectures = tag.slice(split + 1).split('+');
  if (!['aix', 'android', 'darwin', 'freebsd', 'linux', 'linuxmusl', 'openbsd', 'sunos', 'win32'].includes(platform) || !architectures.every(Boolean)) return undefined;
  return { platform, architectures };
}
/** Targets come from arguments, never application environment names. */
export function resolveTargets({ host }: { host: Target }, optional: { platform?: string; arch?: string } = {}): Target[] {
  const platform = optional.platform || host.platform;
  const arch = optional.arch || host.arch;
  return (arch === 'universal' ? ['x64', 'arm64'] : [arch]).map(arch => ({ platform, arch }));
}
/** Prefer npm-cli.js under Node; direct npm needs a shell only for Windows cmd wrappers. */
export function resolveNpmLsCommand(required: { platform: string; execPath: string }, optional: { npmExecPath?: string } = {}): { command: string; args: string[]; shell: boolean } {
  const args = ['ls', '--omit=dev', '--parseable', '--all'];
  return optional.npmExecPath ? { command: required.execPath, args: [optional.npmExecPath, ...args], shell: false } : { command: 'npm', args, shell: required.platform === 'win32' };
}
/** Keep source maps only for scopes explicitly supplied by the consumer. */
export function strippableReason({ relPath, keepScopes }: { relPath: string; keepScopes: ReadonlySet<string> }): 'declaration' | 'sourceMap' | undefined {
  const name = path.posix.basename(relPath);
  if (/\.d\.[cm]?ts(\.map)?$/.test(name)) return 'declaration';
  if (!name.endsWith('.map') || keepScopes.has(relPath.split('/')[0]!)) return undefined;
  return 'sourceMap';
}
