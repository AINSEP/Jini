import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveDaemonCliPath,
  resolveDaemonPluginPreviewsDir,
  resolveDaemonResourceDir,
  resolveDaemonResourceRoot,
  resolveDataDir,
  resolveProcessResourcesPath,
  type ResourcePathsConfig,
} from '../resource-paths.js';

const CONFIG: ResourcePathsConfig = {
  cliPathEnvVar: 'FAKE_CLI_PATH',
  cliPathFallbackEnvVar: 'FAKE_CLI_PATH_LEGACY',
  cliPackageName: 'vitest',
  resourceRootEnvVar: 'FAKE_RESOURCE_ROOT',
  pluginPreviewsDirEnvVar: 'FAKE_PLUGIN_PREVIEWS_DIR',
  dataDirEnvVar: 'FAKE_DATA_DIR',
  defaultDataDirName: '.fake',
  windowsResourceBinSegment: 'fakeapp',
};

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

describe('@injini/platform — resource-paths — resolveDaemonCliPath', () => {
  it('prefers the primary env var', () => {
    expect(resolveDaemonCliPath(CONFIG, { [CONFIG.cliPathEnvVar]: '/explicit/cli.js' })).toBe(
      path.resolve('/explicit/cli.js'),
    );
  });

  it('falls back to the legacy env var', () => {
    expect(resolveDaemonCliPath(CONFIG, { [CONFIG.cliPathFallbackEnvVar]: '/legacy/cli.js' })).toBe(
      path.resolve('/legacy/cli.js'),
    );
  });

  it('resolves the CLI package location when neither env var is set', () => {
    const resolved = resolveDaemonCliPath(CONFIG, {});
    expect(resolved.endsWith(path.join('dist', 'cli.js'))).toBe(true);
  });
});

describe('@injini/platform — resource-paths — resolveProcessResourcesPath', () => {
  it('returns resourcesPath when present', () => {
    expect(
      resolveProcessResourcesPath(CONFIG, { resourcesPath: '/app/Resources', execPath: '/app/exec' }),
    ).toBe('/app/Resources');
  });

  it('extracts a macOS Contents/Resources marker from execPath', () => {
    const execPath = `/Applications/Fake.app/Contents/Resources/bin/fake`.split('/').join(path.sep);
    const resolved = resolveProcessResourcesPath(CONFIG, { execPath });
    expect(resolved).toBe(`/Applications/Fake.app/Contents/Resources`.split('/').join(path.sep));
  });

  it('extracts a Windows resources/<segment>/bin marker case-insensitively', () => {
    const execPath = `C:${path.sep}Program Files${path.sep}Fake${path.sep}resources${path.sep}FakeApp${path.sep}bin${path.sep}fake.exe`;
    const resolved = resolveProcessResourcesPath(CONFIG, { execPath });
    expect(resolved).toBe(`C:${path.sep}Program Files${path.sep}Fake${path.sep}resources`);
  });

  it('returns null when no marker matches', () => {
    expect(resolveProcessResourcesPath(CONFIG, { execPath: '/usr/local/bin/node' })).toBeNull();
  });
});

describe('@injini/platform — resource-paths — resolveDaemonResourceRoot', () => {
  it('returns null when unconfigured', () => {
    expect(resolveDaemonResourceRoot(CONFIG, { configured: '' })).toBeNull();
    expect(resolveDaemonResourceRoot(CONFIG, {})).toBeNull();
  });

  it('returns the resolved path when within a safe base', () => {
    expect(
      resolveDaemonResourceRoot(CONFIG, { configured: '/workspace/root/sub', safeBases: ['/workspace/root'] }),
    ).toBe(path.resolve('/workspace/root/sub'));
  });

  it('throws when no safe base is provided', () => {
    expect(() => resolveDaemonResourceRoot(CONFIG, { configured: '/anywhere' })).toThrow(
      /FAKE_RESOURCE_ROOT must be under/,
    );
  });

  it('throws when the configured path escapes every safe base', () => {
    expect(() =>
      resolveDaemonResourceRoot(CONFIG, { configured: '/elsewhere', safeBases: ['/workspace/root', null, undefined] }),
    ).toThrow(/FAKE_RESOURCE_ROOT must be under/);
  });
});

describe('@injini/platform — resource-paths — resolveDaemonResourceDir', () => {
  it('joins under the resource root when present', () => {
    expect(resolveDaemonResourceDir('/resources', 'data/x', '/fallback')).toBe(path.join('/resources', 'data/x'));
  });

  it('uses the fallback when resourceRoot is null', () => {
    expect(resolveDaemonResourceDir(null, 'data/x', '/fallback')).toBe('/fallback');
  });
});

describe('@injini/platform — resource-paths — resolveDaemonPluginPreviewsDir', () => {
  it('returns an absolute override as-is', () => {
    expect(
      resolveDaemonPluginPreviewsDir(CONFIG, {
        env: { [CONFIG.pluginPreviewsDirEnvVar]: '/abs/previews' },
        resourceRoot: null,
        projectRoot: '/project',
      }),
    ).toBe('/abs/previews');
  });

  it('resolves a relative override against projectRoot', () => {
    expect(
      resolveDaemonPluginPreviewsDir(CONFIG, {
        env: { [CONFIG.pluginPreviewsDirEnvVar]: 'rel/previews' },
        resourceRoot: null,
        projectRoot: '/project',
      }),
    ).toBe(path.resolve('/project', 'rel/previews'));
  });

  it('uses the resource root when no override is set', () => {
    expect(
      resolveDaemonPluginPreviewsDir(CONFIG, { env: {}, resourceRoot: '/resources', projectRoot: '/project' }),
    ).toBe(path.join('/resources', 'data', 'plugin-previews'));
  });

  it('falls back to the project root when neither override nor resource root is set', () => {
    expect(resolveDaemonPluginPreviewsDir(CONFIG, { env: {}, resourceRoot: null, projectRoot: '/project' })).toBe(
      path.join('/project', 'data', 'plugin-previews'),
    );
  });
});

describe('@injini/platform — resource-paths — resolveDataDir', () => {
  it('defaults to <projectRoot>/<defaultDataDirName> when unset', () => {
    expect(resolveDataDir(CONFIG, undefined, '/project')).toBe(path.join('/project', '.fake'));
    expect(resolveDataDir(CONFIG, '   ', '/project')).toBe(path.join('/project', '.fake'));
  });

  it('throws when unset and requireExplicit is set', () => {
    expect(() => resolveDataDir(CONFIG, undefined, '/project', { requireExplicit: true })).toThrow(
      /FAKE_DATA_DIR is required/,
    );
  });

  it('creates and returns a writable explicit data dir, expanding home-relative values', async () => {
    const parent = await makeTempDir('jini-resource-paths-datadir-');
    const target = join(parent, 'nested', 'data');
    const resolved = resolveDataDir(CONFIG, target, '/unused-root');
    expect(resolved).toBe(target);
    expect(existsSync(target)).toBe(true);
  });

  it('throws a diagnostic error when the target cannot be created', async () => {
    const parent = await makeTempDir('jini-resource-paths-datadir-blocked-');
    const blockerFile = join(parent, 'blocker');
    await writeFile(blockerFile, 'not a directory', 'utf8');
    const target = join(blockerFile, 'nested');
    expect(() => resolveDataDir(CONFIG, target, '/unused-root')).toThrow(/FAKE_DATA_DIR ".*" is not writable/);
  });

  it('falls back to $USER/$LOGNAME/"unknown" in the diagnostic when os.userInfo() itself throws', async () => {
    const parent = await makeTempDir('jini-resource-paths-datadir-blocked-');
    const blockerFile = join(parent, 'blocker');
    await writeFile(blockerFile, 'not a directory', 'utf8');
    const target = join(blockerFile, 'nested');

    const spy = vi.spyOn(os, 'userInfo').mockImplementation(() => {
      throw new Error('user info unavailable in this environment');
    });
    try {
      expect(() => resolveDataDir(CONFIG, target, '/unused-root')).toThrow(/Current user: /);
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back specifically to $LOGNAME when $USER is unset, and to "unknown" when neither is set', async () => {
    const spy = vi.spyOn(os, 'userInfo').mockImplementation(() => {
      throw new Error('user info unavailable in this environment');
    });
    const previousUser = process.env.USER;
    const previousLogname = process.env.LOGNAME;
    try {
      const parent = await makeTempDir('jini-resource-paths-datadir-blocked-');
      const blockerFile = join(parent, 'blocker');
      await writeFile(blockerFile, 'not a directory', 'utf8');

      delete process.env.USER;
      process.env.LOGNAME = 'fallback-logname';
      expect(() => resolveDataDir(CONFIG, join(blockerFile, 'nested'), '/unused-root')).toThrow(
        /Current user: fallback-logname/,
      );

      delete process.env.USER;
      delete process.env.LOGNAME;
      expect(() => resolveDataDir(CONFIG, join(blockerFile, 'nested'), '/unused-root')).toThrow(
        /Current user: unknown/,
      );
    } finally {
      spy.mockRestore();
      if (previousUser === undefined) delete process.env.USER;
      else process.env.USER = previousUser;
      if (previousLogname === undefined) delete process.env.LOGNAME;
      else process.env.LOGNAME = previousLogname;
    }
  });
});
