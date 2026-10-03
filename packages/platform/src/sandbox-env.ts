/**
 * @module sandbox-env
 *
 * Sandboxed agent-execution environment: an isolated directory tree (agent
 * home, cache, config, temp, …) plus the environment-variable overrides that
 * redirect a spawned agent process's HOME/XDG/TMPDIR into it, and a policy
 * gate for whether an imported (non-managed) project root may be used while
 * sandboxing is on.
 *
 * Generalized from an upstream flat daemon module: the origin hardcoded its
 * host product's env-var names and a product-branded config sub-directory.
 * Every one of those is now a field on {@link SandboxEnvConfig} so a
 * consumer isn't branded — see `archived provenance ledger` for the exact mapping.
 */
import fs from 'node:fs';
import path from 'node:path';

import { resolveProjectRelativePath } from './home-expansion.js';

/**
 * Names the environment variables and on-disk naming this port reads/writes.
 * A consumer supplies its own env-var names and config-directory name — see
 * `archived provenance ledger` for the values a real adapter (e.g. the OD adapter) uses.
 */
export interface SandboxEnvConfig {
  /** Env var gating whether sandboxing is on (truthy/falsy string). */
  modeEnvVar: string;
  /** Env var carrying a PATH-delimiter-separated list of allowed import roots. */
  importAllowedRootsEnvVar: string;
  /** Env var carrying the sandbox data directory (required when sandboxing is on). */
  dataDirEnvVar: string;
  /** Env var the spawned process reads back for its agent-home directory. */
  agentHomeEnvVar: string;
  /** Env var the spawned process reads back for its local agent-profiles config path. */
  agentProfilesConfigEnvVar: string;
  /** Sub-directory name (under the agent home) local agent-profile config lives in. */
  agentProfilesDirName: string;
}

export interface SandboxRuntimeRoots {
  agentHomeDir: string;
  cacheDir: string;
  configDir: string;
  generatedFilesDir: string;
  logsDir: string;
  mcpConfigDir: string;
  pluginStateDir: string;
  previewStateDir: string;
  skillsCacheDir: string;
  tempDir: string;
  toolConfigDir: string;
}

export interface SandboxRuntimeConfig {
  enabled: boolean;
  dataDir: string;
  roots: SandboxRuntimeRoots;
}

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off', '']);

/**
 * Reads {@link SandboxEnvConfig.modeEnvVar} and interprets it as a boolean
 * flag. Throws if the value is set but neither a recognized truthy nor
 * falsy spelling.
 */
export function isSandboxModeEnabled(
  config: SandboxEnvConfig,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[config.modeEnvVar];
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  if (TRUTHY_VALUES.has(value)) return true;
  if (FALSY_VALUES.has(value)) return false;
  throw new Error(
    `${config.modeEnvVar} must be one of ${Array.from(TRUTHY_VALUES).join(', ')} ` +
      `or ${Array.from(FALSY_VALUES).join(', ')}`,
  );
}

function configuredSandboxImportRoots(
  config: SandboxEnvConfig,
  env: Record<string, string | undefined>,
): string[] {
  const raw = env[config.importAllowedRootsEnvVar];
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const roots = raw
    .split(path.delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
  const relativeRoot = roots.find((root) => !path.isAbsolute(path.normalize(root)));
  if (relativeRoot) {
    throw new Error(
      `${config.importAllowedRootsEnvVar} entries must be absolute paths. Got: ${relativeRoot}`,
    );
  }
  return roots;
}

function canonicalizePathForContainment(value: string): string {
  const resolved = path.normalize(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

// A containment *candidate* (e.g. a project root that hasn't been imported/
// created yet) may not fully exist on disk, so a bare realpath attempt
// throws. Unlike `canonicalizePathForContainment` above — used only for the
// *configured allowed roots*, which are expected to already exist when they
// matter — this walks up to the nearest existing ancestor, realpaths that,
// and rejoins the not-yet-existing suffix. Without this, comparing a raw
// candidate against a realpath'd allowed root misfires whenever the roots
// sit under a symlinked prefix (macOS's /tmp -> /private/tmp, /var ->
// /private/var): the candidate would keep the raw prefix while the allowed
// root was resolved through the symlink, so a legitimately-nested path
// would look like it climbs above the root.
function canonicalizeContainmentCandidate(value: string): string {
  const resolved = path.normalize(value);
  let existing = resolved;
  const trailingSegments: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(existing), ...trailingSegments);
    } catch {
      // `path.dirname(x) === x` is the fixed point for both an absolute
      // filesystem root ('/') and a relative reference ('.') — walking
      // further would just retry the same path forever, so bail out to the
      // raw normalized value instead of looping.
      const parent = path.dirname(existing);
      if (parent === existing) return resolved;
      trailingSegments.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

function isPathInsideDir(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * The configured, canonicalized set of directories an imported project root
 * is allowed to live under while sandboxing is on.
 */
export function sandboxImportAllowedRoots(
  config: SandboxEnvConfig,
  env: Record<string, string | undefined> = process.env,
): string[] {
  return configuredSandboxImportRoots(config, env).map(canonicalizePathForContainment);
}

/**
 * Whether `projectRoot` may be used as an imported-folder project while
 * sandboxing is enabled. Always `true` when sandboxing is off.
 */
export function isSandboxImportedProjectRootAllowed(
  config: SandboxEnvConfig,
  projectRoot: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!isSandboxModeEnabled(config, env)) return true;
  const candidate = canonicalizeContainmentCandidate(projectRoot);
  return sandboxImportAllowedRoots(config, env).some((root) => isPathInsideDir(root, candidate));
}

/**
 * A human-readable reason `projectRoot` is unavailable under sandboxing, or
 * `null` when it's allowed (including when sandboxing is off).
 */
export function sandboxImportedProjectRootUnavailableReason(
  config: SandboxEnvConfig,
  projectRoot: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!isSandboxModeEnabled(config, env)) return null;
  return isSandboxImportedProjectRootAllowed(config, projectRoot, env)
    ? null
    : `Imported-folder projects are not available in ${config.modeEnvVar} unless their root is ` +
        `under ${config.importAllowedRootsEnvVar}.`;
}

/**
 * Derives the full sandbox directory tree from a data directory. Pure —
 * does not touch the filesystem (see {@link ensureSandboxRuntimeDirs}).
 */
export function resolveSandboxRuntimeConfig(enabled: boolean, dataDir: string): SandboxRuntimeConfig {
  const sandboxRoot = path.join(dataDir, 'sandbox');
  return {
    enabled,
    dataDir,
    roots: {
      agentHomeDir: path.join(sandboxRoot, 'agent-home'),
      cacheDir: path.join(sandboxRoot, 'cache'),
      configDir: path.join(sandboxRoot, 'config'),
      generatedFilesDir: path.join(dataDir, 'generated-files'),
      logsDir: path.join(dataDir, 'logs'),
      mcpConfigDir: dataDir,
      pluginStateDir: path.join(dataDir, 'plugins'),
      previewStateDir: path.join(dataDir, 'previews'),
      skillsCacheDir: path.join(dataDir, 'skills'),
      tempDir: path.join(sandboxRoot, 'tmp'),
      toolConfigDir: path.join(sandboxRoot, 'tools'),
    },
  };
}

/**
 * Resolves the sandbox runtime config from environment variables, or `null`
 * when sandboxing is off. Throws when sandboxing is on but the data-dir env
 * var is unset.
 */
export function resolveSandboxRuntimeConfigFromEnv(
  config: SandboxEnvConfig,
  env: Record<string, string | undefined>,
  projectRoot: string,
): SandboxRuntimeConfig | null {
  if (!isSandboxModeEnabled(config, env)) return null;
  const rawDataDir = env[config.dataDirEnvVar]?.trim();
  if (!rawDataDir) {
    throw new Error(`${config.dataDirEnvVar} is required when ${config.modeEnvVar} is enabled`);
  }
  return resolveSandboxRuntimeConfig(true, resolveProjectRelativePath(rawDataDir, projectRoot));
}

/**
 * The path a spawned agent process's local agent-profiles config lives at,
 * under its sandboxed agent-home directory.
 */
export function sandboxAgentProfilesConfigPath(
  config: SandboxEnvConfig,
  runtime: SandboxRuntimeConfig,
): string {
  return path.join(runtime.roots.agentHomeDir, config.agentProfilesDirName, 'agents.local.json');
}

/**
 * Creates every directory in the sandbox tree (idempotent). No-op when
 * sandboxing is disabled.
 */
export function ensureSandboxRuntimeDirs(runtime: SandboxRuntimeConfig): void {
  if (!runtime.enabled) return;
  for (const dir of new Set(Object.values(runtime.roots))) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Overlays sandboxed HOME/XDG/TMPDIR/tool-config env vars onto `baseEnv` for
 * a spawned agent process. Returns `baseEnv` unchanged when sandboxing is
 * disabled.
 */
export function applySandboxRuntimeEnv(
  config: SandboxEnvConfig,
  baseEnv: NodeJS.ProcessEnv,
  runtime: SandboxRuntimeConfig,
): NodeJS.ProcessEnv {
  if (!runtime.enabled) return baseEnv;

  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const { roots } = runtime;
  const codexHome = path.join(roots.agentHomeDir, '.codex');
  const claudeConfigDir = path.join(roots.configDir, 'claude');
  const opencodeHome = path.join(roots.agentHomeDir, '.opencode');
  const npmUserConfig = path.join(roots.toolConfigDir, 'npmrc');

  env[config.modeEnvVar] = '1';
  env[config.dataDirEnvVar] = runtime.dataDir;
  env[config.agentHomeEnvVar] = roots.agentHomeDir;
  env.HOME = roots.agentHomeDir;
  env.USERPROFILE = roots.agentHomeDir;
  env.XDG_CONFIG_HOME = roots.configDir;
  env.XDG_CACHE_HOME = roots.cacheDir;
  env.XDG_DATA_HOME = path.join(roots.configDir, 'data');
  env.XDG_STATE_HOME = path.join(roots.configDir, 'state');
  env.TMPDIR = roots.tempDir;
  env.TEMP = roots.tempDir;
  env.TMP = roots.tempDir;
  env.CODEX_HOME = codexHome;
  env.CLAUDE_CONFIG_DIR = claudeConfigDir;
  env.OPENCODE_TEST_HOME = opencodeHome;
  env[config.agentProfilesConfigEnvVar] = sandboxAgentProfilesConfigPath(config, runtime);
  env.NPM_CONFIG_USERCONFIG = npmUserConfig;
  env.npm_config_userconfig = npmUserConfig;

  return env;
}
