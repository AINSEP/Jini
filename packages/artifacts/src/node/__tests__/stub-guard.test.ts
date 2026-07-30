import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMockState = vi.hoisted(() => ({
  statImpl: null as ((...args: unknown[]) => Promise<unknown>) | null,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: (...args: unknown[]) =>
      fsMockState.statImpl ? fsMockState.statImpl(...args) : (actual.stat as (...a: unknown[]) => Promise<unknown>)(...args),
  };
});

import { DEFAULT_ARTIFACT_STUB_GUARD_CONFIG, EMPTY_SLUG_FALLBACK_NAME, type ArtifactStubGuardConfig } from '../../stub-guard.js';
import { evaluateArtifactStubGuard, findPriorArtifactSiblings } from '../stub-guard.js';

describe('findPriorArtifactSiblings / evaluateArtifactStubGuard (filesystem-backed)', () => {
  let scanDir: string;

  beforeEach(async () => {
    scanDir = await mkdtemp(path.join(tmpdir(), 'stub-guard-'));
  });

  afterEach(async () => {
    await rm(scanDir, { recursive: true, force: true });
    fsMockState.statImpl = null;
  });

  const config: ArtifactStubGuardConfig = DEFAULT_ARTIFACT_STUB_GUARD_CONFIG;

  it('returns [] for an empty identifier or an unreadable directory', async () => {
    expect(await findPriorArtifactSiblings(scanDir, '', config)).toEqual([]);
    expect(await findPriorArtifactSiblings(path.join(scanDir, 'nope'), 'id', config)).toEqual([]);
  });

  it('returns [] when siblingExtensions is empty', async () => {
    await writeFile(path.join(scanDir, 'dashboard.html'), 'x'.repeat(5000));
    expect(await findPriorArtifactSiblings(scanDir, 'dashboard', { ...config, siblingExtensions: [] })).toEqual([]);
  });

  it('finds a same-name sibling by exact identifier match', async () => {
    await writeFile(path.join(scanDir, 'dashboard.html'), 'x'.repeat(5000));
    const siblings = await findPriorArtifactSiblings(scanDir, 'dashboard', config);
    expect(siblings).toEqual([{ name: 'dashboard.html', size: 5000 }]);
  });

  it('finds a collision-suffixed sibling (dashboard-2.html)', async () => {
    await writeFile(path.join(scanDir, 'dashboard-2.html'), 'x'.repeat(3000));
    const siblings = await findPriorArtifactSiblings(scanDir, 'dashboard', config);
    expect(siblings.map((s) => s.name)).toEqual(['dashboard-2.html']);
  });

  it('finds a sibling via its slug form (Landing Page -> landing-page.html)', async () => {
    await writeFile(path.join(scanDir, 'landing-page.html'), 'x'.repeat(3000));
    const siblings = await findPriorArtifactSiblings(scanDir, 'Landing Page', config);
    expect(siblings.map((s) => s.name)).toEqual(['landing-page.html']);
  });

  it('the empty-slug fallback name widens the readdir filename filter, but artifactIdentifiersMatch still rejects an all-non-ASCII search identifier (matches artifactIdentifiersMatch\'s own documented empty-slug-vs-empty-slug caution)', async () => {
    await writeFile(path.join(scanDir, `${EMPTY_SLUG_FALLBACK_NAME}-2.html`), 'x'.repeat(3000));
    // "artifact-2.html" passes the readdir regex pre-filter (built with the
    // EMPTY_SLUG_FALLBACK_NAME token, since slugifyArtifactIdentifier('测试')
    // is empty) — but the final artifactIdentifiersMatch('测试', 'artifact')
    // check short-circuits false whenever the search identifier's own slug
    // is empty, so nothing is ever returned via this path. Intentional per
    // artifactIdentifiersMatch's own doc comment (avoids two distinct
    // non-ASCII identifiers being falsely bridged); this proves the
    // pre-filter widening doesn't accidentally bypass that guard.
    const siblings = await findPriorArtifactSiblings(scanDir, '测试', config);
    expect(siblings).toEqual([]);
  });

  it('ignores non-file entries (directories) and non-matching extensions', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.join(scanDir, 'dashboard.html'));
    await writeFile(path.join(scanDir, 'dashboard.css'), 'x');
    expect(await findPriorArtifactSiblings(scanDir, 'dashboard', config)).toEqual([]);
  });

  it('prefers the sidecar .artifact.json identifier over filename inference, avoiding a false-positive filename collision', async () => {
    // "weird-2.html" filename-matches a search for "weird" (identifier +
    // "-2" collision suffix) — but the sidecar says this file's real
    // identifier is unrelated, so the sidecar overrides the naive
    // filename-only guess and the match is correctly rejected.
    await writeFile(path.join(scanDir, 'weird-2.html'), 'x'.repeat(3000));
    await writeFile(
      path.join(scanDir, 'weird-2.html.artifact.json'),
      JSON.stringify({ metadata: { identifier: 'totally-unrelated' } }),
    );
    expect(await findPriorArtifactSiblings(scanDir, 'weird', config)).toEqual([]);
  });

  it('ignores a sidecar with a malformed/missing identifier and falls back to filename inference', async () => {
    await writeFile(path.join(scanDir, 'dashboard.html'), 'x'.repeat(3000));
    await writeFile(path.join(scanDir, 'dashboard.html.artifact.json'), 'not json {{');
    const siblings = await findPriorArtifactSiblings(scanDir, 'dashboard', config);
    expect(siblings.map((s) => s.name)).toEqual(['dashboard.html']);
  });

  it('ignores a sidecar whose identifier field is not a non-empty string', async () => {
    await writeFile(path.join(scanDir, 'dashboard.html'), 'x'.repeat(3000));
    await writeFile(
      path.join(scanDir, 'dashboard.html.artifact.json'),
      JSON.stringify({ metadata: { identifier: 42 } }),
    );
    const siblings = await findPriorArtifactSiblings(scanDir, 'dashboard', config);
    expect(siblings.map((s) => s.name)).toEqual(['dashboard.html']);
  });

  it('tries both legacy-candidate interpretations for an ambiguous name like phase-2.html', async () => {
    await writeFile(path.join(scanDir, 'phase-2.html'), 'x'.repeat(3000));
    // Interpretation A: identifier "phase" + collision suffix "-2".
    expect((await findPriorArtifactSiblings(scanDir, 'phase', config)).map((s) => s.name)).toEqual(['phase-2.html']);
    // Interpretation B: the standalone identifier "phase-2".
    expect((await findPriorArtifactSiblings(scanDir, 'phase-2', config)).map((s) => s.name)).toEqual(['phase-2.html']);
  });

  it('does not match an unrelated identifier sharing only a filename substring', async () => {
    await writeFile(path.join(scanDir, 'dashboard.html'), 'x'.repeat(3000));
    expect(await findPriorArtifactSiblings(scanDir, 'board', config)).toEqual([]);
  });

  it('evaluateArtifactStubGuard end-to-end: pass, warn, and off short-circuits', async () => {
    await writeFile(path.join(scanDir, 'dashboard.html'), 'x'.repeat(10000));
    const warn = await evaluateArtifactStubGuard({
      scanDir,
      identifier: 'dashboard',
      newSize: 10,
      config,
    });
    expect(warn.outcome).toBe('warn');

    const pass = await evaluateArtifactStubGuard({
      scanDir,
      identifier: 'dashboard',
      newSize: 9000,
      config,
    });
    expect(pass.outcome).toBe('pass');

    const off = await evaluateArtifactStubGuard({
      scanDir,
      identifier: 'dashboard',
      newSize: 1,
      config: { ...config, mode: 'off' },
    });
    expect(off.outcome).toBe('pass');
  });

  it('evaluateArtifactStubGuard short-circuits on an empty identifier without touching the filesystem', async () => {
    const result = await evaluateArtifactStubGuard({
      scanDir: path.join(scanDir, 'does-not-exist'),
      identifier: '',
      newSize: 1,
      config,
    });
    expect(result.outcome).toBe('pass');
  });

  it('ignores a dangling symlink matching the name pattern rather than throwing', async () => {
    await writeFile(path.join(scanDir, 'dashboard.html'), 'x'.repeat(3000));
    const { symlink } = await import('node:fs/promises');
    // A symlink's own dirent reports isFile() === false (Node reflects the
    // link's own type, not its target's), so this is filtered out by the
    // `!entry.isFile()` check before ever reaching `stat()` — verifies the
    // scan doesn't crash on (or wrongly include) a broken symlink.
    await symlink(path.join(scanDir, 'nonexistent-target'), path.join(scanDir, 'dashboard-2.html'));
    const siblings = await findPriorArtifactSiblings(scanDir, 'dashboard', config);
    expect(siblings.map((s) => s.name)).toEqual(['dashboard.html']);
  });

  it('skips a matching entry whose stat() call fails, without throwing (e.g. a real readdir/stat race)', async () => {
    await writeFile(path.join(scanDir, 'dashboard.html'), 'x'.repeat(3000));
    await writeFile(path.join(scanDir, 'dashboard-2.html'), 'x'.repeat(3000));
    fsMockState.statImpl = async (...args: unknown[]) => {
      const target = String(args[0]);
      if (target.endsWith('dashboard-2.html')) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      const { stat: realStat } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return realStat(target);
    };
    const siblings = await findPriorArtifactSiblings(scanDir, 'dashboard', config);
    expect(siblings.map((s) => s.name)).toEqual(['dashboard.html']);
  });
});
