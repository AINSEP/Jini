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
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter } from 'node:path';
import path from 'node:path';
import { homedir } from 'node:os';
import { wellKnownUserToolchainBins } from '@jini-ai/platform';
import { expandHomePath } from './paths.js';
import type { RuntimeAgentDef } from './types.js';

const AGENT_BIN_ENV_KEYS = new Map<string, string>([
  ['amr', 'VELA_BIN'],
  ['aider', 'AIDER_BIN'],
  ['auggie', 'AUGGIE_BIN'],
  ['claude', 'CLAUDE_BIN'],
  ['cline', 'CLINE_BIN'],
  ['codebuddy', 'CODEBUDDY_BIN'],
  ['codex', 'CODEX_BIN'],
  ['copilot', 'COPILOT_BIN'],
  ['crush', 'CRUSH_BIN'],
  ['cursor-agent', 'CURSOR_AGENT_BIN'],
  ['deepseek', 'DEEPSEEK_BIN'],
  ['devin', 'DEVIN_BIN'],
  ['droid', 'DROID_BIN'],
  ['goose', 'GOOSE_BIN'],
  ['hermes', 'HERMES_BIN'],
  ['kimi', 'KIMI_BIN'],
  ['kiro', 'KIRO_BIN'],
  ['kilo', 'KILO_BIN'],
  ['mimo', 'MIMO_BIN'],
  ['opencode', 'OPENCODE_BIN'],
  ['pi', 'PI_BIN'],
  ['qoder', 'QODER_BIN'],
  ['qwen', 'QWEN_BIN'],
  ['reasonix', 'REASONIX_BIN'],
  ['trae-cli', 'TRAE_CLI_BIN'],
  ['vibe', 'VIBE_BIN'],
]);

/** Host environment and runtime state used by executable resolution. */
export interface ExecutableResolutionOptions { env?: NodeJS.ProcessEnv; state?: AgentRuntimeState }

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
function resolveDetectionHome(options: ExecutableResolutionOptions = {}): { home: string; hasOverride: boolean } {
  const env = options.env ?? process.env;
  const homeOverride = env[(options.state ?? defaultRuntimeState).executable.envNames.agentHomeEnvVar];
  return { home: homeOverride || env.HOME || env.USERPROFILE || homedir(), hasOverride: Boolean(homeOverride) };
}

function userToolchainDirs(options: ExecutableResolutionOptions = {}) {
  const env = options.env ?? process.env;
  const cache = (options.state ?? defaultRuntimeState).executable;
  const { home, hasOverride } = resolveDetectionHome(options);
  // Every environment field the existing toolchain adapter consults participates in the cache key.
  const key = JSON.stringify([home, hasOverride, ...['VP_HOME', 'NPM_CONFIG_PREFIX', 'npm_config_prefix', 'APPDATA', 'LOCALAPPDATA', 'MISE_DATA_DIR', 'FNM_DIR'].map(name => env[name])]);
  const homeOverride = hasOverride ? home : undefined;
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
    includeSystemBins: process.platform !== 'win32' && !homeOverride,
    env: homeOverride ? {} : env,
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
  return userToolchainDirs(options);
}

function resolvePathDirs(options: ExecutableResolutionOptions = {}) {
  const env = options.env ?? process.env;
  const seen = new Set();
  const dirs = [
    ...(env.PATH || '').split(delimiter),
    // GUI launchers (macOS .app bundles, Linux .desktop files) often start
    // with a minimal PATH. Include common user-level CLI install locations
    // so agent detection matches the user's shell-installed tools,
    // especially Node version managers.
    ...userToolchainDirs(options),
  ];
  return dirs.filter((dir) => {
    if (!dir || seen.has(dir)) return false;
    seen.add(dir);
    return true;
  });
}

// The exact, de-duplicated directory list `resolveOnPath` walks. Surfaced so
// detection can attach it to a `not-on-path` diagnostic verbatim — the UI
// shows the user where we actually looked before asking them to set an
// explicit binary path, instead of recomputing PATH client-side.
export function agentSearchDirs(_required: Record<string, never> = {}, options: ExecutableResolutionOptions = {}): string[] {
  return resolvePathDirs(options);
}

// The `*_BIN` environment variable that overrides PATH detection for a given
// agent id (e.g. `cursor-agent` → `CURSOR_AGENT_BIN`), or null when the agent
// has no override key. Drives the `setEnv` / `clearEnv` fix intents.
export function agentBinEnvKey({ agentId }: { agentId: string | undefined }): string | null {
  if (!agentId) return null;
  return AGENT_BIN_ENV_KEYS.get(agentId) ?? null;
}

export function resolveOnPath({ bin }: { bin: string }, options: ExecutableResolutionOptions = {}): string | null {
  const env = options.env ?? process.env;
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
      : [''];
  const dirs = resolvePathDirs(options);
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      if (full && existsSync(full)) return full;
    }
  }
  return null;
}

function looksExecutableOnWindows(filePath: string, options: ExecutableResolutionOptions = {}): boolean {
  const env = options.env ?? process.env;
  const ext = path.extname(filePath).trim().toUpperCase();
  if (!ext) return false;
  const executableExts = (env.PATHEXT || '.EXE;.CMD;.BAT')
    .split(';')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return executableExts.includes(ext);
}

function executableFilePath(raw: string | undefined, options: ExecutableResolutionOptions = {}): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const expanded = expandHomePath({ value: raw.trim() });
  if (!path.isAbsolute(expanded)) return null;
  try {
    if (!statSync(expanded).isFile()) return null;
    if (process.platform === 'win32') {
      if (!looksExecutableOnWindows(expanded, options)) return null;
    } else {
      accessSync(expanded, constants.X_OK);
    }
    return expanded;
  } catch {
    return null;
  }
}

// Resolve the first available binary for an agent definition. Tries
// `def.bin` first, then walks `def.fallbackBins` in order. Used for agents
// whose forks ship under a different binary name but speak the exact same
// CLI. Returns null when no candidate is on PATH.
function configuredExecutableOverride(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
  options: ExecutableResolutionOptions = {},
): string | null {
  const envKey = AGENT_BIN_ENV_KEYS.get(def?.id);
  if (!envKey) return null;
  return executableFilePath(configuredEnv?.[envKey], options);
}

export function resolveAmrOpenCodeExecutable({  }: {  }, { env = process.env, state = defaultRuntimeState }: ExecutableResolutionOptions = {}
): string | null {
  const options = { env, state };
  const executableResolutionEnv = state.executable.envNames;
  const configured = executableFilePath(env.VELA_OPENCODE_BIN, options);
  if (configured) return configured;
  // In packaged builds prefer the bundled companion under
  // `<resourceRoot>/bin/libexec/opencode/opencode` so a stale global
  // `opencode` on the user's PATH can't override the known-good build that
  // shipped with this app. PATH is only consulted as a last resort.
  const resourceRoot = (
    env[executableResolutionEnv.resourceRootEnvVar]
  )?.trim();
  if (resourceRoot) {
    const bundledDir = packagedVelaOpenCodeCompanionTree(resourceRoot, options);
    if (bundledDir) {
      const bundled = executableFilePath(
        path.join(
          bundledDir,
          process.platform === 'win32' ? 'opencode.exe' : 'opencode',
        ), options,
      );
      if (bundled) return bundled;
    }
  }
  return resolveOnPath({ bin: 'opencode-cli' }, options) ?? resolveOnPath({ bin: 'opencode' }, options);
}

// The AMR (vela) OpenCode companion ships as a
// `<resourceRoot>/bin/libexec/opencode/opencode` *executable file*, not just
// the directory. Treating any directory there as a valid companion produces
// a false-positive availability path: `detectAgents()` would surface AMR as
// available even though the first real run can't launch. Verify the inner
// executable too.
function packagedVelaOpenCodeCompanionTree(resourceRoot: string, options: ExecutableResolutionOptions = {}): string | null {
  const candidate = path.join(resourceRoot, 'bin', 'libexec', 'opencode');
  const exe = path.join(
    candidate,
    process.platform === 'win32' ? 'opencode.exe' : 'opencode',
  );
  try {
    if (!statSync(candidate).isDirectory()) return null;
    if (!statSync(exe).isFile()) return null;
    if (process.platform === 'win32') {
      if (!looksExecutableOnWindows(exe, options)) return null;
    } else {
      accessSync(exe, constants.X_OK);
    }
    return candidate;
  } catch {
    return null;
  }
}

function packagedBuiltInExecutable(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
  options: ExecutableResolutionOptions = {},
): string | null {
  if (def.id !== 'amr') return null;
  const env = options.env ?? process.env;
  const executableResolutionEnv = (options.state ?? defaultRuntimeState).executable.envNames;
  const resourceRoot = env[executableResolutionEnv.resourceRootEnvVar]?.trim();
  if (!resourceRoot) return null;
  if (
    !resolveAmrOpenCodeExecutable({  }, { ...options, env: { ...env, ...configuredEnv } }) &&
    !packagedVelaOpenCodeCompanionTree(resourceRoot, options)
  ) {
    return null;
  }
  const candidate = path.join(
    resourceRoot,
    'bin',
    process.platform === 'win32' ? 'vela.exe' : 'vela',
  );
  try {
    if (!statSync(candidate).isFile()) return null;
    if (process.platform === 'win32') {
      if (!looksExecutableOnWindows(candidate, options)) return null;
    } else {
      accessSync(candidate, constants.X_OK);
    }
    return candidate;
  } catch {
    return null;
  }
}

// The official OpenAI Codex desktop app ships the `codex` CLI *inside* its
// macOS application bundle and does NOT add it to PATH unless the user
// explicitly runs the app's "Install command line tool" action. Users who
// installed Codex only through the app therefore see a "not installed"
// agent card even though a healthy native `codex` binary exists on disk,
// because neither PATH nor the user-toolchain search dirs cover the app
// bundle. Probe the well-known bundle locations so app-only installs are
// detected. This is a last-resort fallback that ranks below PATH, so an
// explicit `npm i -g` / Homebrew / version-manager install always wins.
function codexAppBundleExecutable(def: RuntimeAgentDef, options: ExecutableResolutionOptions = {}): string | null {
  if (def?.id !== 'codex') return null;
  for (const candidate of codexAppBundleCandidates({}, options)) {
    const resolved = executableFilePath(candidate, options);
    if (resolved) return resolved;
  }
  return null;
}

// Exported for tests: the no-override `/Applications` branch can't be
// exercised through `resolveAgentExecutable` deterministically (it would
// depend on the host actually having `/Applications/Codex.app`), so tests
// assert the built candidate list directly to catch a path typo or
// ordering regression in the common real-world install case.
export function codexAppBundleCandidates(_required: Record<string, never> = {}, options: ExecutableResolutionOptions = {}): string[] {
  // The Codex app bundle is a macOS-only concept; other platforms have no
  // analogous standalone install of the `codex` CLI to probe for here.
  if (process.platform !== 'darwin') return [];
  const { home, hasOverride } = resolveDetectionHome(options);
  const bundleSuffix = ['Codex.app', 'Contents', 'Resources', 'codex'];
  // User-scoped install (~/Applications). Honors the override home so
  // sandboxed detection runs and tests stay deterministic.
  const candidates = [path.join(home, 'Applications', ...bundleSuffix)];
  // System-wide /Applications install. Skip it under an override home for
  // the same isolation reason `userToolchainDirs` skips Homebrew/system
  // bins.
  if (!hasOverride) {
    candidates.unshift(path.join('/Applications', ...bundleSuffix));
  }
  return candidates;
}

export function resolveAgentExecutable({ def }: { def: RuntimeAgentDef }, options: ExecutableResolutionOptions & { configuredEnv?: Record<string, string> } = {}
): string | null {
  return inspectAgentExecutableResolution({ def: def }, options).selectedPath;
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
  const configuredEnv = options.configuredEnv ?? {};
  const configuredOverridePath = configuredExecutableOverride(def, configuredEnv, options);
  const candidates = [
    def.bin,
    ...(Array.isArray(def.fallbackBins) ? def.fallbackBins : []),
  ];
  let pathResolvedPath: string | null = null;
  for (const bin of candidates) {
    const resolved = resolveOnPath({ bin: bin }, options);
    if (resolved) {
      pathResolvedPath = resolved;
      break;
    }
  }
  const builtInPath = packagedBuiltInExecutable(def, configuredEnv, options);
  const appBundlePath = codexAppBundleExecutable(def, options);
  return {
    configuredOverridePath,
    pathResolvedPath,
    selectedPath:
      configuredOverridePath || builtInPath || pathResolvedPath || appBundlePath,
  };
}
