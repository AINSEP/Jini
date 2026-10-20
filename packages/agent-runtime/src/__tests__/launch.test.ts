import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAgentLaunchEnv, resolveAgentLaunch } from '../launch.js';
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

function makeExecutable(filePath: string, content = '#!/usr/bin/env node\n// stub\n'): void {
  writeFileSync(filePath, content, 'utf8');
  chmodSync(filePath, 0o755);
}

// The exact target-triple mapping `codexNativeTargetTriple()` in launch.ts
// uses — replicated here (not imported, since it's a private helper) so
// tests can build a matching node_modules/@openai/codex-<suffix>/vendor/
// <triple>/... layout for whatever platform/arch this test happens to run
// on.
function targetTripleForCurrentHost(): string {
  const { platform, arch } = process;
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-musl';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-musl';
  if (platform === 'win32' && arch === 'arm64') return 'aarch64-pc-windows-msvc';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  return `${platform}-${arch}`;
}

describe('resolveAgentLaunch', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-launch-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns launchPath: null when the def has no resolvable executable', () => {
    const def = makeDef({ bin: 'definitely-not-a-real-binary-xyz' });
    const result = resolveAgentLaunch({ def: def }, { configuredEnv: {} });
    expect(result.launchPath).toBeNull();
    expect(result.launchKind).toBe('selected');
    expect(result.childPathPrepend).toEqual([]);
    expect(result.diagnostic).toBeNull();
  });

  it('resolves a claude-shaped agent via its *_BIN override and sets childPathPrepend', () => {
    const binPath = path.join(dir, 'claude');
    makeExecutable(binPath);
    const def = makeDef({ id: 'claude', bin: 'claude' });
    const result = resolveAgentLaunch({ def: def }, { configuredEnv: { CLAUDE_BIN: binPath } });
    expect(result.launchPath).toBe(binPath);
    expect(result.launchKind).toBe('selected');
    expect(result.childPathPrepend).toEqual([path.dirname(binPath)]);
    expect(result.diagnostic).toBeNull();
  });

  it('codex: falls back to the wrapper with no diagnostic when the file does not look like a node wrapper and no native binary exists', () => {
    const binPath = path.join(dir, 'codex');
    makeExecutable(binPath, 'this is a totally unrelated binary blob with no matching keywords');
    const def = makeDef({ id: 'codex', bin: 'codex' });
    const result = resolveAgentLaunch({ def: def }, { configuredEnv: { CODEX_BIN: binPath } });
    expect(result.launchKind).toBe('selected');
    expect(result.launchPath).toBe(binPath);
    expect(result.diagnostic).toBeNull();
  });

  it('codex: surfaces a diagnostic when the wrapper looks like a node wrapper but no native binary is found', () => {
    const binPath = path.join(dir, 'codex');
    makeExecutable(binPath, '#!/usr/bin/env node\nrequire("@openai/codex-cli");\n');
    const def = makeDef({ id: 'codex', bin: 'codex' });
    const result = resolveAgentLaunch({ def: def }, { configuredEnv: { CODEX_BIN: binPath } });
    expect(result.launchKind).toBe('selected');
    expect(result.launchPath).toBe(binPath);
    expect(result.diagnostic).toContain('Codex native binary was not found');
    expect(result.diagnostic).toContain('CODEX_BIN');
  });

  it('codex: upgrades to the native binary when node_modules/@openai/codex-<suffix>/vendor/<triple>/codex/codex exists', () => {
    const suffix = `${process.platform}-${process.arch}`;
    const triple = targetTripleForCurrentHost();
    const scopedDir = path.join(dir, 'node_modules', '@openai', `codex-${suffix}`);
    const vendorDir = path.join(scopedDir, 'vendor', triple);
    const codexDir = path.join(vendorDir, 'codex');
    const pathDir = path.join(vendorDir, 'path');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(pathDir, { recursive: true });
    const nativeBinary = path.join(codexDir, 'codex');
    makeExecutable(nativeBinary, 'native binary stub');

    const wrapperPath = path.join(dir, 'codex-wrapper.js');
    makeExecutable(wrapperPath, '#!/usr/bin/env node\nrequire("@openai/codex-cli");\n');

    const def = makeDef({ id: 'codex', bin: 'codex' });
    const result = resolveAgentLaunch({ def: def }, { configuredEnv: { CODEX_BIN: wrapperPath } });

    expect(result.launchKind).toBe('codex-native');
    expect(result.launchPath).toBe(nativeBinary);
    expect(result.diagnostic).toBeNull();
    expect(result.childPathPrepend).toEqual(expect.arrayContaining([path.dirname(wrapperPath), pathDir]));
  });

  it('resolves a relative PATH entry to a non-absolute selectedPath, leaving childPathPrepend empty', () => {
    const binName = 'relative-path-agent-bin';
    const relDir = path.relative(process.cwd(), dir) || '.';
    makeExecutable(path.join(dir, binName));
    const originalPath = process.env.PATH;
    process.env.PATH = [relDir, originalPath].filter(Boolean).join(path.delimiter);
    try {
      const def = makeDef({ id: 'relative-path-agent', bin: binName });
      const result = resolveAgentLaunch({ def: def }, { configuredEnv: {} });
      expect(result.launchPath).not.toBeNull();
      expect(path.isAbsolute(result.launchPath!)).toBe(false);
      expect(result.childPathPrepend).toEqual([]);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  // Simulates an unreadable-but-executable wrapper via a real chmod (0o111 — execute-only:
  // accessSync(X_OK) still passes, openSync('r') fails with EACCES for a normal user), so
  // looksLikeCodexNodeWrapper's own catch{ return false } branch is exercised through the real
  // filesystem, not a mock. That relies on POSIX DAC (discretionary access control): root is a
  // documented, provable exception to the read-permission-bit check (CAP_DAC_OVERRIDE — root can
  // always open a file it can already execute, regardless of the read bit), so this scenario is
  // unreproducible via chmod alone under uid 0 — not "seems unlikely," a real POSIX invariant.
  // Skipped (not deleted, not force-passed) only when actually running as root; every other test
  // in this describe block runs unconditionally.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  it.skipIf(isRoot)(
    'codex: falls back to the wrapper with no diagnostic when the wrapper file cannot be read (permission denied)',
    () => {
      const binPath = path.join(dir, 'codex');
      makeExecutable(binPath, '#!/usr/bin/env node\n// wrapper\n');
      chmodSync(binPath, 0o111); // execute-only: accessSync(X_OK) still passes, but openSync('r') fails.
      const def = makeDef({ id: 'codex', bin: 'codex' });
      const result = resolveAgentLaunch({ def: def }, { configuredEnv: { CODEX_BIN: binPath } });
      expect(result.launchKind).toBe('selected');
      expect(result.launchPath).toBe(binPath);
      expect(result.diagnostic).toBeNull();
    },
  );

  it.each([
    { platform: 'darwin', arch: 'arm64', triple: 'aarch64-apple-darwin' },
    { platform: 'darwin', arch: 'x64', triple: 'x86_64-apple-darwin' },
    { platform: 'linux', arch: 'arm64', triple: 'aarch64-unknown-linux-musl' },
    { platform: 'linux', arch: 'x64', triple: 'x86_64-unknown-linux-musl' },
    { platform: 'win32', arch: 'arm64', triple: 'aarch64-pc-windows-msvc' },
    { platform: 'win32', arch: 'x64', triple: 'x86_64-pc-windows-msvc' },
    { platform: 'freebsd', arch: 'x64', triple: 'freebsd-x64' }, // falls through to the `${platform}-${arch}` default
  ])('codex: resolves the $triple native binary for $platform/$arch', ({ platform, arch, triple }) => {
    const originalPlatform = process.platform;
    const originalArch = process.arch;
    Object.defineProperty(process, 'platform', { value: platform });
    Object.defineProperty(process, 'arch', { value: arch });
    try {
      const suffix = `${platform}-${arch}`;
      const codexDir = path.join(dir, 'node_modules', '@openai', `codex-${suffix}`, 'vendor', triple, 'codex');
      mkdirSync(codexDir, { recursive: true });
      const nativeBinary = path.join(codexDir, 'codex');
      makeExecutable(nativeBinary, 'native binary stub');

      // `executableFilePath` (executables.ts) gates a configured-env
      // override on `looksExecutableOnWindows` (PATHEXT match) whenever
      // process.platform reads as 'win32' — give the wrapper a `.exe`
      // extension so the override still resolves under the spoofed
      // win32 cases in this matrix, same as it would on real Windows.
      const wrapperPath = path.join(dir, 'codex-wrapper.exe');
      makeExecutable(wrapperPath, '#!/usr/bin/env node\nrequire("@openai/codex-cli");\n');

      const def = makeDef({ id: 'codex', bin: 'codex' });
      const result = resolveAgentLaunch({ def: def }, { configuredEnv: { CODEX_BIN: wrapperPath } });

      expect(result.launchKind).toBe('codex-native');
      expect(result.launchPath).toBe(nativeBinary);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      Object.defineProperty(process, 'arch', { value: originalArch });
    }
  });

  it('codex: skips a candidate path that exists but is a directory, not a file', () => {
    const suffix = `${process.platform}-${process.arch}`;
    const scopedDir = path.join(dir, 'node_modules', '@openai', `codex-${suffix}`);
    // `dir/codex` (one of codexNativeCandidates' fallback shapes) exists
    // but as a directory, not a file — isExecutableFile's `!isFile()`
    // guard must reject it and keep searching rather than throwing or
    // treating the directory itself as a launchable binary.
    mkdirSync(path.join(scopedDir, 'codex'), { recursive: true });

    const wrapperPath = path.join(dir, 'codex-wrapper.js');
    makeExecutable(wrapperPath, '#!/usr/bin/env node\nrequire("@openai/codex-cli");\n');

    const def = makeDef({ id: 'codex', bin: 'codex' });
    const result = resolveAgentLaunch({ def: def }, { configuredEnv: { CODEX_BIN: wrapperPath } });

    // No real native binary anywhere -> falls back to the wrapper with a diagnostic.
    expect(result.launchKind).toBe('selected');
    expect(result.launchPath).toBe(wrapperPath);
    expect(result.diagnostic).toContain('Codex native binary was not found');
  });

  it('codex: iterates every codex-* package directory under node_modules/@openai, not just the exact suffix match', () => {
    const otherSuffix = 'some-other-platform-arch';
    const triple = targetTripleForCurrentHost();
    const scopedDir = path.join(dir, 'node_modules', '@openai', `codex-${otherSuffix}`);
    const codexDir = path.join(scopedDir, 'vendor', triple, 'codex');
    mkdirSync(codexDir, { recursive: true });
    const nativeBinary = path.join(codexDir, 'codex');
    makeExecutable(nativeBinary, 'native binary stub');

    const wrapperPath = path.join(dir, 'codex-wrapper.js');
    makeExecutable(wrapperPath, '#!/usr/bin/env node\nrequire("@openai/codex-cli");\n');

    const def = makeDef({ id: 'codex', bin: 'codex' });
    const result = resolveAgentLaunch({ def: def }, { configuredEnv: { CODEX_BIN: wrapperPath } });

    expect(result.launchKind).toBe('codex-native');
    expect(result.launchPath).toBe(nativeBinary);
  });
});

describe('applyAgentLaunchEnv', () => {
  it('returns env unchanged when there is nothing to prepend or append', () => {
    const env = { PATH: '/usr/bin' };
    const result = applyAgentLaunchEnv({ env: env, launch: { childPathPrepend: [] } }, { nodeBinDir: '', appendPathDirs: [] });
    expect(result).toBe(env);
  });

  it('prepends the node bin dir and childPathPrepend dirs to PATH', () => {
    const env = { PATH: '/usr/bin' };
    const result = applyAgentLaunchEnv({ env: env, launch: { childPathPrepend: ['/agent/dir'] } }, { nodeBinDir: '/node/bin', appendPathDirs: [] });
    expect(result.PATH).toBe(['/node/bin', '/agent/dir', '/usr/bin'].join(path.delimiter));
  });

  it('finds a case-insensitive PATH key (Windows "Path")', () => {
    const env = { Path: 'C:\\Windows\\System32' };
    const result = applyAgentLaunchEnv({ env: env, launch: { childPathPrepend: ['C:\\agent'] } }, { nodeBinDir: 'C:\\node', appendPathDirs: [] });
    expect(result.Path).toBe(['C:\\node', 'C:\\agent', 'C:\\Windows\\System32'].join(path.delimiter));
    expect(result.PATH).toBeUndefined();
  });

  it('defaults to a "PATH" key when no existing path-shaped key is present', () => {
    const env = {};
    const result = applyAgentLaunchEnv({ env: env, launch: { childPathPrepend: [] } }, { nodeBinDir: '/node/bin', appendPathDirs: ['/append/dir'] });
    expect(result.PATH).toBe(['/node/bin', '/append/dir'].join(path.delimiter));
  });

  it('deduplicates directories that already appear in PATH, keeping the first occurrence', () => {
    const env = { PATH: ['/dup', '/other'].join(path.delimiter) };
    const result = applyAgentLaunchEnv({ env: env, launch: { childPathPrepend: ['/dup'] } }, { nodeBinDir: '', appendPathDirs: [] });
    expect(result.PATH).toBe(['/dup', '/other'].join(path.delimiter));
  });

  it('filters out empty PATH segments from the existing value', () => {
    const env = { PATH: ['', '/real', ''].join(path.delimiter) };
    const result = applyAgentLaunchEnv({ env: env, launch: { childPathPrepend: ['/new'] } }, { nodeBinDir: '', appendPathDirs: [] });
    expect(result.PATH).toBe(['/new', '/real'].join(path.delimiter));
  });

  it('appends appendPathDirs after the existing PATH entries', () => {
    const env = { PATH: '/existing' };
    const result = applyAgentLaunchEnv({ env: env, launch: { childPathPrepend: [] } }, { nodeBinDir: '', appendPathDirs: ['/appended'] });
    expect(result.PATH).toBe(['/existing', '/appended'].join(path.delimiter));
  });

  it('treats a non-string existing PATH value as empty', () => {
    const env = { PATH: undefined } as unknown as NodeJS.ProcessEnv;
    const result = applyAgentLaunchEnv({ env: env, launch: { childPathPrepend: ['/new'] } }, { nodeBinDir: '', appendPathDirs: [] });
    expect(result.PATH).toBe('/new');
  });

  it('omits the node bin dir from the prepend list when nodeBinDir is an empty string', () => {
    const env = { PATH: '/existing' };
    const result = applyAgentLaunchEnv({ env: env, launch: { childPathPrepend: ['/agent'] } }, { nodeBinDir: '', appendPathDirs: [] });
    expect(result.PATH).toBe(['/agent', '/existing'].join(path.delimiter));
  });

  it('defaults nodeBinDir to the dirname of process.execPath and appendPathDirs to the real user toolchain dirs', () => {
    const env = { PATH: '/existing' };
    const result = applyAgentLaunchEnv({ env: env, launch: { childPathPrepend: [] } });
    expect(result.PATH).toContain(path.dirname(process.execPath));
  });

  it('normalizes case and trailing slashes when deduplicating on win32', () => {
    // `node:path`'s exported `delimiter` is fixed to this (real, POSIX) host
    // at module-load time regardless of a later process.platform spoof, so
    // avoid a drive-letter colon in the path value here (it would otherwise
    // get split on ':' as if it were two PATH entries) — a UNC-shaped path
    // still exercises the win32-only lowercase/trailing-slash normalization
    // branch without colliding with the real POSIX delimiter.
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const env = { PATH: '\\\\server\\share\\Foo\\Bar\\' };
      const result = applyAgentLaunchEnv({ env: env, launch: { childPathPrepend: ['\\\\server\\share\\FOO\\BAR'] } }, { nodeBinDir: '', appendPathDirs: [] });
      // Same directory once case/trailing-slash normalized -> deduped to one entry.
      expect(result.PATH).toBe('\\\\server\\share\\FOO\\BAR');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});

// Characterization pins (L174): native-binary search order and acceptance
// for the Codex launch upgrade, written green against the pre-refactor code
// and kept unchanged through the refactor.
describe('resolveAgentLaunch characterization', () => {
  let dir: string;
  const suffix = `${process.platform}-${process.arch}`;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agent-runtime-launch-char-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function codexWrapper(at: string): string {
    mkdirSync(path.dirname(at), { recursive: true });
    makeExecutable(at, '#!/usr/bin/env node\n');
    return at;
  }

  function nativeAt(filePath: string): string {
    mkdirSync(path.dirname(filePath), { recursive: true });
    makeExecutable(filePath, 'native');
    return filePath;
  }

  function launchCodex(wrapperPath: string) {
    return resolveAgentLaunch({ def: makeDef({ id: 'codex', bin: 'codex' }) }, { configuredEnv: { CODEX_BIN: wrapperPath } });
  }

  it('prefers vendor/<triple>/codex/codex over the other layouts in the same package dir', () => {
    const pkg = path.join(dir, 'node_modules', '@openai', `codex-${suffix}`);
    const vendor = nativeAt(path.join(pkg, 'vendor', targetTripleForCurrentHost(), 'codex', 'codex'));
    nativeAt(path.join(pkg, 'codex'));
    nativeAt(path.join(pkg, 'bin', 'codex'));
    expect(launchCodex(codexWrapper(path.join(dir, 'codex'))).launchPath).toBe(vendor);
  });

  it('prefers <pkg>/codex over <pkg>/bin/codex and <pkg>/vendor/codex', () => {
    const pkg = path.join(dir, 'node_modules', '@openai', `codex-${suffix}`);
    const top = nativeAt(path.join(pkg, 'codex'));
    nativeAt(path.join(pkg, 'bin', 'codex'));
    nativeAt(path.join(pkg, 'vendor', 'codex'));
    expect(launchCodex(codexWrapper(path.join(dir, 'codex'))).launchPath).toBe(top);
  });

  it('prefers <pkg>/bin/codex over <pkg>/vendor/codex', () => {
    const pkg = path.join(dir, 'node_modules', '@openai', `codex-${suffix}`);
    const bin = nativeAt(path.join(pkg, 'bin', 'codex'));
    nativeAt(path.join(pkg, 'vendor', 'codex'));
    expect(launchCodex(codexWrapper(path.join(dir, 'codex'))).launchPath).toBe(bin);
  });

  it('accepts the <pkg>/bin/codex.exe layout when it is the only candidate', () => {
    const pkg = path.join(dir, 'node_modules', '@openai', `codex-${suffix}`);
    const exe = nativeAt(path.join(pkg, 'bin', 'codex.exe'));
    expect(launchCodex(codexWrapper(path.join(dir, 'codex'))).launchPath).toBe(exe);
  });

  it('checks the exact platform package before other codex-* packages', () => {
    const scoped = path.join(dir, 'node_modules', '@openai');
    nativeAt(path.join(scoped, 'codex-aaa-other', 'codex'));
    const exact = nativeAt(path.join(scoped, `codex-${suffix}`, 'bin', 'codex'));
    expect(launchCodex(codexWrapper(path.join(dir, 'codex'))).launchPath).toBe(exact);
  });

  it('ignores @openai entries that are files or not codex-* prefixed', () => {
    const scoped = path.join(dir, 'node_modules', '@openai');
    nativeAt(path.join(scoped, 'other-pkg', 'codex'));
    writeFileSync(path.join(scoped, 'codex-file'), 'x');
    const result = launchCodex(codexWrapper(path.join(dir, 'codex')));
    expect(result.launchKind).toBe('selected');
  });

  it('searches the nearest ancestor of the wrapper first', () => {
    nativeAt(path.join(dir, 'node_modules', '@openai', `codex-${suffix}`, 'codex'));
    const inner = nativeAt(path.join(dir, 'a', 'node_modules', '@openai', `codex-${suffix}`, 'codex'));
    expect(launchCodex(codexWrapper(path.join(dir, 'a', 'b', 'codex'))).launchPath).toBe(inner);
  });

  it('also searches the ancestors of the wrapper\'s realpath (symlinked npm bin)', () => {
    const real = codexWrapper(path.join(dir, 'lib', 'pkg', 'codex.js'));
    const native = nativeAt(path.join(dir, 'lib', 'node_modules', '@openai', `codex-${suffix}`, 'codex'));
    mkdirSync(path.join(dir, 'bin'));
    symlinkSync(real, path.join(dir, 'bin', 'codex'));
    // The symlink's own ancestors (dir/bin, dir, ...) are searched before the
    // realpath's, so keep dir itself free of a node_modules tree.
    expect(launchCodex(path.join(dir, 'bin', 'codex')).launchPath).toBe(native);
  });

  it('launches a codex-* native binary from ANY ancestor directory up to the filesystem root, under any codex-* package name (reported, not fixed)', () => {
    const planted = nativeAt(path.join(dir, 'node_modules', '@openai', 'codex-anything', 'codex'));
    const result = launchCodex(codexWrapper(path.join(dir, 'x', 'y', 'z', 'codex')));
    expect(result.launchKind).toBe('codex-native');
    expect(result.launchPath).toBe(planted);
  });

  it('skips a native candidate that is not executable on posix', () => {
    const pkg = path.join(dir, 'node_modules', '@openai', `codex-${suffix}`);
    nativeAt(path.join(pkg, 'codex'));
    chmodSync(path.join(pkg, 'codex'), 0o644);
    const fallback = nativeAt(path.join(pkg, 'bin', 'codex'));
    expect(launchCodex(codexWrapper(path.join(dir, 'codex'))).launchPath).toBe(fallback);
  });

  it('prepends the wrapper dir, then the vendor path dir only when it exists', () => {
    const pkg = path.join(dir, 'node_modules', '@openai', `codex-${suffix}`);
    nativeAt(path.join(pkg, 'codex'));
    const wrapper = codexWrapper(path.join(dir, 'codex'));
    expect(launchCodex(wrapper).childPathPrepend).toEqual([dir]);
  });

  it('never upgrades a non-codex agent even when a native codex tree is present', () => {
    nativeAt(path.join(dir, 'node_modules', '@openai', `codex-${suffix}`, 'codex'));
    const wrapper = codexWrapper(path.join(dir, 'claude'));
    const result = resolveAgentLaunch({ def: makeDef({ id: 'claude', bin: 'claude' }) }, { configuredEnv: { CLAUDE_BIN: wrapper } });
    expect(result).toMatchObject({ launchPath: wrapper, launchKind: 'selected', childPathPrepend: [dir], diagnostic: null });
  });

  it('sniffs only the first 64000 bytes of the wrapper for a node marker', () => {
    const wrapper = path.join(dir, 'codex');
    makeExecutable(wrapper, `${'x'.repeat(64_000)}node`);
    expect(launchCodex(wrapper).diagnostic).toBeNull();
  });

  it('matches the wrapper markers case-insensitively and names suffix, triple and wrapper in the diagnostic', () => {
    const wrapper = path.join(dir, 'codex');
    makeExecutable(wrapper, 'require("@OpenAI/Codex")');
    expect(launchCodex(wrapper).diagnostic).toBe(
      `Codex native binary was not found for ${suffix}/${targetTripleForCurrentHost()}; falling back to wrapper ${wrapper}. Set CODEX_BIN to a native Codex binary if this wrapper cannot launch from a GUI environment.`,
    );
  });
});

describe('applyAgentLaunchEnv characterization', () => {
  it('keeps PATH entries case-sensitive on posix', () => {
    const result = applyAgentLaunchEnv({ env: { PATH: '/Foo' }, launch: { childPathPrepend: ['/foo'] } }, { nodeBinDir: '', appendPathDirs: [] });
    expect(result.PATH).toBe(['/foo', '/Foo'].join(path.delimiter));
  });

  it('dedupes trailing-slash variants on posix, keeping the first spelling', () => {
    const result = applyAgentLaunchEnv({ env: { PATH: '/usr/bin/' }, launch: { childPathPrepend: [] } }, { nodeBinDir: '/usr/bin', appendPathDirs: ['/usr/bin//'] });
    expect(result.PATH).toBe('/usr/bin');
  });

  it('returns a new env object and leaves the input untouched', () => {
    const env = { PATH: '/usr/bin', OTHER: 'x' };
    const result = applyAgentLaunchEnv({ env, launch: { childPathPrepend: ['/agent'] } }, { nodeBinDir: '', appendPathDirs: [] });
    expect(env).toEqual({ PATH: '/usr/bin', OTHER: 'x' });
    expect(result).toEqual({ PATH: ['/agent', '/usr/bin'].join(path.delimiter), OTHER: 'x' });
  });

  it('updates the first path-shaped key when several differ only by case', () => {
    const result = applyAgentLaunchEnv({ env: { Path: '/a', PATH: '/b' }, launch: { childPathPrepend: [] } }, { nodeBinDir: '/n', appendPathDirs: [] });
    expect(result).toEqual({ Path: ['/n', '/a'].join(path.delimiter), PATH: '/b' });
  });

  it('builds PATH from appendPathDirs alone when nothing is prepended', () => {
    const result = applyAgentLaunchEnv({ env: {}, launch: { childPathPrepend: [] } }, { nodeBinDir: '', appendPathDirs: ['/tool'] });
    expect(result).toEqual({ PATH: '/tool' });
  });
});
