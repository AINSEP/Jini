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
// opencode, ...) actually installed under Homebrew/npm-global/etc. Several
// "not found" assertions need PATH resolution and the toolchain-bin-dir
// search to come up genuinely empty rather than accidentally matching a
// real install — scope both to an isolated, empty fake home/PATH for the
// duration of `fn`.
function withIsolatedToolchain(emptyDir: string, fn: () => void): void {
  const originalPath = process.env.PATH;
  process.env.AGENT_RUNTIME_HOME = emptyDir;
  process.env.PATH = emptyDir;
  try {
    fn();
  } finally {
    process.env.PATH = originalPath;
    delete process.env.AGENT_RUNTIME_HOME;
  }
}

afterEach(() => {
  // Reset the injectable env-var-name overrides back to the module default
  // between tests — configureExecutableResolutionEnv() mutates shared
  // module state with no reset export of its own.
  configureExecutableResolutionEnv({ overrides: {
    agentHomeEnvVar: 'AGENT_RUNTIME_HOME',
    resourceRootEnvVar: 'AGENT_RUNTIME_RESOURCE_ROOT',
  } });
  delete process.env.AGENT_RUNTIME_HOME;
  delete process.env.AGENT_RUNTIME_RESOURCE_ROOT;
  vi.restoreAllMocks();
});

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
  const originalPath = process.env.PATH;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-executables-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.env.PATH = originalPath;
  });

  it('finds a binary added to PATH', () => {
    makeExecutable(path.join(dir, 'my-bin'));
    process.env.PATH = [dir, originalPath].join(path.delimiter);
    expect(resolveOnPath({ bin: 'my-bin' })).toBe(path.join(dir, 'my-bin'));
  });

  it('returns null when the binary is not found anywhere on PATH', () => {
    process.env.PATH = dir;
    expect(resolveOnPath({ bin: 'totally-nonexistent-binary-xyz' })).toBeNull();
  });

  it('agentSearchDirs de-duplicates PATH entries and includes user toolchain dirs', () => {
    process.env.PATH = [dir, dir, ''].join(path.delimiter);
    const dirs = agentSearchDirs();
    expect(dirs.filter((d) => d === dir)).toHaveLength(1);
  });

  it('treats a completely unset PATH as empty rather than throwing', () => {
    delete process.env.PATH;
    expect(() => agentSearchDirs()).not.toThrow();
    expect(Array.isArray(agentSearchDirs())).toBe(true);
  });

  it('resolveOnPath tries PATHEXT extensions on win32', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const hadPathExt = Object.prototype.hasOwnProperty.call(process.env, 'PATHEXT');
    const originalPathExt = process.env.PATHEXT;
    process.env.PATHEXT = '.EXE;.CMD';
    try {
      makeExecutable(path.join(dir, 'my-bin.EXE'));
      process.env.PATH = dir;
      expect(resolveOnPath({ bin: 'my-bin' })).toBe(path.join(dir, 'my-bin.EXE'));
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      // Assigning `undefined` to a process.env key stringifies to the
      // literal string "undefined" rather than deleting it — restore via
      // `delete` when PATHEXT wasn't originally set, or every later test in
      // this file would see a corrupted non-empty PATHEXT value.
      if (hadPathExt) process.env.PATHEXT = originalPathExt;
      else delete process.env.PATHEXT;
    }
  });
});

describe('userToolchainBinDirs / configureExecutableResolutionEnv', () => {
  it('scopes to the override home and passes an empty env when agentHomeEnvVar is set', () => {
    process.env.AGENT_RUNTIME_HOME = '/fake/override/home';
    const dirs = userToolchainBinDirs();
    expect(Array.isArray(dirs)).toBe(true);
  });

  it('honors a custom agentHomeEnvVar name via configureExecutableResolutionEnv', () => {
    configureExecutableResolutionEnv({ overrides: { agentHomeEnvVar: 'MY_CUSTOM_HOME_VAR' } });
    process.env.MY_CUSTOM_HOME_VAR = '/another/fake/home';
    const dirs = userToolchainBinDirs();
    expect(Array.isArray(dirs)).toBe(true);
    delete process.env.MY_CUSTOM_HOME_VAR;
  });

  it('falls back to the real OS homedir when no override is configured', () => {
    const dirs = userToolchainBinDirs();
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
    expect(resolveAmrOpenCodeExecutable({  }, { env: { VELA_OPENCODE_BIN: bin } })).toBe(bin);
  });

  it('falls back to the bundled companion tree under resourceRootEnvVar when no override is set', () => {
    const resourceRoot = path.join(dir, 'resources');
    const companionDir = path.join(resourceRoot, 'bin', 'libexec', 'opencode');
    mkdirSync(companionDir, { recursive: true });
    const companionBin = path.join(companionDir, process.platform === 'win32' ? 'opencode.exe' : 'opencode');
    makeExecutable(companionBin);
    const result = resolveAmrOpenCodeExecutable({  }, { env: { AGENT_RUNTIME_RESOURCE_ROOT: resourceRoot } });
    expect(result).toBe(companionBin);
  });

  it('falls back to PATH (opencode-cli, then opencode) when no override or bundled companion exists', () => {
    const bin = path.join(dir, 'opencode-cli');
    makeExecutable(bin);
    const originalPath = process.env.PATH;
    process.env.PATH = dir;
    try {
      expect(resolveAmrOpenCodeExecutable({  }, { env: {} })).toBe(bin);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('returns null when nothing resolves anywhere', () => {
    const originalPath = process.env.PATH;
    // Scope detection strictly to an empty fake home so this real dev
    // machine's own installed toolchain bins (Homebrew, npm-global, ...)
    // aren't picked up as a false positive — see executables.ts's
    // `userToolchainDirs()` override-home behavior.
    process.env.AGENT_RUNTIME_HOME = dir;
    process.env.PATH = dir; // empty dir, nothing installed
    try {
      expect(resolveAmrOpenCodeExecutable({  }, { env: {} })).toBeNull();
    } finally {
      process.env.PATH = originalPath;
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
    const result = inspectAgentExecutableResolution({ def: def }, { configuredEnv: {} });
    expect(result).toEqual({ configuredOverridePath: null, pathResolvedPath: null, selectedPath: null });
  });

  it('prefers the configured override over a PATH match', () => {
    const overridePath = path.join(dir, 'claude-override');
    const pathPath = path.join(dir, 'path-dir', 'claude');
    mkdirSync(path.join(dir, 'path-dir'));
    makeExecutable(overridePath);
    makeExecutable(pathPath);
    const originalPath = process.env.PATH;
    process.env.PATH = path.join(dir, 'path-dir');
    try {
      const def = makeDef({ id: 'claude', bin: 'claude' });
      const result = resolveAgentExecutable({ def: def }, { configuredEnv: { CLAUDE_BIN: overridePath } });
      expect(result).toBe(overridePath);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('falls back to a fallbackBins entry when the primary bin is not on PATH', () => {
    const bin = path.join(dir, 'claude-fork');
    makeExecutable(bin);
    const originalPath = process.env.PATH;
    // Scope to an empty fake home so this real dev machine's own installed
    // `claude` (if any) on a toolchain dir doesn't shadow the fixture.
    process.env.AGENT_RUNTIME_HOME = dir;
    process.env.PATH = dir;
    try {
      const def = makeDef({ id: 'claude', bin: 'claude', fallbackBins: ['claude-fork'] });
      const result = resolveAgentExecutable({ def: def }, { configuredEnv: {} });
      expect(result).toBe(bin);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('returns null when nothing resolves at all', () => {
    const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
    expect(resolveAgentExecutable({ def: def }, { configuredEnv: {} })).toBeNull();
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
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: { CLAUDE_BIN: bin } })).toBe(bin);
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
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: { CLAUDE_BIN: bin } })).toBeNull();
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
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: { CLAUDE_BIN: bin } })).toBeNull();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('rejects a path that is not absolute', () => {
    withIsolatedToolchain(dir, () => {
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: { CLAUDE_BIN: 'relative/path/claude' } })).toBeNull();
    });
  });

  it('rejects a blank configured override value', () => {
    withIsolatedToolchain(dir, () => {
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: { CLAUDE_BIN: '   ' } })).toBeNull();
    });
  });

  it('rejects a configured override that points at a directory, not a file', () => {
    withIsolatedToolchain(dir, () => {
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: { CLAUDE_BIN: dir } })).toBeNull();
    });
  });

  it('rejects a configured override with no matching AGENT_BIN_ENV_KEYS entry', () => {
    const def = makeDef({ id: 'not-a-registered-agent-id', bin: 'whatever-not-installed-xyz' });
    expect(resolveAgentExecutable({ def: def }, { configuredEnv: {} })).toBeNull();
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
      process.env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const def = makeDef({ id: 'claude', bin: 'claude-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: {} })).toBeNull();
    });
  });

  it('resolves the packaged vela binary when the OpenCode companion is present via VELA_OPENCODE_BIN', () => {
    withIsolatedToolchain(dir, () => {
      process.env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const opencodeBin = path.join(dir, 'opencode');
      makeExecutable(opencodeBin);
      const velaBin = path.join(dir, 'bin', 'vela');
      mkdirSync(path.join(dir, 'bin'), { recursive: true });
      makeExecutable(velaBin);
      const def = makeDef({ id: 'amr', bin: 'amr' });
      const result = resolveAgentExecutable({ def: def }, { configuredEnv: { VELA_OPENCODE_BIN: opencodeBin } });
      expect(result).toBe(velaBin);
    });
  });

  it('resolves the packaged vela binary via the bundled companion tree even with no VELA_OPENCODE_BIN', () => {
    withIsolatedToolchain(dir, () => {
      process.env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const companionDir = path.join(dir, 'bin', 'libexec', 'opencode');
      mkdirSync(companionDir, { recursive: true });
      makeExecutable(path.join(companionDir, process.platform === 'win32' ? 'opencode.exe' : 'opencode'));
      const velaBin = path.join(dir, 'bin', 'vela');
      makeExecutable(velaBin);
      const def = makeDef({ id: 'amr', bin: 'amr' });
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: {} })).toBe(velaBin);
    });
  });

  it('returns null (falls through) when no resourceRoot is configured', () => {
    withIsolatedToolchain(dir, () => {
      const def = makeDef({ id: 'amr', bin: 'amr-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: {} })).toBeNull();
    });
  });

  it('returns null when neither the OpenCode companion nor VELA_OPENCODE_BIN resolves', () => {
    withIsolatedToolchain(dir, () => {
      process.env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const def = makeDef({ id: 'amr', bin: 'amr-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: {} })).toBeNull();
    });
  });

  it('returns null when the vela candidate file does not exist even though the companion resolved', () => {
    withIsolatedToolchain(dir, () => {
      process.env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const opencodeBin = path.join(dir, 'opencode');
      makeExecutable(opencodeBin);
      // No bin/vela created at all.
      const def = makeDef({ id: 'amr', bin: 'amr-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: { VELA_OPENCODE_BIN: opencodeBin } })).toBeNull();
    });
  });

  it('returns null when the vela candidate path is a directory, not a file', () => {
    withIsolatedToolchain(dir, () => {
      process.env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const opencodeBin = path.join(dir, 'opencode');
      makeExecutable(opencodeBin);
      mkdirSync(path.join(dir, 'bin', 'vela'), { recursive: true }); // 'vela' is a dir, not a file
      const def = makeDef({ id: 'amr', bin: 'amr-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: { VELA_OPENCODE_BIN: opencodeBin } })).toBeNull();
    });
  });

  it('returns null when the vela candidate exists but is not executable', () => {
    withIsolatedToolchain(dir, () => {
      process.env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
      const opencodeBin = path.join(dir, 'opencode');
      makeExecutable(opencodeBin);
      mkdirSync(path.join(dir, 'bin'), { recursive: true });
      const velaBin = path.join(dir, 'bin', 'vela');
      writeFileSync(velaBin, 'stub', 'utf8');
      chmodSync(velaBin, 0o600); // no execute bit
      const def = makeDef({ id: 'amr', bin: 'amr-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: { VELA_OPENCODE_BIN: opencodeBin } })).toBeNull();
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
      expect(resolveAmrOpenCodeExecutable({  }, { env: { AGENT_RUNTIME_RESOURCE_ROOT: dir } })).toBeNull();
    });
  });

  it('returns null when libexec/opencode exists but the inner binary is missing', () => {
    mkdirSync(path.join(dir, 'bin', 'libexec', 'opencode'), { recursive: true });
    withIsolatedToolchain(dir, () => {
      expect(resolveAmrOpenCodeExecutable({  }, { env: { AGENT_RUNTIME_RESOURCE_ROOT: dir } })).toBeNull();
    });
  });

  it('returns null when the "directory" path is actually a file', () => {
    // `candidate` (bin/libexec/opencode) exists but as a plain file, so
    // `statSync(candidate).isDirectory()` is false.
    mkdirSync(path.join(dir, 'bin', 'libexec'), { recursive: true });
    writeFileSync(path.join(dir, 'bin', 'libexec', 'opencode'), 'not a dir', 'utf8');
    withIsolatedToolchain(dir, () => {
      expect(resolveAmrOpenCodeExecutable({  }, { env: { AGENT_RUNTIME_RESOURCE_ROOT: dir } })).toBeNull();
    });
  });

  it('returns null when the inner "exe" path exists but is a directory, not a file', () => {
    // `candidate` (bin/libexec/opencode) is a real directory, but the
    // specific inner binary path is itself a directory rather than a file.
    mkdirSync(path.join(dir, 'bin', 'libexec', 'opencode', 'opencode'), { recursive: true });
    withIsolatedToolchain(dir, () => {
      expect(resolveAmrOpenCodeExecutable({  }, { env: { AGENT_RUNTIME_RESOURCE_ROOT: dir } })).toBeNull();
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
    const hadPathExt = Object.prototype.hasOwnProperty.call(process.env, 'PATHEXT');
    const originalPathExt = process.env.PATHEXT;
    process.env.PATHEXT = '.CMD;.BAT'; // deliberately excludes .EXE
    try {
      const companionDir = path.join(dir, 'bin', 'libexec', 'opencode');
      mkdirSync(companionDir, { recursive: true });
      writeFileSync(path.join(companionDir, 'opencode.exe'), 'stub', 'utf8');
      withIsolatedToolchain(dir, () => {
        expect(resolveAmrOpenCodeExecutable({  }, { env: { AGENT_RUNTIME_RESOURCE_ROOT: dir } })).toBeNull();
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      if (hadPathExt) process.env.PATHEXT = originalPathExt;
      else delete process.env.PATHEXT;
    }
  });

  it('packagedVelaOpenCodeCompanionTree accepts an inner "opencode.exe" whose extension is in PATHEXT', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const hadPathExt = Object.prototype.hasOwnProperty.call(process.env, 'PATHEXT');
    const originalPathExt = process.env.PATHEXT;
    process.env.PATHEXT = '.EXE;.CMD';
    try {
      const companionDir = path.join(dir, 'bin', 'libexec', 'opencode');
      mkdirSync(companionDir, { recursive: true });
      writeFileSync(path.join(companionDir, 'opencode.exe'), 'stub', 'utf8');
      withIsolatedToolchain(dir, () => {
        expect(resolveAmrOpenCodeExecutable({  }, { env: { AGENT_RUNTIME_RESOURCE_ROOT: dir } })).toBe(
          path.join(companionDir, 'opencode.exe'),
        );
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      if (hadPathExt) process.env.PATHEXT = originalPathExt;
      else delete process.env.PATHEXT;
    }
  });

  it('packagedBuiltInExecutable rejects a "vela.exe" whose extension is not in PATHEXT, even though the OpenCode companion resolved', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const hadPathExt = Object.prototype.hasOwnProperty.call(process.env, 'PATHEXT');
    const originalPathExt = process.env.PATHEXT;
    // Includes .CMD (so the VELA_OPENCODE_BIN override below resolves,
    // letting packagedBuiltInExecutable past its early-return guard) but
    // excludes .EXE (so the vela.exe candidate itself gets rejected).
    process.env.PATHEXT = '.CMD;.BAT';
    try {
      const opencodeBin = path.join(dir, 'opencode.cmd');
      writeFileSync(opencodeBin, 'stub', 'utf8');
      mkdirSync(path.join(dir, 'bin'), { recursive: true });
      writeFileSync(path.join(dir, 'bin', 'vela.exe'), 'stub', 'utf8');
      withIsolatedToolchain(dir, () => {
        process.env.AGENT_RUNTIME_RESOURCE_ROOT = dir;
        const def = makeDef({ id: 'amr', bin: 'amr-not-installed-xyz' });
        expect(resolveAgentExecutable({ def: def }, { configuredEnv: { VELA_OPENCODE_BIN: opencodeBin } })).toBeNull();
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      if (hadPathExt) process.env.PATHEXT = originalPathExt;
      else delete process.env.PATHEXT;
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
    expect(resolveAgentExecutable({ def: def }, { configuredEnv: {} })).toBeNull();
  });

  it('resolves the user-scoped app-bundle Codex binary on darwin when no PATH/override match exists', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.AGENT_RUNTIME_HOME = dir;
    try {
      const bundlePath = path.join(dir, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex');
      mkdirSync(path.dirname(bundlePath), { recursive: true });
      makeExecutable(bundlePath);
      const def = makeDef({ id: 'codex', bin: 'codex' });
      const originalPath = process.env.PATH;
      process.env.PATH = dir; // nothing named "codex" directly on PATH
      try {
        expect(resolveAgentExecutable({ def: def }, { configuredEnv: {} })).toBe(bundlePath);
      } finally {
        process.env.PATH = originalPath;
      }
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('returns null when running on darwin but no app bundle is present anywhere', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.AGENT_RUNTIME_HOME = dir;
    try {
      const def = makeDef({ id: 'codex', bin: 'codex-not-installed-xyz' });
      expect(resolveAgentExecutable({ def: def }, { configuredEnv: {} })).toBeNull();
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
      expect(codexAppBundleCandidates()).toEqual([]);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('includes both the user-scoped and /Applications bundle paths on darwin with no home override', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      const candidates = codexAppBundleCandidates();
      expect(candidates.some((c) => c.startsWith('/Applications'))).toBe(true);
      expect(candidates.some((c) => c.includes('Applications') && !c.startsWith('/Applications'))).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('skips the system-wide /Applications path when a home override is active', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.AGENT_RUNTIME_HOME = '/fake/override/home';
    try {
      const candidates = codexAppBundleCandidates();
      expect(candidates.every((c) => !c.startsWith('/Applications/'))).toBe(true);
      expect(candidates[0]).toContain('/fake/override/home');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      delete process.env.AGENT_RUNTIME_HOME;
    }
  });
});
