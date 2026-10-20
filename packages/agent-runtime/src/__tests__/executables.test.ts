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

// Characterization pins (L174): every remaining branch of executable
// resolution, written green against the pre-refactor code and kept unchanged
// through the refactor so the search order / acceptance rules are provably
// identical.
describe('executable resolution characterization', () => {
  let dir: string;
  const originalPlatform = process.platform;
  const bundleSuffix = ['Applications', 'Codex.app', 'Contents', 'Resources', 'codex'];

  function onPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform });
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-exec-char-test-'));
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('defaults to process.env and the shared default runtime state when no options are passed', () => {
    beforeEach(() => {
      vi.stubEnv('PATH', dir);
      vi.stubEnv('AGENT_RUNTIME_HOME', dir);
    });

    it('resolveOnPath searches process.env.PATH', () => {
      makeExecutable(path.join(dir, 'char-default-bin'));
      expect(resolveOnPath({ bin: 'char-default-bin' })).toBe(path.join(dir, 'char-default-bin'));
    });

    it('agentSearchDirs starts with the process.env.PATH entries', () => {
      expect(agentSearchDirs()[0]).toBe(dir);
    });

    it('userToolchainBinDirs scopes to the process.env agent-home override', () => {
      expect(userToolchainBinDirs().every((d) => !d.startsWith('/usr/local') && !d.startsWith('/opt/homebrew'))).toBe(true);
    });

    it('resolveAgentExecutable and inspectAgentExecutableResolution resolve via process.env with no configuredEnv', () => {
      makeExecutable(path.join(dir, 'char-default-agent'));
      const def = makeDef({ id: 'char-default-agent', bin: 'char-default-agent' });
      expect(resolveAgentExecutable({ def })).toBe(path.join(dir, 'char-default-agent'));
      expect(inspectAgentExecutableResolution({ def })).toEqual({
        configuredOverridePath: null,
        pathResolvedPath: path.join(dir, 'char-default-agent'),
        selectedPath: path.join(dir, 'char-default-agent'),
      });
    });

    it('resolveAmrOpenCodeExecutable falls back to PATH via process.env', () => {
      makeExecutable(path.join(dir, 'opencode'));
      expect(resolveAmrOpenCodeExecutable({})).toBe(path.join(dir, 'opencode'));
    });

    it('codexAppBundleCandidates honors the process.env agent-home override on darwin', () => {
      onPlatform('darwin');
      expect(codexAppBundleCandidates()).toEqual([path.join(dir, ...bundleSuffix)]);
    });

    it('configureExecutableResolutionEnv mutates the shared default state when no state is passed', async () => {
      const { defaultRuntimeState } = await import('../runtime-state.js');
      const saved = { ...defaultRuntimeState.executable.envNames };
      try {
        configureExecutableResolutionEnv({ overrides: { agentHomeEnvVar: 'CHAR_HOME', resourceRootEnvVar: 'CHAR_ROOT' } });
        expect(defaultRuntimeState.executable.envNames).toEqual({ agentHomeEnvVar: 'CHAR_HOME', resourceRootEnvVar: 'CHAR_ROOT' });
      } finally {
        Object.assign(defaultRuntimeState.executable.envNames, saved);
      }
    });
  });

  describe('detection home fallback chain (override → HOME → USERPROFILE → os.homedir)', () => {
    it('uses USERPROFILE when neither the override nor HOME is set', () => {
      onPlatform('darwin');
      const candidates = codexAppBundleCandidates({}, { env: { USERPROFILE: dir }, state });
      expect(candidates).toEqual([path.join('/Applications', ...bundleSuffix.slice(1)), path.join(dir, ...bundleSuffix)]);
    });

    it('uses os.homedir() when no home variable is set at all', async () => {
      onPlatform('darwin');
      const { homedir } = await import('node:os');
      const candidates = codexAppBundleCandidates({}, { env: {}, state });
      expect(candidates).toEqual([path.join('/Applications', ...bundleSuffix.slice(1)), path.join(homedir(), ...bundleSuffix)]);
    });

    it('lets the agent-home override win over HOME', () => {
      onPlatform('darwin');
      const candidates = codexAppBundleCandidates({}, { env: { HOME: '/char/home', AGENT_RUNTIME_HOME: dir }, state });
      expect(candidates).toEqual([path.join(dir, ...bundleSuffix)]);
    });
  });

  describe('custom resource-root env var name', () => {
    it('resolveAmrOpenCodeExecutable reads the bundled companion under the configured resourceRootEnvVar', () => {
      configureExecutableResolutionEnv({ overrides: { resourceRootEnvVar: 'CHAR_RESOURCE_ROOT' } }, { state });
      const companion = path.join(dir, 'bin', 'libexec', 'opencode');
      mkdirSync(companion, { recursive: true });
      makeExecutable(path.join(companion, 'opencode'));
      expect(resolveAmrOpenCodeExecutable({}, { env: { ...env, CHAR_RESOURCE_ROOT: dir }, state })).toBe(path.join(companion, 'opencode'));
    });

    it('ignores the default AGENT_RUNTIME_RESOURCE_ROOT once a custom name is configured', () => {
      configureExecutableResolutionEnv({ overrides: { resourceRootEnvVar: 'CHAR_RESOURCE_ROOT' } }, { state });
      const companion = path.join(dir, 'bin', 'libexec', 'opencode');
      mkdirSync(companion, { recursive: true });
      makeExecutable(path.join(companion, 'opencode'));
      withIsolatedToolchain(dir, () => {
        expect(resolveAmrOpenCodeExecutable({}, { env: { ...env, AGENT_RUNTIME_RESOURCE_ROOT: dir }, state })).toBeNull();
      });
    });

    it('leaves both names unchanged when overrides are empty', () => {
      configureExecutableResolutionEnv({ overrides: { agentHomeEnvVar: '', resourceRootEnvVar: '' } }, { state });
      expect(state.executable.envNames).toEqual({ agentHomeEnvVar: 'AGENT_RUNTIME_HOME', resourceRootEnvVar: 'AGENT_RUNTIME_RESOURCE_ROOT' });
    });
  });

  describe('PATH search order and acceptance', () => {
    it('returns the first PATH directory that contains the binary', () => {
      const first = path.join(dir, 'a');
      const second = path.join(dir, 'b');
      mkdirSync(first);
      mkdirSync(second);
      makeExecutable(path.join(first, 'char-bin'));
      makeExecutable(path.join(second, 'char-bin'));
      env.PATH = [second, first].join(path.delimiter);
      expect(resolveOnPath({ bin: 'char-bin' }, { env, state })).toBe(path.join(second, 'char-bin'));
    });

    it('searches PATH entries before the user toolchain dirs', () => {
      const toolchainBin = path.join(dir, '.local', 'bin');
      const pathDir = path.join(dir, 'p');
      mkdirSync(toolchainBin, { recursive: true });
      mkdirSync(pathDir);
      makeExecutable(path.join(toolchainBin, 'char-bin'));
      makeExecutable(path.join(pathDir, 'char-bin'));
      env.AGENT_RUNTIME_HOME = dir;
      env.PATH = pathDir;
      expect(agentSearchDirs({}, { env, state })).toContain(toolchainBin);
      expect(resolveOnPath({ bin: 'char-bin' }, { env, state })).toBe(path.join(pathDir, 'char-bin'));
    });

    it('falls back to a user toolchain dir when PATH has no match', () => {
      const toolchainBin = path.join(dir, '.local', 'bin');
      mkdirSync(toolchainBin, { recursive: true });
      makeExecutable(path.join(toolchainBin, 'char-bin'));
      env.AGENT_RUNTIME_HOME = dir;
      env.PATH = '';
      expect(resolveOnPath({ bin: 'char-bin' }, { env, state })).toBe(path.join(toolchainBin, 'char-bin'));
    });

    it('accepts a non-executable PATH match because only existence is checked (reported, not fixed)', () => {
      writeFileSync(path.join(dir, 'char-bin'), 'not executable', 'utf8');
      chmodSync(path.join(dir, 'char-bin'), 0o644);
      env.PATH = dir;
      expect(resolveOnPath({ bin: 'char-bin' }, { env, state })).toBe(path.join(dir, 'char-bin'));
    });

    it('accepts a directory as a PATH match because only existence is checked (reported, not fixed)', () => {
      mkdirSync(path.join(dir, 'char-bin'));
      env.PATH = dir;
      expect(resolveOnPath({ bin: 'char-bin' }, { env, state })).toBe(path.join(dir, 'char-bin'));
    });

    it('returns a cwd-relative path for a relative PATH entry (reported, not fixed)', () => {
      const rel = path.relative(process.cwd(), dir);
      makeExecutable(path.join(dir, 'char-bin'));
      env.PATH = rel;
      const resolved = resolveOnPath({ bin: 'char-bin' }, { env, state });
      expect(resolved).toBe(path.join(rel, 'char-bin'));
      expect(path.isAbsolute(resolved ?? '')).toBe(false);
    });

    it('caches the toolchain dirs for an unchanged environment', () => {
      env.AGENT_RUNTIME_HOME = dir;
      const firstCall = userToolchainBinDirs({}, { env, state });
      expect(userToolchainBinDirs({}, { env, state })).toBe(firstCall);
    });

    it('recomputes the toolchain dirs when a keyed env field changes', () => {
      env.AGENT_RUNTIME_HOME = dir;
      const firstCall = userToolchainBinDirs({}, { env, state });
      expect(userToolchainBinDirs({}, { env: { ...env, FNM_DIR: dir }, state })).not.toBe(firstCall);
    });

    it('recomputes the toolchain dirs after the 5s cache TTL', () => {
      env.AGENT_RUNTIME_HOME = dir;
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const firstCall = userToolchainBinDirs({}, { env, state });
      now.mockReturnValue(1_005_000);
      expect(userToolchainBinDirs({}, { env, state })).not.toBe(firstCall);
    });
  });

  describe('win32 extension handling', () => {
    it('resolveOnPath defaults PATHEXT to .EXE;.CMD;.BAT when unset', () => {
      onPlatform('win32');
      makeExecutable(path.join(dir, 'char-bin.BAT'));
      delete env.PATHEXT;
      env.PATH = dir;
      expect(resolveOnPath({ bin: 'char-bin' }, { env, state })).toBe(path.join(dir, 'char-bin.BAT'));
    });

    it('resolveOnPath does not try .COM under the default PATHEXT', () => {
      onPlatform('win32');
      makeExecutable(path.join(dir, 'char-bin.COM'));
      delete env.PATHEXT;
      withIsolatedToolchain(dir, () => {
        expect(resolveOnPath({ bin: 'char-bin' }, { env, state })).toBeNull();
      });
    });

    it('resolveOnPath tries extensions in PATHEXT order within one directory', () => {
      onPlatform('win32');
      makeExecutable(path.join(dir, 'char-bin.CMD'));
      makeExecutable(path.join(dir, 'char-bin.EXE'));
      env.PATHEXT = '.CMD;.EXE';
      env.PATH = dir;
      expect(resolveOnPath({ bin: 'char-bin' }, { env, state })).toBe(path.join(dir, 'char-bin.CMD'));
    });

    it('resolveOnPath does not try the bare name on win32', () => {
      onPlatform('win32');
      makeExecutable(path.join(dir, 'char-bin'));
      env.PATHEXT = '.EXE';
      withIsolatedToolchain(dir, () => {
        expect(resolveOnPath({ bin: 'char-bin' }, { env, state })).toBeNull();
      });
    });

    it('accepts a configured override against the default PATHEXT when unset', () => {
      onPlatform('win32');
      const override = path.join(dir, 'claude.bat');
      makeExecutable(override);
      delete env.PATHEXT;
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(resolveAgentExecutable({ def }, { env, state, configuredEnv: { CLAUDE_BIN: override } })).toBe(override);
    });

    it('rejects a configured .com override under the default PATHEXT', () => {
      onPlatform('win32');
      const override = path.join(dir, 'claude.com');
      makeExecutable(override);
      delete env.PATHEXT;
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(inspectAgentExecutableResolution({ def }, { env, state, configuredEnv: { CLAUDE_BIN: override } }).configuredOverridePath).toBeNull();
    });

    it('matches PATHEXT case-insensitively and ignores blank / padded entries', () => {
      onPlatform('win32');
      const override = path.join(dir, 'claude.exe');
      makeExecutable(override);
      env.PATHEXT = ' .Exe ;;';
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(resolveAgentExecutable({ def }, { env, state, configuredEnv: { CLAUDE_BIN: override } })).toBe(override);
    });

    it('accepts a win32 override without an execute-permission check', () => {
      onPlatform('win32');
      const override = path.join(dir, 'claude.exe');
      writeFileSync(override, 'stub', 'utf8');
      chmodSync(override, 0o644);
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(resolveAgentExecutable({ def }, { env, state, configuredEnv: { CLAUDE_BIN: override } })).toBe(override);
    });
  });

  describe('configured *_BIN override acceptance', () => {
    it('rejects a posix override that is not executable', () => {
      const override = path.join(dir, 'claude');
      writeFileSync(override, 'stub', 'utf8');
      chmodSync(override, 0o644);
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(inspectAgentExecutableResolution({ def }, { env, state, configuredEnv: { CLAUDE_BIN: override } }).configuredOverridePath).toBeNull();
    });

    it('rejects an override path that does not exist', () => {
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(inspectAgentExecutableResolution({ def }, { env, state, configuredEnv: { CLAUDE_BIN: path.join(dir, 'missing') } }).configuredOverridePath).toBeNull();
    });

    it('trims surrounding whitespace from the override', () => {
      const override = path.join(dir, 'claude');
      makeExecutable(override);
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(resolveAgentExecutable({ def }, { env, state, configuredEnv: { CLAUDE_BIN: `  ${override}  ` } })).toBe(override);
    });

    it('expands a ~/ override against os.homedir(), not the injected HOME / agent home (reported, not fixed)', () => {
      // A binary planted in the injected (sandbox) home is NOT found through a
      // `~/` override: expansion goes to the real host home instead, so a
      // sandboxed detection run can reach outside its fixture home.
      makeExecutable(path.join(dir, 'char-tilde-bin-xyz'));
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      const result = inspectAgentExecutableResolution({ def }, {
        env: { ...env, HOME: dir, AGENT_RUNTIME_HOME: dir },
        state,
        configuredEnv: { CLAUDE_BIN: '~/char-tilde-bin-xyz' },
      });
      expect(result.configuredOverridePath).toBeNull();
    });

    it('reads the override from configuredEnv only, never from the host env', () => {
      const override = path.join(dir, 'claude');
      makeExecutable(override);
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(inspectAgentExecutableResolution({ def }, { env: { ...env, CLAUDE_BIN: override }, state, configuredEnv: {} }).configuredOverridePath).toBeNull();
    });

    it('reports a PATH match alongside a winning override', () => {
      const override = path.join(dir, 'override-claude');
      const pathDir = path.join(dir, 'p');
      mkdirSync(pathDir);
      makeExecutable(override);
      makeExecutable(path.join(pathDir, 'claude'));
      env.PATH = pathDir;
      const def = makeDef({ id: 'claude', bin: 'claude' });
      expect(inspectAgentExecutableResolution({ def }, { env, state, configuredEnv: { CLAUDE_BIN: override } })).toEqual({
        configuredOverridePath: override,
        pathResolvedPath: path.join(pathDir, 'claude'),
        selectedPath: override,
      });
    });

    it('tries def.bin before fallbackBins', () => {
      makeExecutable(path.join(dir, 'claude'));
      makeExecutable(path.join(dir, 'claude-fork'));
      env.PATH = dir;
      const def = makeDef({ id: 'claude', bin: 'claude', fallbackBins: ['claude-fork'] });
      expect(resolveAgentExecutable({ def }, { env, state, configuredEnv: {} })).toBe(path.join(dir, 'claude'));
    });

    it('ignores a non-array fallbackBins value', () => {
      makeExecutable(path.join(dir, 'claude-fork'));
      withIsolatedToolchain(dir, () => {
        const def = makeDef({ id: 'claude', bin: 'claude-missing-xyz', fallbackBins: 'claude-fork' as unknown as string[] });
        expect(resolveAgentExecutable({ def }, { env, state, configuredEnv: {} })).toBeNull();
      });
    });
  });

  describe('selection precedence: override → packaged built-in → PATH → app bundle', () => {
    function packagedVela(root: string): string {
      const companion = path.join(root, 'bin', 'libexec', 'opencode');
      mkdirSync(companion, { recursive: true });
      makeExecutable(path.join(companion, 'opencode'));
      makeExecutable(path.join(root, 'bin', 'vela'));
      return path.join(root, 'bin', 'vela');
    }

    it('selects the packaged vela binary over a vela match on PATH', () => {
      const vela = packagedVela(dir);
      const pathDir = path.join(dir, 'p');
      mkdirSync(pathDir);
      makeExecutable(path.join(pathDir, 'vela'));
      env.PATH = pathDir;
      const def = makeDef({ id: 'amr', bin: 'vela' });
      expect(inspectAgentExecutableResolution({ def }, { env: { ...env, AGENT_RUNTIME_RESOURCE_ROOT: dir }, state, configuredEnv: {} })).toEqual({
        configuredOverridePath: null,
        pathResolvedPath: path.join(pathDir, 'vela'),
        selectedPath: vela,
      });
    });

    it('selects the configured VELA_BIN override over the packaged vela binary', () => {
      packagedVela(dir);
      const override = path.join(dir, 'override-vela');
      makeExecutable(override);
      const def = makeDef({ id: 'amr', bin: 'vela-missing-xyz' });
      expect(resolveAgentExecutable({ def }, { env: { ...env, AGENT_RUNTIME_RESOURCE_ROOT: dir }, state, configuredEnv: { VELA_BIN: override } })).toBe(override);
    });

    it('lets configuredEnv supply VELA_OPENCODE_BIN for the packaged vela companion check', () => {
      makeExecutable(path.join(dir, 'opencode-override'));
      mkdirSync(path.join(dir, 'bin'));
      makeExecutable(path.join(dir, 'bin', 'vela'));
      const def = makeDef({ id: 'amr', bin: 'vela-missing-xyz' });
      expect(resolveAgentExecutable({ def }, {
        env: { ...env, AGENT_RUNTIME_RESOURCE_ROOT: dir },
        state,
        configuredEnv: { VELA_OPENCODE_BIN: path.join(dir, 'opencode-override') },
      })).toBe(path.join(dir, 'bin', 'vela'));
    });

    it('selects a PATH match over a darwin app-bundle install', () => {
      onPlatform('darwin');
      const bundle = path.join(dir, ...bundleSuffix);
      mkdirSync(path.dirname(bundle), { recursive: true });
      makeExecutable(bundle);
      const pathDir = path.join(dir, 'p');
      mkdirSync(pathDir);
      makeExecutable(path.join(pathDir, 'codex'));
      env.AGENT_RUNTIME_HOME = dir;
      env.PATH = pathDir;
      const def = makeDef({ id: 'codex', bin: 'codex' });
      expect(resolveAgentExecutable({ def }, { env, state, configuredEnv: {} })).toBe(path.join(pathDir, 'codex'));
    });
  });
});
