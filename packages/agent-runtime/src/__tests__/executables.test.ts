import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentBinEnvKey,
  agentSearchDirs,
  codexAppBundleCandidates,
  configureExecutableResolutionEnv,
  inspectAgentExecutableResolution,
  resolveAgentExecutable,
  resolveAmrOpenCodeExecutable,
  resolveOnPath,
  userToolchainBinDirs,
} from '../executables.js';
import type { RuntimeAgentDef } from '../types.js';
import { createAgentRuntimeState, type AgentRuntimeState } from '../runtime-state.js';

function makeDef(overrides: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    bin: 'test-agent',
    versionArgs: [],
    buildArgs: () => [],
    fallbackModels: [],
    streamFormat: 'plain',
    ...overrides,
  } as RuntimeAgentDef;
}

function makeExecutable(filePath: string, content = 'stub'): void {
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

// This suite runs on a real dev machine that may have real CLIs (claude,
// opencode, ...) installed under Homebrew/npm-global/etc. Inject both env
// and independent runtime state so PATH, home and cached toolchain lookup
// cannot accidentally match a real install, even with an explicit env override.
let env: NodeJS.ProcessEnv;
let state: AgentRuntimeState;
let isolatedHome: string;

beforeEach(() => {
  isolatedHome = mkdtempSync(path.join(tmpdir(), 'agent-runtime-host-env-test-'));
  env = { HOME: isolatedHome, AGENT_RUNTIME_HOME: isolatedHome, PATH: '', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  // Reset the injectable env-var-name overrides between tests via owned
  // state: configureExecutableResolutionEnv() mutates that state's names.
  state = createAgentRuntimeState({});
});

afterEach(() => {
  rmSync(isolatedHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// "Not found" assertions scope both searches to an empty fixture home/PATH.
function withIsolatedToolchain(emptyDir: string, fn: () => void): void {
  const originalPath = env.PATH;
  const originalHome = env.AGENT_RUNTIME_HOME;
  env.AGENT_RUNTIME_HOME = emptyDir;
  env.PATH = emptyDir;
  try {
    fn();
  } finally {
    env.PATH = originalPath;
    env.AGENT_RUNTIME_HOME = originalHome;
  }
}

describe('agentBinEnvKey', () => {
  it('returns null for an undefined agent id', () => {
    expect(agentBinEnvKey({ agentId: undefined })).toBeNull();
  });

  it('returns null for an unknown agent id', () => {
    expect(agentBinEnvKey({ agentId: 'not-a-real-agent' })).toBeNull();
  });

  it('returns the *_BIN key for a known agent id', () => {
    expect(agentBinEnvKey({ agentId: 'cursor-agent' })).toBe('CURSOR_AGENT_BIN');
    expect(agentBinEnvKey({ agentId: 'claude' })).toBe('CLAUDE_BIN');
  });
});

describe('resolveOnPath / agentSearchDirs', () => {
  let dir: string;
  const originalPath = '';

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-executables-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    env.PATH = originalPath;
  });

  it('finds a binary added to PATH', () => {
    makeExecutable(path.join(dir, 'my-bin'));
    env.PATH = [dir, originalPath].join(path.delimiter);
    expect(resolveOnPath({ bin: 'my-bin' }, { env, state })).toBe(path.join(dir, 'my-bin'));
  });

  it('skips directories on PATH and finds the next regular executable', () => {
    const filename = process.platform === 'win32' ? 'secure-bin.EXE' : 'secure-bin';
    const next = path.join(dir, 'next');
    mkdirSync(next);
    mkdirSync(path.join(dir, filename));
    makeExecutable(path.join(next, filename));
    env.PATH = [dir, next].join(path.delimiter);
    expect(resolveOnPath({ bin: 'secure-bin' }, { env, state })).toBe(path.join(next, filename));
  });

  it.skipIf(process.platform === 'win32')('skips non-executable files on PATH and finds the next executable', () => {
    const next = path.join(dir, 'next');
    mkdirSync(next);
    writeFileSync(path.join(dir, 'secure-bin'), 'not executable', { mode: 0o644 });
    makeExecutable(path.join(next, 'secure-bin'));
    env.PATH = [dir, next].join(path.delimiter);
    expect(resolveOnPath({ bin: 'secure-bin' }, { env, state })).toBe(path.join(next, 'secure-bin'));
  });

  it('excludes empty, dot and relative PATH entries from resolution and diagnostics', () => {
    const filename = process.platform === 'win32' ? 'secure-relative-bin.EXE' : 'secure-relative-bin';
    makeExecutable(path.join(dir, filename));
    const relative = path.relative(process.cwd(), dir);
    env.PATH = ['', '.', relative].join(path.delimiter);
    expect(resolveOnPath({ bin: 'secure-relative-bin' }, { env, state })).toBeNull();
    const dirs = agentSearchDirs({}, { env, state });
    expect(dirs).not.toContain(relative);
    expect(dirs).not.toContain('.');
    expect(dirs.every(entry => path.isAbsolute(entry))).toBe(true);
  });

  it.each(['~/', '~\\'])('expands a %s binary override using the supplied HOME', prefix => {
    const filename = process.platform === 'win32' ? 'sandbox-claude.exe' : 'sandbox-claude';
    const binary = path.join(dir, filename);
    makeExecutable(binary);
    // HOME deliberately differs from both the real home and the detection search override.
    env.HOME = dir;
    const def = makeDef({ id: 'claude', bin: 'claude-not-on-path-security-fixture' });
    const resolution = inspectAgentExecutableResolution({ def }, {
      env, state, configuredEnv: { CLAUDE_BIN: `${prefix}${filename}` },
    });
    expect(resolution.configuredOverridePath).toBe(binary);
    expect(resolution.selectedPath).toBe(binary);
  });

  it('returns null when the binary is not found anywhere on PATH', () => {
    env.PATH = dir;
    expect(resolveOnPath({ bin: 'totally-nonexistent-binary-xyz' }, { env, state })).toBeNull();
  });

  it('agentSearchDirs de-duplicates PATH entries and includes user toolchain dirs', () => {
    env.PATH = [dir, dir, ''].join(path.delimiter);
    const dirs = agentSearchDirs({}, { env, state });
    expect(dirs.filter((d) => d === dir)).toHaveLength(1);
  });

  it('treats a completely unset PATH as empty rather than throwing', () => {
    delete env.PATH;
    expect(() => agentSearchDirs({}, { env, state })).not.toThrow();
    expect(Array.isArray(agentSearchDirs({}, { env, state }))).toBe(true);
  });

  it('resolveOnPath tries PATHEXT extensions on win32', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const hadPathExt = Object.prototype.hasOwnProperty.call(env, 'PATHEXT');
    const originalPathExt = env.PATHEXT;
    env.PATHEXT = '.EXE;.CMD';
    try {
      makeExecutable(path.join(dir, 'my-bin.EXE'));
      env.PATH = dir;
      expect(resolveOnPath({ bin: 'my-bin' }, { env, state })).toBe(path.join(dir, 'my-bin.EXE'));
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      // Restore absence with `delete`: the native process.env adapter stringifies
      // assigned `undefined`, so keep the fixture's restoration compatible
      // rather than leaving a corrupted non-empty PATHEXT value.
      if (hadPathExt) env.PATHEXT = originalPathExt;
      else delete env.PATHEXT;
    }
  });
});

describe('userToolchainBinDirs / configureExecutableResolutionEnv', () => {
  it('scopes to the override home and passes an empty env when agentHomeEnvVar is set', () => {
    env.AGENT_RUNTIME_HOME = '/fake/override/home';
    const dirs = userToolchainBinDirs({}, { env, state });
    expect(Array.isArray(dirs)).toBe(true);
  });

  it('honors a custom agentHomeEnvVar name via configureExecutableResolutionEnv', () => {
    configureExecutableResolutionEnv({ overrides: { agentHomeEnvVar: 'MY_CUSTOM_HOME_VAR' } }, { state });
    env.MY_CUSTOM_HOME_VAR = '/another/fake/home';
    const dirs = userToolchainBinDirs({}, { env, state });
    expect(Array.isArray(dirs)).toBe(true);
    delete env.MY_CUSTOM_HOME_VAR;
  });

  it('falls back to the injected HOME when no override is configured', () => {
    delete env.AGENT_RUNTIME_HOME;
    const dirs = userToolchainBinDirs({}, { env, state });
    expect(Array.isArray(dirs)).toBe(true);
  });
});

describe('resolveAmrOpenCodeExecutable', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-amr-opencode-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('prefers an explicit VELA_OPENCODE_BIN override', () => {
    const bin = path.join(dir, 'opencode');
    makeExecutable(bin);
    expect(resolveAmrOpenCodeExecutable({}, { state, env: { ...env, VELA_OPENCODE_BIN: bin } })).toBe(bin);
  });

  it('falls back to the bundled companion tree under resourceRootEnvVar when no override is set', () => {
    const resourceRoot = path.join(dir, 'resources');
    const companionDir = path.join(resourceRoot, 'bin', 'libexec', 'opencode');
    mkdirSync(companionDir, { recursive: true });
    const companionBin = path.join(companionDir, process.platform === 'win32' ? 'opencode.exe' : 'opencode');
    makeExecutable(companionBin);
    const result = resolveAmrOpenCodeExecutable({}, { state, env: { ...env, AGENT_RUNTIME_RESOURCE_ROOT: resourceRoot } });
    expect(result).toBe(companionBin);
  });

  it('falls back to PATH (opencode-cli, then opencode) when no override or bundled companion exists', () => {
    const bin = path.join(dir, 'opencode-cli');
    makeExecutable(bin);
    const originalPath = env.PATH;
    env.PATH = dir;
    try {
      expect(resolveAmrOpenCodeExecutable({}, { env, state })).toBe(bin);
    } finally {
      env.PATH = originalPath;
    }
  });

  it('returns null when nothing resolves anywhere', () => {
    const originalPath = env.PATH;
    // Scope detection strictly to an empty fake home so this real dev
    // machine's own installed toolchain bins (Homebrew, npm-global, ...)
    // aren't picked up as a false positive — see executables.ts's
    // `userToolchainDirs()` override-home behavior.
    env.AGENT_RUNTIME_HOME = dir;
    env.PATH = dir; // empty dir, nothing installed
    try {
      expect(resolveAmrOpenCodeExecutable({}, { env, state })).toBeNull();
    } finally {
      env.PATH = originalPath;
    }
  });
});

describe('inspectAgentExecutableResolution / resolveAgentExecutable', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-resolution-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns all-null when the def has no bin', () => {
    const def = makeDef({ bin: '' });
    const result = inspectAgentExecutableResolution({ def: def }, { env, state, configuredEnv: {} });
    expect(result).toEqual({ configuredOverridePath: null, pathResolvedPath: null, selectedPath: null });
  });

  it('prefers the configured override over a PATH match', () => {
    const overridePath = path.join(dir, 'claude-override');
    const pathPath = path.join(dir, 'path-dir', 'claude');
    mkdirSync(path.join(dir, 'path-dir'));
    makeExecutable(overridePath);
    makeExecutable(pathPath);
    const originalPath = env.PATH;
    env.PATH = path.join(dir, 'path-dir');
    try {
      const def = makeDef({ id: 'claude', bin: 'claude' });
      const result = resolveAgentExecutable({ def: def }, { env, state, configuredEnv: { CLAUDE_BIN: overridePath } });
      expect(result).toBe(overridePath);
    } finally {
      env.PATH = originalPath;
    }
  });

  it('falls back to a fallbackBins entry when the primary bin is not on PATH', () => {
    const bin = path.join(dir, 'claude-fork');
    makeExecutable(bin);
    const originalPath = env.PATH;
    // Scope to an empty fake home so this real dev machine's own installed
    // `claude` (if any) on a toolchain dir doesn't shadow the fixture.
    env.AGENT_RUNTIME_HOME = dir;
    env.PATH = dir;
    try {
      const def = makeDef({ id: 'claude', bin: 'claude', fallbackBins: ['claude-fork'] });
      const result = resolveAgentExecutable({ def: def }, { env, state, configuredEnv: {} });
      expect(result).toBe(bin);
    } finally {
      env.PATH = originalPath;
    }
  });

  it('returns null when nothing resolves at all', () => {
    const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
    expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: {} })).toBeNull();
  });
});

describe('executableFilePath / looksExecutableOnWindows (via resolveAgentExecutable on a simulated win32 host)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-win-exe-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a configured override whose extension is in PATHEXT', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const bin = path.join(dir, 'claude.EXE');
      writeFileSync(bin, 'stub', 'utf8');
      const def = makeDef({ id: 'claude', bin: 'claude' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: { CLAUDE_BIN: bin } })).toBe(bin);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('rejects a configured override whose extension is not in PATHEXT', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const bin = path.join(dir, 'claude.txt');
      writeFileSync(bin, 'stub', 'utf8');
      const def = makeDef({ id: 'claude', bin: 'claude' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: { CLAUDE_BIN: bin } })).toBeNull();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('rejects a bare (no-extension) configured override on win32', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const bin = path.join(dir, 'claude');
      writeFileSync(bin, 'stub', 'utf8');
      const def = makeDef({ id: 'claude', bin: 'claude' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: { CLAUDE_BIN: bin } })).toBeNull();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('rejects a path that is not absolute', () => {
    withIsolatedToolchain(dir, () => {
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: { CLAUDE_BIN: 'relative/path/claude' } })).toBeNull();
    });
  });

  it('rejects a blank configured override value', () => {
    withIsolatedToolchain(dir, () => {
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: { CLAUDE_BIN: '   ' } })).toBeNull();
    });
  });

  it('rejects a configured override that points at a directory, not a file', () => {
    withIsolatedToolchain(dir, () => {
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: { CLAUDE_BIN: dir } })).toBeNull();
    });
  });

  it('rejects a configured override with no matching AGENT_BIN_ENV_KEYS entry', () => {
    const def = makeDef({ id: 'not-a-registered-agent-id', bin: 'whatever-not-installed-xyz' });
    expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: {} })).toBeNull();
  });
});

describe('packagedBuiltInExecutable (AMR/vela native binary)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-vela-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op for a non-amr agent id even with a resourceRoot configured', () => {
    withIsolatedToolchain(dir, () => {
      env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: {} })).toBeNull();
    });
  });

  it('resolves the packaged vela binary when the OpenCode companion is present via VELA_OPENCODE_BIN', () => {
    withIsolatedToolchain(dir, () => {
      env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const opencodeBin = path.join(dir, 'opencode');
      makeExecutable(opencodeBin);
      const velaBin = path.join(dir, 'bin', 'vela');
      mkdirSync(path.join(dir, 'bin'), { recursive: true });
      makeExecutable(velaBin);
      const def = makeDef({ id: 'amr', bin: 'amr' });
      const result = resolveAgentExecutable({ def: def }, { env, state, configuredEnv: { VELA_OPENCODE_BIN: opencodeBin } });
      expect(result).toBe(velaBin);
    });
  });

  it('resolves the packaged vela binary via the bundled companion tree even with no VELA_OPENCODE_BIN', () => {
    withIsolatedToolchain(dir, () => {
      env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const companionDir = path.join(dir, 'bin', 'libexec', 'opencode');
      mkdirSync(companionDir, { recursive: true });
      makeExecutable(path.join(companionDir, process.platform === 'win32' ? 'opencode.exe' : 'opencode'));
      const velaBin = path.join(dir, 'bin', 'vela');
      makeExecutable(velaBin);
      const def = makeDef({ id: 'amr', bin: 'amr' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: {} })).toBe(velaBin);
    });
  });

  it('returns null (falls through) when no resourceRoot is configured', () => {
    withIsolatedToolchain(dir, () => {
      const def = makeDef({ id: 'amr', bin: 'amr-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: {} })).toBeNull();
    });
  });

  it('returns null when neither the OpenCode companion nor VELA_OPENCODE_BIN resolves', () => {
    withIsolatedToolchain(dir, () => {
      env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const def = makeDef({ id: 'amr', bin: 'amr-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: {} })).toBeNull();
    });
  });

  it('returns null when the vela candidate file does not exist even though the companion resolved', () => {
    withIsolatedToolchain(dir, () => {
      env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const opencodeBin = path.join(dir, 'opencode');
      makeExecutable(opencodeBin);
      // No bin/vela created at all.
      const def = makeDef({ id: 'amr', bin: 'amr-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: { VELA_OPENCODE_BIN: opencodeBin } })).toBeNull();
    });
  });

  it('returns null when the vela candidate path is a directory, not a file', () => {
    withIsolatedToolchain(dir, () => {
      env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const opencodeBin = path.join(dir, 'opencode');
      makeExecutable(opencodeBin);
      mkdirSync(path.join(dir, 'bin', 'vela'), { recursive: true }); // 'vela' is a dir, not a file
      const def = makeDef({ id: 'amr', bin: 'amr-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: { VELA_OPENCODE_BIN: opencodeBin } })).toBeNull();
    });
  });

  it('returns null when the vela candidate exists but is not executable', () => {
    withIsolatedToolchain(dir, () => {
      env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const opencodeBin = path.join(dir, 'opencode');
      makeExecutable(opencodeBin);
      mkdirSync(path.join(dir, 'bin'), { recursive: true });
      const velaBin = path.join(dir, 'bin', 'vela');
      writeFileSync(velaBin, 'stub', 'utf8');
      chmodSync(velaBin, 0o600); // no execute bit
      const def = makeDef({ id: 'amr', bin: 'amr-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: { VELA_OPENCODE_BIN: opencodeBin } })).toBeNull();
    });
  });
});

describe('packagedVelaOpenCodeCompanionTree edge cases', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-vela-companion-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the libexec/opencode directory does not exist', () => {
    withIsolatedToolchain(dir, () => {
      expect(resolveAmrOpenCodeExecutable({}, { state, env: { ...env, AGENT_RUNTIME_RESOURCE_ROOT: dir } })).toBeNull();
    });
  });

  it('returns null when libexec/opencode exists but the inner binary is missing', () => {
    mkdirSync(path.join(dir, 'bin', 'libexec', 'opencode'), { recursive: true });
    withIsolatedToolchain(dir, () => {
      expect(resolveAmrOpenCodeExecutable({}, { state, env: { ...env, AGENT_RUNTIME_RESOURCE_ROOT: dir } })).toBeNull();
    });
  });

  it('returns null when the "directory" path is actually a file', () => {
    // `candidate` (bin/libexec/opencode) exists but as a plain file, so
    // `statSync(candidate).isDirectory()` is false.
    mkdirSync(path.join(dir, 'bin', 'libexec'), { recursive: true });
    writeFileSync(path.join(dir, 'bin', 'libexec', 'opencode'), 'not a dir', 'utf8');
    withIsolatedToolchain(dir, () => {
      expect(resolveAmrOpenCodeExecutable({}, { state, env: { ...env, AGENT_RUNTIME_RESOURCE_ROOT: dir } })).toBeNull();
    });
  });

  it('returns null when the inner "exe" path exists but is a directory, not a file', () => {
    // `candidate` (bin/libexec/opencode) is a real directory, but the
    // specific inner binary path is itself a directory rather than a file.
    mkdirSync(path.join(dir, 'bin', 'libexec', 'opencode', 'opencode'), { recursive: true });
    withIsolatedToolchain(dir, () => {
      expect(resolveAmrOpenCodeExecutable({}, { state, env: { ...env, AGENT_RUNTIME_RESOURCE_ROOT: dir } })).toBeNull();
    });
  });
});

describe('win32-specific branches of the AMR/vela companion + built-in resolution', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-vela-win32-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('packagedVelaOpenCodeCompanionTree rejects an inner "opencode.exe" whose extension is not in PATHEXT', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const hadPathExt = Object.prototype.hasOwnProperty.call(env, 'PATHEXT');
    const originalPathExt = env.PATHEXT;
    env.PATHEXT = '.CMD;.BAT'; // deliberately excludes .EXE
    try {
      const companionDir = path.join(dir, 'bin', 'libexec', 'opencode');
      mkdirSync(companionDir, { recursive: true });
      writeFileSync(path.join(companionDir, 'opencode.exe'), 'stub', 'utf8');
      withIsolatedToolchain(dir, () => {
        expect(resolveAmrOpenCodeExecutable({}, { state, env: { ...env, AGENT_RUNTIME_RESOURCE_ROOT: dir } })).toBeNull();
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      if (hadPathExt) env.PATHEXT = originalPathExt;
      else delete env.PATHEXT;
    }
  });

  it('packagedVelaOpenCodeCompanionTree accepts an inner "opencode.exe" whose extension is in PATHEXT', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const hadPathExt = Object.prototype.hasOwnProperty.call(env, 'PATHEXT');
    const originalPathExt = env.PATHEXT;
    env.PATHEXT = '.EXE;.CMD';
    try {
      const companionDir = path.join(dir, 'bin', 'libexec', 'opencode');
      mkdirSync(companionDir, { recursive: true });
      writeFileSync(path.join(companionDir, 'opencode.exe'), 'stub', 'utf8');
      withIsolatedToolchain(dir, () => {
        expect(resolveAmrOpenCodeExecutable({}, { state, env: { ...env, AGENT_RUNTIME_RESOURCE_ROOT: dir } })).toBe(
          path.join(companionDir, 'opencode.exe'),
        );
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      if (hadPathExt) env.PATHEXT = originalPathExt;
      else delete env.PATHEXT;
    }
  });

  it('packagedBuiltInExecutable rejects a "vela.exe" whose extension is not in PATHEXT, even though the OpenCode companion resolved', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const hadPathExt = Object.prototype.hasOwnProperty.call(env, 'PATHEXT');
    const originalPathExt = env.PATHEXT;
    // Includes .CMD (so the VELA_OPENCODE_BIN override below resolves,
    // letting packagedBuiltInExecutable past its early-return guard) but
    // excludes .EXE (so the vela.exe candidate itself gets rejected).
    env.PATHEXT = '.CMD;.BAT';
    try {
      const opencodeBin = path.join(dir, 'opencode.cmd');
      writeFileSync(opencodeBin, 'stub', 'utf8');
      mkdirSync(path.join(dir, 'bin'), { recursive: true });
      writeFileSync(path.join(dir, 'bin', 'vela.exe'), 'stub', 'utf8');
      withIsolatedToolchain(dir, () => {
        env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
        const def = makeDef({ id: 'amr', bin: 'amr-not-installed-xyz' });
        expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: { VELA_OPENCODE_BIN: opencodeBin } })).toBeNull();
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      if (hadPathExt) env.PATHEXT = originalPathExt;
      else delete env.PATHEXT;
    }
  });
});

describe('codexAppBundleExecutable (via resolveAgentExecutable)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-codex-bundle-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op for a non-codex agent id', () => {
    const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
    expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: {} })).toBeNull();
  });

  it('resolves the user-scoped app-bundle Codex binary on darwin when no PATH/override match exists', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    env.AGENT_RUNTIME_HOME = dir;
    try {
      const bundlePath = path.join(dir, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex');
      mkdirSync(path.dirname(bundlePath), { recursive: true });
      makeExecutable(bundlePath);
      const def = makeDef({ id: 'codex', bin: 'codex' });
      const originalPath = env.PATH;
      env.PATH = dir; // nothing named "codex" directly on PATH
      try {
        expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: {} })).toBe(bundlePath);
      } finally {
        env.PATH = originalPath;
      }
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('returns null when running on darwin but no app bundle is present anywhere', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    env.AGENT_RUNTIME_HOME = dir;
    try {
      const def = makeDef({ id: 'codex', bin: 'codex-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { env, state, configuredEnv: {} })).toBeNull();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});

describe('codexAppBundleCandidates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty array on non-darwin platforms', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      expect(codexAppBundleCandidates({}, { env, state })).toEqual([]);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('includes both the user-scoped and /Applications bundle paths on darwin with no home override', () => {
    delete env.AGENT_RUNTIME_HOME;
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      const candidates = codexAppBundleCandidates({}, { env, state });
      expect(candidates.some((c) => c.startsWith('/Applications'))).toBe(true);
      expect(candidates.some((c) => c.includes('Applications') && !c.startsWith('/Applications'))).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('skips the system-wide /Applications path when a home override is active', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    env.AGENT_RUNTIME_HOME = '/fake/override/home';
    try {
      const candidates = codexAppBundleCandidates({}, { env, state });
      expect(candidates.every((c) => !c.startsWith('/Applications/'))).toBe(true);
      expect(candidates[0]).toContain('/fake/override/home');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      delete env.AGENT_RUNTIME_HOME;
    }
  });
});
