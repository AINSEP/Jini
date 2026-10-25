import { realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { createGuardedFileReader, createNodeGuardedReaderFilesystem } from '@jini-ai/platform/fs/guarded-reader';
import { execAgentFile } from './invocation.js';
import type { RuntimeBuildOptions } from './types.js';

/** Canonical host directory and attachment grants, checked again after image augmentation.
 * Throws before spawn on missing/non-directory roots, conflicting cwd, traversal or symlinks.
 * Reuses the platform reader's containment owner; O(n) filesystem checks for n supplied paths.
 */
export function validateFilesystemLaunch(required: {
  filesystemRoot: string; cwd: string; extraAllowedDirs?: readonly string[]; imagePaths?: readonly string[];
}, _optional = {}): string {
  if (!isAbsolute(required.filesystemRoot)) throw new Error('filesystemRoot must be an absolute directory');
  const root = realpathSync(required.filesystemRoot);
  if (!statSync(root).isDirectory()) throw new Error('filesystemRoot must be a directory');
  if (realpathSync(required.cwd) !== root) throw new Error('Working directory must equal filesystemRoot');
  const reader = createGuardedFileReader({ rootPath: root, filesystem: createNodeGuardedReaderFilesystem({}),
    denyRules: { segments: new Set(), filenamePatterns: [] },
    limits: { maxFileBytes: 1, binarySniffBytes: 1, maxListedFiles: 1, maxWalkDepth: 32, maxWalkEntries: 1 },
  });
  for (const path of [...(required.extraAllowedDirs ?? []), ...(required.imagePaths ?? [])]) {
    // Canonicalize first: root is a realpath, so a symlinked component such as macOS /var would
    // otherwise make every in-site path look outside. A broken link throws here and is refused.
    reader.resolve({ relativePath: relative(root, realpathSync(resolve(required.cwd, path))) || '.' });
  }
  return root;
}

/** Create one executor's probe cache; no filesystem access until the returned probe is called.
 * Cache concurrent and subsequent launches by executable identity for that executor's lifetime
 * so repeated launches do not spawn redundant metadata probes or share another host's evidence.
 * @returns The support check bound to an empty cache. @complexity O(1) allocation.
 * @example const verify = createClaudeFilesystemSupportProbe({});
 */
export function createClaudeFilesystemSupportProbe(_required: Record<string, never>, _options = {}): typeof assertClaudeFilesystemSupport {
  const cache = new Map<string, Promise<boolean | undefined>>();
  return (required, options = {}) => assertClaudeFilesystemSupport(required, { ...options, cache });
}

/** Probe official CLI enforcement, retrying uncertain evidence once without logging its values.
 * The 2.1.285 floor covers native read blocking and admin-required sandbox locks.
 * https://code.claude.com/docs/en/sandboxing#repository-settings-under-an-admin-required-sandbox
 * True means supported, false means known unsupported, undefined means apply settings optimistically.
 * O(1) metadata I/O and at most two bounded subprocesses per cache slot. Standalone calls
 * probe independently; executors bind a cache with createClaudeFilesystemSupportProbe.
 */
export async function assertClaudeFilesystemSupport(required: {
  agentId: string; launchPath: string; env: NodeJS.ProcessEnv;
}, { probe = execAgentFile, cache = new Map() }: {
  probe?: typeof execAgentFile; cache?: Map<string, Promise<boolean | undefined>>;
} = {}): Promise<boolean | void> {
  if (required.agentId !== 'claude' || /^openclaude(?:\.|$)/i.test(basename(required.launchPath))) return false;
  let key: string;
  try { key = `${realpathSync(required.launchPath)}:${statSync(required.launchPath).mtimeMs}`; }
  catch { return undefined; }
  let pending = cache.get(key);
  if (!pending) {
    pending = probeFilesystemSupport({ ...required, probe }, {});
    cache.set(key, pending);
  }
  return pending;
}

/** Unknown/failed evidence is retried with a longer budget; no diagnostic includes CLI output.
 * O(1), at most 20 seconds across both probes; no subprocess output escapes this boundary.
 */
async function probeFilesystemSupport(required: {
  launchPath: string; env: NodeJS.ProcessEnv; probe: typeof execAgentFile;
}, _optional = {}): Promise<boolean | undefined> {
  for (const timeout of [5000, 15000]) {
    try {
      const { stdout } = await required.probe({ command: required.launchPath, args: ['--version'] }, {
        options: { env: required.env, timeout },
      });
      const version = /^(\d+)\.(\d+)\.(\d+)\s+\(Claude Code\)\s*$/.exec(String(stdout).trim());
      if (version) return supportedClaudeVersion({ version }, {});
    } catch { /* Retry once; uncertainty must not remove the owner's ability to launch. */ }
  }
  return undefined;
}

/** Compare the already parsed official version tuple against the enforcement floor. Pure, O(1). */
function supportedClaudeVersion({ version }: { version: RegExpExecArray }, _optional = {}): boolean {
  const major = Number(version[1]), minor = Number(version[2]), patch = Number(version[3]);
  if (major !== 2) return major > 2;
  if (minor !== 1) return minor > 1;
  return patch >= 285;
}

/** Runtime assets under a denied home remain readable, never writable. Native installs need the
 * binary; npm installs also need their adjacent package resources. O(1), canonical filesystem I/O.
 */
export function claudeFilesystemRuntimePaths(required: { launchPath: string }, _optional = {}): readonly string[] {
  const executable = realpathSync(required.launchPath);
  const assets = /\.[cm]?js$/.test(executable) ? dirname(executable) : executable;
  return [...new Set([resolve(required.launchPath), assets, realpathSync(process.execPath)])];
}

/** Host settings override widening fields even when a Full CLI grant is enabled.
 * Personal/project layers are excluded separately. Preserve host hooks and secret denies.
 * Phase 1 leaves network policy unconfigured; the CLI's sandbox network defaults still apply.
 * https://code.claude.com/docs/en/permissions#working-directories
 * O(s + r) serialization for s host settings bytes and r runtime exception paths. Pure with
 * injectable host facts; errors reject malformed/file-based settings rather than dropping policy.
 * @example claudeFilesystemSettings({ options: { filesystemRoot: '/site' } }, { platform: 'darwin', uid: 501 })
 */
export function claudeFilesystemSettings(required: { options: RuntimeBuildOptions }, {
  platform = process.platform, homeDir = homedir(), tempDir = tmpdir(), uid,
}: { platform?: NodeJS.Platform; homeDir?: string; tempDir?: string; uid?: number | null | undefined } = {}): string {
  const { options } = required;
  const runtimeTempPaths = claudeRuntimeTempPaths({ options, platform }, { uid });
  const settings = options.settings ? JSON.parse(options.settings) as Record<string, unknown> : {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Host settings must be a JSON object');
  const permissions = settings.permissions as Record<string, unknown> | undefined;
  return JSON.stringify({ ...settings, autoMemoryEnabled: false,
    permissions: { ...permissions, blockReadsOutsideWorkingDirectories: true, additionalDirectories: [] },
    sandbox: { enabled: platform !== 'win32', failIfUnavailable: platform !== 'win32',
      allowUnsandboxedCommands: platform === 'win32', excludedCommands: [],
      filesystem: filesystemSandboxPaths({ options, homeDir, tempDir, runtimeTempPaths }, {}),
    },
  });
}

/** Exact scratch subtree inside the executor's private per-run CLAUDE_CODE_TMPDIR.
 * Missing bases grant nothing; long bases are refused so Bash cannot fall back to shared scratch.
 * Pure, O(p) time/space for p path bytes; invalid Unix host facts throw before policy generation.
 */
function claudeRuntimeTempPaths({ options, platform }: {
  options: RuntimeBuildOptions; platform: NodeJS.Platform;
}, { uid }: { uid?: number | null | undefined } = {}): string[] {
  if (platform === 'win32') return [];
  const base = options.filesystemRuntimeTempBase;
  if (!base) return [];
  if (!isAbsolute(base)) throw new Error('Runtime temp base must be absolute');
  const runtimeTemp = resolve(base, `claude-${requireUnixUid({}, { uid })}`);
  if (Buffer.byteLength(runtimeTemp) > 44) throw new Error('Runtime temp path must not exceed 44 bytes');
  return claudeTempAliases({ path: runtimeTemp, platform }, {});
}

/** The host UID that names Claude's scratch subtree; fails closed rather than granting a guessed path. O(1). */
function requireUnixUid(_required = {}, { uid = process.getuid?.() }: { uid?: number | null | undefined } = {}): number {
  if (!Number.isSafeInteger(uid) || uid! < 0) throw new Error('Runtime temp policy requires a Unix UID');
  return uid!;
}

/** Preserve macOS's lexical and /private spellings without filesystem I/O. Pure, O(p) path bytes. */
function claudeTempAliases({ path, platform }: { path: string; platform: NodeJS.Platform }, _optional = {}): string[] {
  if (platform !== 'darwin') return [path];
  const unprefixed = path.replace(/^\/private\/(?=tmp\/|var\/)/, '/');
  return /^\/(?:tmp|var)\//.test(unprefixed) ? [unprefixed, `/private${unprefixed}`] : [path];
}

/** Build explicit filesystem exceptions; shared temp and the rest of home remain denied.
 * Claude's exact scratch subtree in the executor-created per-run directory is a read/write
 * infrastructure exception so Bash can track cwd. Shared and other runs' scratch stay denied.
 * Pure, O(r + t) for r runtime paths and t shared temp roots; no filesystem access.
 */
function filesystemSandboxPaths({ options, homeDir, tempDir, runtimeTempPaths }: {
  options: RuntimeBuildOptions; homeDir: string; tempDir: string; runtimeTempPaths: readonly string[];
}, _optional = {}) {
  const privateTemp = options.filesystemTempDir ?? resolve(options.filesystemRoot!, '.agent-runtime', 'tmp');
  const sharedTempRoots = [...new Set(['/tmp', '/private/tmp', tempDir, ...(options.filesystemSharedTempRoots ?? [])])];
  return { denyRead: [homeDir, ...sharedTempRoots],
    // Owner 2026-10-23: git config is a read-only infrastructure exception, never all of home.
    allowRead: [options.filesystemRoot!, privateTemp, resolve(homeDir, '.gitconfig'),
      resolve(homeDir, '.config/git/config'), ...(options.filesystemRuntimeReadPaths ?? []), ...runtimeTempPaths],
    allowWrite: [options.filesystemRoot!, privateTemp, ...runtimeTempPaths] };
}
