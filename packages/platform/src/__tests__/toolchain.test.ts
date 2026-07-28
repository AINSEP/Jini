import { symlinkSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { wellKnownUserToolchainBins } from '../toolchain.js';

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const previous = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return run();
  } finally {
    Object.defineProperty(process, 'platform', { value: previous });
  }
}

const tempDirsToClean: string[] = [];

afterEach(async () => {
  while (tempDirsToClean.length > 0) {
    const dir = tempDirsToClean.pop();
    if (dir) await rm(dir, { force: true, recursive: true });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirsToClean.push(dir);
  return dir;
}

describe('@jini-ai/platform — toolchain — option defaults', () => {
  it('defaults home to os.homedir() and env to process.env when both are omitted', () => {
    const dirs = wellKnownUserToolchainBins();
    expect(dirs).toContain(join(homedir(), '.local', 'bin'));
  });
});

describe('@jini-ai/platform — toolchain — ~-prefixed env overrides', () => {
  it('expands a bare "~" VP_HOME to the home dir itself', () => {
    const dirs = wellKnownUserToolchainBins({ env: { VP_HOME: '~' }, home: '/home/fakeuser' });
    expect(dirs[0]).toBe(join('/home/fakeuser', 'bin'));
  });

  it('expands a "~/" VP_HOME relative to home', () => {
    const dirs = wellKnownUserToolchainBins({ env: { VP_HOME: '~/tools/vp' }, home: '/home/fakeuser' });
    expect(dirs[0]).toBe(join('/home/fakeuser', 'tools/vp', 'bin'));
  });

  it('expands a "~\\\\" (backslash) VP_HOME relative to home', () => {
    const dirs = wellKnownUserToolchainBins({ env: { VP_HOME: '~\\tools\\vp' }, home: '/home/fakeuser' });
    expect(dirs[0]).toBe(join('/home/fakeuser', 'tools\\vp', 'bin'));
  });

  it('ignores a VP_HOME that is neither absolute nor home-relative', () => {
    const dirs = wellKnownUserToolchainBins({ env: { VP_HOME: 'relative/not/home' }, home: '/home/fakeuser' });
    expect(dirs).not.toContain(join('relative/not/home', 'bin'));
  });

  it('ignores a blank VP_HOME', () => {
    const dirs = wellKnownUserToolchainBins({ env: { VP_HOME: '   ' }, home: '/home/fakeuser' });
    expect(dirs[0]).not.toBe(join('/home/fakeuser', 'bin'));
  });

  it('honors an absolute VP_HOME as-is', () => {
    const dirs = wellKnownUserToolchainBins({ env: { VP_HOME: '/opt/vp' }, home: '/home/fakeuser' });
    expect(dirs[0]).toBe(join('/opt/vp', 'bin'));
  });

  it('expands a home-relative MISE_DATA_DIR and skips the legacy ~/.mise/shims fallback', () => {
    const dirs = wellKnownUserToolchainBins({
      env: { MISE_DATA_DIR: '~/custom-mise' },
      home: '/home/fakeuser',
      includeSystemBins: false,
    });
    expect(dirs).toContain(join('/home/fakeuser', 'custom-mise', 'shims'));
    expect(dirs).not.toContain(join('/home/fakeuser', '.mise', 'shims'));
  });

  it('falls back to the default mise data dir and includes the legacy shims path when MISE_DATA_DIR is unset', () => {
    const dirs = wellKnownUserToolchainBins({ env: {}, home: '/home/fakeuser', includeSystemBins: false });
    expect(dirs).toContain(join('/home/fakeuser', '.local', 'share', 'mise', 'shims'));
    expect(dirs).toContain(join('/home/fakeuser', '.mise', 'shims'));
  });
});

describe('@jini-ai/platform — toolchain — npm prefix handling', () => {
  it('ignores a whitespace-only NPM_CONFIG_PREFIX without throwing', () => {
    expect(() =>
      wellKnownUserToolchainBins({ env: { NPM_CONFIG_PREFIX: '   ' }, home: '/home/fakeuser' }),
    ).not.toThrow();
    const dirs = wellKnownUserToolchainBins({ env: { NPM_CONFIG_PREFIX: '   ' }, home: '/home/fakeuser' });
    expect(dirs).not.toContain(join('   ', 'bin'));
  });

  it('falls back to the lowercase npm_config_prefix when NPM_CONFIG_PREFIX is unset', () => {
    const dirs = wellKnownUserToolchainBins({ env: { npm_config_prefix: '/custom/lower-prefix' }, home: '/home/fakeuser' });
    expect(dirs[0]).toBe(join('/custom/lower-prefix', 'bin'));
  });

  it('also pushes the bare prefix root on Windows (no /bin subdir there)', () => {
    withPlatform('win32', () => {
      const dirs = wellKnownUserToolchainBins({ env: { NPM_CONFIG_PREFIX: 'C:\\npm-prefix' }, home: 'C:\\Users\\fake' });
      expect(dirs).toContain(join('C:\\npm-prefix', 'bin'));
      expect(dirs).toContain('C:\\npm-prefix');
    });
  });

  it('adds the default %APPDATA%\\npm location on Windows when no explicit prefix is set', () => {
    withPlatform('win32', () => {
      const dirs = wellKnownUserToolchainBins({ env: {}, home: 'C:\\Users\\fake' });
      expect(dirs).toContain(join('C:\\Users\\fake', 'AppData', 'Roaming', 'npm'));
    });
  });
});

describe('@jini-ai/platform — toolchain — Windows-only scoop/appdata and fnm roots', () => {
  it('adds scoop shims and %APPDATA%\\npm when APPDATA is set', () => {
    withPlatform('win32', () => {
      const dirs = wellKnownUserToolchainBins({ env: { APPDATA: 'C:\\Users\\fake\\AppData\\Roaming' }, home: 'C:\\Users\\fake' });
      expect(dirs).toContain(join('C:\\Users\\fake', 'scoop', 'shims'));
      expect(dirs).toContain(join('C:\\Users\\fake\\AppData\\Roaming', 'npm'));
    });
  });

  it('adds scoop shims but skips the APPDATA\\npm entry when APPDATA is blank', () => {
    withPlatform('win32', () => {
      const dirs = wellKnownUserToolchainBins({ env: { APPDATA: '   ' }, home: 'C:\\Users\\fake' });
      expect(dirs).toContain(join('C:\\Users\\fake', 'scoop', 'shims'));
      // The unconditional home-based %APPDATA%\npm default (line ~114-116)
      // still appears; only the APPDATA-env-derived duplicate (line ~148-153)
      // must be absent for a blank APPDATA. A bare "npm" entry (what
      // `join(appData.trim(), 'npm')` collapses to for a blank input) would
      // reveal the bug if the length guard were missing.
      expect(dirs).not.toContain('npm');
      expect(dirs.filter((dir) => dir === join('C:\\Users\\fake', 'AppData', 'Roaming', 'npm'))).toHaveLength(1);
    });
  });

  it('probes an explicit FNM_DIR node-versions root on Windows', async () => {
    const fnmDir = await makeTempDir('jini-toolchain-fnmdir-');
    const versionDir = join(fnmDir, 'node-versions', '20.0.0', 'installation');
    await mkdir(versionDir, { recursive: true });
    const dirs = withPlatform('win32', () =>
      wellKnownUserToolchainBins({ env: { FNM_DIR: fnmDir }, home: 'C:\\Users\\fake' }),
    );
    expect(dirs).toContain(versionDir);
  });

  it('falls back to LOCALAPPDATA/APPDATA-derived fnm roots when FNM_DIR is unset, skipping an unset base', async () => {
    const localAppData = await makeTempDir('jini-toolchain-localappdata-');
    const versionDir = join(localAppData, 'fnm', 'node-versions', '18.5.0', 'installation');
    await mkdir(versionDir, { recursive: true });
    const dirs = withPlatform('win32', () =>
      wellKnownUserToolchainBins({ env: { LOCALAPPDATA: localAppData }, home: 'C:\\Users\\fake' }),
    );
    expect(dirs).toContain(versionDir);
  });

  it('does not probe any fnm root when neither FNM_DIR, LOCALAPPDATA, nor APPDATA is set', () => {
    const dirs = withPlatform('win32', () => wellKnownUserToolchainBins({ env: {}, home: 'C:\\Users\\fake' }));
    expect(dirs.some((dir) => dir.includes('fnm'))).toBe(false);
  });
});

describe('@jini-ai/platform — toolchain — per-version Node install root discovery', () => {
  it('surfaces installed version bin dirs sorted newest-first, handling semver, "v"-prefixes, symlinks, non-semver names, missing bin dirs, and non-directory entries', async () => {
    const home = await makeTempDir('jini-toolchain-nvm-');
    const nodeVersionsRoot = join(home, '.nvm', 'versions', 'node');

    const withBin = async (name: string) => {
      await mkdir(join(nodeVersionsRoot, name, 'bin'), { recursive: true });
    };

    // Same major+minor, differ only at patch — forces the semver comparator
    // to fall through the major/minor "difference === 0" continue branches.
    await withBin('9.1.1');
    await withBin('9.1.5');
    // Same major, differ at minor.
    await withBin('9.2.0');
    await withBin('20.11.0');
    await withBin('18.2.0');
    await withBin('v21.0.0');
    // A directory with no bin subdir: existsSync(candidate) is false, so it
    // must be excluded from the result even though it parses as semver.
    await mkdir(join(nodeVersionsRoot, '16.0.0-nobin'), { recursive: true });
    // Non-semver-parseable name (fails the `^v?(\d+)\.(\d+)\.(\d+)$` regex
    // due to the trailing suffix) but does have a bin dir — included, sorted
    // after every semver-parseable entry.
    await withBin('nightly');
    // A plain file sitting in the install root — must be skipped entirely
    // (fails both isDirectory() and isSymbolicLink()).
    await writeFile(join(nodeVersionsRoot, 'not-a-dir.txt'), 'nope', 'utf8');
    // A symlink to a directory with its own bin dir — must be treated like a
    // directory (isSymbolicLink() branch) and included.
    await mkdir(join(home, '.nvm-real-22'), { recursive: true });
    await mkdir(join(home, '.nvm-real-22', 'bin'), { recursive: true });
    symlinkSync(join(home, '.nvm-real-22'), join(nodeVersionsRoot, '22.0.0'));

    const dirs = wellKnownUserToolchainBins({ env: {}, home, includeSystemBins: false });
    const nvmDirs = dirs.filter((dir) => dir.startsWith(nodeVersionsRoot));

    expect(nvmDirs).toEqual([
      join(nodeVersionsRoot, '22.0.0', 'bin'),
      join(nodeVersionsRoot, 'v21.0.0', 'bin'),
      join(nodeVersionsRoot, '20.11.0', 'bin'),
      join(nodeVersionsRoot, '18.2.0', 'bin'),
      join(nodeVersionsRoot, '9.2.0', 'bin'),
      join(nodeVersionsRoot, '9.1.5', 'bin'),
      join(nodeVersionsRoot, '9.1.1', 'bin'),
      join(nodeVersionsRoot, 'nightly', 'bin'),
    ]);
  });

  it('surfaces an npm-openai-codex bin dir installed under the mise installs root', async () => {
    const home = await makeTempDir('jini-toolchain-mise-npm-pkg-');
    const packageBin = join(home, '.local', 'share', 'mise', 'installs', 'npm-openai-codex', '1.2.3', 'bin');
    await mkdir(packageBin, { recursive: true });

    const dirs = wellKnownUserToolchainBins({ env: {}, home, includeSystemBins: false });
    expect(dirs).toContain(packageBin);
  });

  it('falls through to a locale-compare tie-break when two names parse to the identical numeric version', async () => {
    const home = await makeTempDir('jini-toolchain-tie-');
    const nodeVersionsRoot = join(home, '.nvm', 'versions', 'node');
    await mkdir(join(nodeVersionsRoot, '1.0.0', 'bin'), { recursive: true });
    // A leading zero: `parseVersionLikeDirName` parses digits with `Number(...)`,
    // so "01.0.0" and "1.0.0" produce the identical [1, 0, 0] tuple — the
    // major/minor/patch loop finds a zero difference at every index and must
    // fall through to the locale-compare tie-break instead of returning early.
    await mkdir(join(nodeVersionsRoot, '01.0.0', 'bin'), { recursive: true });

    const dirs = wellKnownUserToolchainBins({ env: {}, home, includeSystemBins: false });
    const nvmDirs = dirs.filter((dir) => dir.startsWith(nodeVersionsRoot));
    expect(new Set(nvmDirs)).toEqual(
      new Set([join(nodeVersionsRoot, '1.0.0', 'bin'), join(nodeVersionsRoot, '01.0.0', 'bin')]),
    );
  });

  it('returns no per-version entries (without throwing) when no install roots exist', async () => {
    const home = await makeTempDir('jini-toolchain-empty-');
    expect(() => wellKnownUserToolchainBins({ env: {}, home, includeSystemBins: false })).not.toThrow();
    const dirs = wellKnownUserToolchainBins({ env: {}, home, includeSystemBins: false });
    expect(dirs.some((dir) => dir.includes('.nvm'))).toBe(false);
  });
});
