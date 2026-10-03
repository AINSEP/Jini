import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadHostConfigFile } from '../config.js';

describe('loadHostConfigFile', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir != null) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('returns {} when no explicit path is set and no candidate exists', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-config-'));
    const config = await loadHostConfigFile({ candidatePaths: [join(dir, 'missing.json')] }, { env: {} });
    expect(config).toEqual({});
  });

  it('reads the first existing candidate path', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-config-'));
    const configPath = join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify({ hello: 'world' }), 'utf8');
    const config = await loadHostConfigFile({ candidatePaths: [join(dir, 'missing.json'), configPath] }, { env: {} });
    expect(config).toEqual({ hello: 'world' });
  });

  it('falls back to process.env when no env is supplied', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-config-'));
    const config = await loadHostConfigFile({ candidatePaths: [join(dir, 'missing.json')] });
    expect(config).toEqual({});
  });

  it('falls through to candidatePaths when the explicit-path env var is set but empty', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-config-'));
    const configPath = join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify({ fallback: true }), 'utf8');
    const config = await loadHostConfigFile({ candidatePaths: [configPath] }, { explicitPathEnvVar: 'JINI_HOST_CONFIG_PATH', env: { JINI_HOST_CONFIG_PATH: '' } });
    expect(config).toEqual({ fallback: true });
  });

  it('prefers the explicit-path env var override and throws if that file is missing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-config-'));
    await expect(
      loadHostConfigFile({ candidatePaths: [] }, { explicitPathEnvVar: 'JINI_HOST_CONFIG_PATH', env: { JINI_HOST_CONFIG_PATH: join(dir, 'missing.json') } }),
    ).rejects.toThrow(/host config not found/);

    const configPath = join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify({ ok: true }), 'utf8');
    const config = await loadHostConfigFile({ candidatePaths: [] }, { explicitPathEnvVar: 'JINI_HOST_CONFIG_PATH', env: { JINI_HOST_CONFIG_PATH: configPath } });
    expect(config).toEqual({ ok: true });
  });
});
