import { defaultRuntimeState, type AgentRuntimeState } from './runtime-state.js';
/**
 * @module executables
 *
 * Resolves an agent's executable path: `*_BIN` env overrides, PATH search
 * (including user-toolchain bin dirs), a resource-root-relative packaged
 * binary, and (macOS only) a well-known app-bundle install.
 *
 * Ported from OD's `apps/daemon/src/runtimes/executables.ts` with two
 * changes:
 *
 * 1. `wellKnownUserToolchainBins` now comes from `@jini-ai/platform` instead of
 *    the OD workspace package it originally shipped from (same function,
 *    already verbatim-lifted — see `@jini-ai/platform`'s own `archived provenance ledger`).
 * 2. De-branded: the origin's product-prefixed agent-home / resource-root
 *    env var names and its sandbox-runtime-config integration (an
 *    OD-daemon-level subsystem out of this package's charter) are replaced
 *    by `configureExecutableResolutionEnv()` — an injectable pair of
 *    env-var names, defaulting to `AGENT_RUNTIME_HOME` /
 *    `AGENT_RUNTIME_RESOURCE_ROOT`, with no sandbox dependency. See
 *    `archived provenance ledger` for the exact original names.
 */
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter } from 'node:path';
import path from 'node:path';
import { homedir } from 'node:os';
import { wellKnownUserToolchainBins } from '@jini-ai/platform/toolchain';
import { expandHomePath } from './paths.js';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import type { ExecutableResolutionHelpers, ResolvedExecutableOptions } from './executable-helpers.js';
import { packagedAmrExecutable, resolveAmrCompanion } from './defs/amr/executable-resolution.js';
import { codexAppBundleExecutable, codexBundleCandidates } from './defs/codex/executable-resolution.js';

import { amrBinEnvKey } from './defs/amr/executable.js';
import { aiderBinEnvKey } from './defs/aider/executable.js';
import { auggieBinEnvKey } from './defs/auggie/executable.js';
import { claudeBinEnvKey } from './defs/claude/executable.js';
import { clineBinEnvKey } from './defs/cline/executable.js';
import { codebuddyBinEnvKey } from './defs/codebuddy/executable.js';
import { codexBinEnvKey } from './defs/codex/executable.js';
import { crushBinEnvKey } from './defs/crush/executable.js';
import { cursorAgentBinEnvKey } from './defs/cursor-agent/executable.js';
import { deepseekBinEnvKey } from './defs/deepseek/executable.js';
import { devinBinEnvKey } from './defs/devin/executable.js';
import { droidBinEnvKey } from './defs/droid/executable.js';
import { gooseBinEnvKey } from './defs/goose/executable.js';
import { hermesBinEnvKey } from './defs/hermes/executable.js';
import { kimiBinEnvKey } from './defs/kimi/executable.js';
import { kiroBinEnvKey } from './defs/kiro/executable.js';
import { kiloBinEnvKey } from './defs/kilo/executable.js';
import { mimoBinEnvKey } from './defs/mimo/executable.js';
import { opencodeBinEnvKey } from './defs/opencode/executable.js';
import { piBinEnvKey } from './defs/pi/executable.js';
import { qoderBinEnvKey } from './defs/qoder/executable.js';
import { qwenBinEnvKey } from './defs/qwen/executable.js';
import { reasonixBinEnvKey } from './defs/reasonix/executable.js';
import { traeCliBinEnvKey } from './defs/trae-cli/executable.js';
import { vibeBinEnvKey } from './defs/vibe/executable.js';

const AGENT_BIN_ENV_KEYS = new Map<string, string>([
  ['amr', amrBinEnvKey],
  ['aider', aiderBinEnvKey],
  ['auggie', auggieBinEnvKey],
  ['claude', claudeBinEnvKey],
  ['cline', clineBinEnvKey],
  ['codebuddy', codebuddyBinEnvKey],
  ['codex', codexBinEnvKey],
  ['crush', crushBinEnvKey],
  ['cursor-agent', cursorAgentBinEnvKey],
  ['deepseek', deepseekBinEnvKey],
  ['devin', devinBinEnvKey],
  ['droid', droidBinEnvKey],
  ['goose', gooseBinEnvKey],
  ['hermes', hermesBinEnvKey],
  ['kimi', kimiBinEnvKey],
  ['kiro', kiroBinEnvKey],
  ['kilo', kiloBinEnvKey],
  ['mimo', mimoBinEnvKey],
  ['opencode', opencodeBinEnvKey],
  ['pi', piBinEnvKey],
  ['qoder', qoderBinEnvKey],
  ['qwen', qwenBinEnvKey],
  ['reasonix', reasonixBinEnvKey],
  ['trae-cli', traeCliBinEnvKey],
  ['vibe', vibeBinEnvKey],
]);

/** Host environment and runtime state used by executable resolution. */
export interface ExecutableResolutionOptions { env?: NodeJS.ProcessEnv; state?: AgentRuntimeState }

// Options with the process-level defaults applied once at the public entry
// point, so internal helpers never re-derive them.
type ResolvedOptions = ResolvedExecutableOptions;

function withDefaults(options: ExecutableResolutionOptions): ResolvedOptions {
  return { env: options.env ?? process.env, state: options.state ?? defaultRuntimeState };
}

// `<name>.exe` on Windows, `<name>` elsewhere.
function platformExecutableName({ name }: { name: string }): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function pathExtEntries(env: NodeJS.ProcessEnv): string[] {
  return (env.PATHEXT || '.EXE;.CMD;.BAT').split(';');
}

/**
 * Override the env var names `resolveDetectionHome` / the packaged-binary
 * lookup read. The host application (e.g. the OD adapter) calls this once
 * at startup if it wants its own namespaced env vars instead of the
 * generic defaults.
 */
export function configureExecutableResolutionEnv({ overrides }: { overrides: {
  agentHomeEnvVar?: string;
  resourceRootEnvVar?: string;
} }, { state = defaultRuntimeState }: { state?: AgentRuntimeState } = {}): void {
  const executableResolutionEnv = state.executable.envNames;
  if (overrides.agentHomeEnvVar) executableResolutionEnv.agentHomeEnvVar = overrides.agentHomeEnvVar;
  if (overrides.resourceRootEnvVar) executableResolutionEnv.resourceRootEnvVar = overrides.resourceRootEnvVar;
}

const TOOLCHAIN_DIR_CACHE_TTL_MS = 5000;
// Toolchain cache and env names live with the injected host state.

// Resolve the home directory detection should search, honoring the
// configured agent-home override env var. `hasOverride` lets callers scope
// strictly to the override home (skipping real-machine system locations) so
// sandboxed detection runs and tests stay deterministic instead of
// reaching the host.
function resolveDetectionHome({ env, state }: ResolvedOptions): { home: string; hasOverride: boolean } {
  const homeOverride = env[state.executable.envNames.agentHomeEnvVar];
  return { home: homeOverride || env.HOME || env.USERPROFILE || homedir(), hasOverride: Boolean(homeOverride) };
}

function userToolchainDirs(options: ResolvedOptions): string[] {
  const { env } = options;
  const cache = options.state.executable;
  const { home, hasOverride } = resolveDetectionHome(options);
  // Every environment field the existing toolchain adapter consults participates in the cache key.
  const key = JSON.stringify([home, hasOverride, ...['VP_HOME', 'NPM_CONFIG_PREFIX', 'npm_config_prefix', 'APPDATA', 'LOCALAPPDATA', 'MISE_DATA_DIR', 'FNM_DIR'].map(name => env[name])]);
  const now = Date.now();
  if (
    cache.toolchainKey === key &&
    cache.toolchainDirs &&
    now - cache.toolchainDirsAt < TOOLCHAIN_DIR_CACHE_TTL_MS
  ) {
    return cache.toolchainDirs;
  }
  cache.toolchainKey = key;
  cache.toolchainDirsAt = now;
  // When the agent-home override is set, scope the search strictly to the
  // override home: skip Homebrew / /usr/local *and* pass an empty env so
  // that a developer or CI runner with NPM_CONFIG_PREFIX /
  // npm_config_prefix exported can't leak the real machine's <prefix>/bin
  // into a sandboxed detection run. Without this, tests that build a tmp
  // home would be machine-environment-dependent.
  cache.toolchainDirs = wellKnownUserToolchainBins({
    home,
    includeSystemBins: process.platform !== 'win32' && !hasOverride,
    env: hasOverride ? {} : env,
  });
  return cache.toolchainDirs;
}

// The user-level toolchain bin directories (Homebrew, ~/.local/bin, ~/.bun/bin,
// version-manager node dirs, npm prefixes, …) that binary *resolution* searches
// beyond process.env.PATH. Exposed so the spawn env can append the same dirs:
// a binary can resolve here yet fail to *execute* if its shebang interpreter
// (e.g. `#!/usr/bin/env bun`) lives in one of these dirs and the spawn PATH
// doesn't include it. Keeping resolution and spawn PATH symmetric fixes that.
export function userToolchainBinDirs(_required: Record<string, never> = {}, options: ExecutableResolutionOptions = {}): string[] {
  return userToolchainDirs(withDefaults(options));
}

function resolvePathDirs(options: ResolvedOptions): string[] {
  const seen = new Set();
  const dirs = [
    ...(options.env.PATH || '').split(delimiter),
    // GUI launchers (macOS .app bundles, Linux .desktop files) often start
    // with a minimal PATH. Include common user-level CLI install locations
    // so agent detection matches the user's shell-installed tools,
    // especially Node version managers.
    ...userToolchainDirs(options),
  ];
  return dirs.filter((dir) => {
    if (!path.isAbsolute(dir) || seen.has(dir)) return false;
    seen.add(dir);
    return true;
  });
}

// The exact, de-duplicated directory list `resolveOnPath` walks. Surfaced so
// detection can attach it to a `not-on-path` diagnostic verbatim — the UI
// shows the user where we actually looked before asking them to set an
// explicit binary path, instead of recomputing PATH client-side.
export function agentSearchDirs(_required: Record<string, never> = {}, options: ExecutableResolutionOptions = {}): string[] {
  return resolvePathDirs(withDefaults(options));
}

// The `*_BIN` environment variable that overrides PATH detection for a given
// agent id (e.g. `cursor-agent` → `CURSOR_AGENT_BIN`), or null when the agent
// has no override key. Drives the `setEnv` / `clearEnv` fix intents.
export function agentBinEnvKey({ agentId }: { agentId: string | undefined }): string | null {
  if (!agentId) return null;
  return AGENT_BIN_ENV_KEYS.get(agentId) ?? null;
}

export function resolveOnPath({ bin }: { bin: string }, options: ExecutableResolutionOptions = {}): string | null {
  return searchPath({ bin }, withDefaults(options));
}

function searchPath({ bin }: { bin: string }, options: ResolvedOptions): string | null {
  const exts = process.platform === 'win32' ? pathExtEntries(options.env) : [''];
  for (const dir of resolvePathDirs(options)) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      const executable = executableFilePath(full, options);
      if (executable) return executable;
    }
  }
  return null;
}

function looksExecutableOnWindows(filePath: string, { env }: ResolvedOptions): boolean {
  const ext = path.extname(filePath).trim().toUpperCase();
  if (!ext) return false;
  const executableExts = pathExtEntries(env)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return executableExts.includes(ext);
}

// A regular file the host may launch: on Windows its extension must be in
// PATHEXT, elsewhere it must carry the execute permission. Any stat/access
// failure (missing, unreadable) counts as "not runnable".
function isRunnableFile(filePath: string, options: ResolvedOptions): boolean {
  try {
    if (!statSync(filePath).isFile()) return false;
    if (process.platform === 'win32') return looksExecutableOnWindows(filePath, options);
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableFilePath(raw: string | undefined, options: ResolvedOptions): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const { env } = options;
  // `~` in an override expands from the supplied env, so sandboxed detection never reaches the real home.
  const expanded = expandHomePath({ value: raw.trim() }, { home: env.HOME || env.USERPROFILE || homedir() });
  if (!path.isAbsolute(expanded)) return null;
  return isRunnableFile(expanded, options) ? expanded : null;
}

function configuredExecutableOverride(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string>,
  options: ResolvedOptions,
): string | null {
  const envKey = AGENT_BIN_ENV_KEYS.get(def?.id);
  if (!envKey) return null;
  return executableFilePath(configuredEnv?.[envKey], options);
}

function resourceRootOf({ env, state }: ResolvedOptions): string | undefined {
  return env[state.executable.envNames.resourceRootEnvVar]?.trim();
}

const EXECUTABLE_HELPERS: ExecutableResolutionHelpers = {
  executableFilePath, isRunnableFile, searchPath, platformExecutableName, resourceRootOf, resolveDetectionHome,
};
const PACKAGED_EXECUTABLES: ReadonlyMap<string, typeof packagedAmrExecutable> = new Map([['amr', packagedAmrExecutable]]);
const APP_BUNDLE_EXECUTABLES: ReadonlyMap<string, typeof codexAppBundleExecutable> = new Map([['codex', codexAppBundleExecutable]]);

export function resolveAmrOpenCodeExecutable({  }: {  }, { env = process.env, state = defaultRuntimeState }: ExecutableResolutionOptions = {}): string | null {
  return resolveAmrCompanion({ env, state }, EXECUTABLE_HELPERS);
}

// Exported for tests: the no-override `/Applications` branch can't be
// exercised through `resolveAgentExecutable` deterministically (it would
// depend on the host actually having `/Applications/Codex.app`), so tests
// assert the built candidate list directly to catch a path typo or
// ordering regression in the common real-world install case.
export function codexAppBundleCandidates(_required: Record<string, never> = {}, options: ExecutableResolutionOptions = {}): string[] {
  return codexBundleCandidates(withDefaults(options), EXECUTABLE_HELPERS);
}

// Resolve the first available binary for an agent definition. Tries
// `def.bin` first, then walks `def.fallbackBins` in order. Used for agents
// whose forks ship under a different binary name but speak the exact same
// CLI. Returns null when no candidate is on PATH.
function firstBinOnPath(def: RuntimeAgentDef, options: ResolvedOptions): string | null {
  const candidates = [
    def.bin,
    ...(Array.isArray(def.fallbackBins) ? def.fallbackBins : []),
  ];
  for (const bin of candidates) {
    const resolved = searchPath({ bin }, options);
    if (resolved) return resolved;
  }
  return null;
}

export function resolveAgentExecutable({ def }: { def: RuntimeAgentDef }, options: ExecutableResolutionOptions & { configuredEnv?: Record<string, string> } = {}
): string | null {
  return inspectAgentExecutableResolution({ def: def }, options).selectedPath;
}

function bundledExecutablePaths(def: RuntimeAgentDef, configuredEnv: Record<string, string>, resolved: ResolvedOptions) {
  const builtInPath = PACKAGED_EXECUTABLES.get(def.id)?.(configuredEnv, resolved, EXECUTABLE_HELPERS) ?? null;
  const appBundlePath = APP_BUNDLE_EXECUTABLES.get(def.id)?.(resolved, EXECUTABLE_HELPERS) ?? null;
  return { builtInPath, appBundlePath };
}

export function inspectAgentExecutableResolution({ def }: { def: RuntimeAgentDef }, options: ExecutableResolutionOptions & { configuredEnv?: Record<string, string> } = {}
): {
  configuredOverridePath: string | null;
  pathResolvedPath: string | null;
  selectedPath: string | null;
} {
  if (!def?.bin) {
    return {
      configuredOverridePath: null,
      pathResolvedPath: null,
      selectedPath: null,
    };
  }
  const resolved = withDefaults(options);
  const configuredEnv = options.configuredEnv ?? {};
  const configuredOverridePath = configuredExecutableOverride(def, configuredEnv, resolved);
  const pathResolvedPath = firstBinOnPath(def, resolved);
  const { builtInPath, appBundlePath } = bundledExecutablePaths(def, configuredEnv, resolved);
  return {
    configuredOverridePath,
    pathResolvedPath,
    selectedPath:
      configuredOverridePath || builtInPath || pathResolvedPath || appBundlePath,
  };
}
