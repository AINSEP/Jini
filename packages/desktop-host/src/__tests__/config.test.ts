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
    const config = await loadHostConfigFile({ candidatePaths: [join(dir, 'missing.json')], explicitPath: undefined });
    expect(config).toEqual({});
  });

  it('reads the first existing candidate path', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-config-'));
    const configPath = join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify({ hello: 'world' }), 'utf8');
    const config = await loadHostConfigFile({ candidatePaths: [join(dir, 'missing.json'), configPath], explicitPath: undefined });
    expect(config).toEqual({ hello: 'world' });
  });

  it('rejects a missing explicit file even when a valid candidate exists', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-config-'));
    const candidate = join(dir, 'candidate.json');
    const missing = join(dir, 'missing.json');
    await writeFile(candidate, JSON.stringify({ fallback: true }), 'utf8');
    await expect(loadHostConfigFile({ candidatePaths: [candidate], explicitPath: missing }))
      .rejects.toThrow(`host config not found at ${missing}`);
  });

  it('uses candidates when the explicit path is absent', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-config-'));
    const config = await loadHostConfigFile({ candidatePaths: [join(dir, 'missing.json')], explicitPath: undefined });
    expect(config).toEqual({});
  });

  it('falls through to candidatePaths when the explicit-path env var is set but empty', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-config-'));
    const configPath = join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify({ fallback: true }), 'utf8');
    const config = await loadHostConfigFile({ candidatePaths: [configPath], explicitPath: '' });
    expect(config).toEqual({ fallback: true });
  });

  it('prefers the explicit-path env var override and throws if that file is missing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'jini-desktop-host-config-'));
    await expect(
      loadHostConfigFile({ candidatePaths: [], explicitPath: join(dir, 'missing.json') }),
    ).rejects.toThrow(/host config not found/);

    const configPath = join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify({ ok: true }), 'utf8');
    const config = await loadHostConfigFile({ candidatePaths: [], explicitPath: configPath });
    expect(config).toEqual({ ok: true });
  });
});
