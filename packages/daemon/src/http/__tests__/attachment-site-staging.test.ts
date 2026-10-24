import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { stageAttachmentClaim } from '../attachments.js';

describe('site-contained attachment staging (owner 2026-10-23)', () => {
  it('copies only the claimed canary, preserves store bytes, and removes the staged batch on cleanup', async () => {
    const base = await mkdtemp(join(tmpdir(), 'attachment-site-'));
    try {
      const site = join(base, 'site'); const batch = join(base, 'external-batch');
      await mkdir(site); await mkdir(batch);
      const source = join(batch, 'image.png');
      await writeFile(source, 'CLAIMED_CANARY');
      await writeFile(join(batch, 'another-owner.txt'), 'UNCLAIMED_CANARY');
      const staged = await stageAttachmentClaim({ filesystemRoot: site,
        claim: { batchDirectory: batch, attachments: [{ path: source, name: 'image.png', kind: 'image' }] },
      }, {});
      expect(staged.claim.batchDirectory?.startsWith(await realpath(site) + sep)).toBe(true);
      expect(await readdir(staged.claim.batchDirectory!)).toEqual(['image.png']);
      expect(await readFile(staged.claim.attachments[0]!.path, 'utf8')).toBe('CLAIMED_CANARY');
      expect(await readFile(source, 'utf8')).toBe('CLAIMED_CANARY');
      await staged.cleanup();
      await expect(stat(staged.claim.batchDirectory!)).rejects.toThrow();
    } finally { await rm(base, { recursive: true, force: true }); }
  });

  it('removes a partial batch when a later source is unavailable', async () => {
    const base = await mkdtemp(join(tmpdir(), 'attachment-site-failure-'));
    try {
      const source = join(base, 'good.txt');
      await writeFile(source, 'CLAIMED_CANARY');
      await expect(stageAttachmentClaim({ filesystemRoot: base, claim: { attachments: [
        { path: source, name: 'good.txt', kind: 'file' },
        { path: join(base, 'missing.txt'), name: 'missing.txt', kind: 'file' },
      ] } }, {})).rejects.toThrow();
      expect(await readdir(base)).toEqual(['good.txt']);
    } finally { await rm(base, { recursive: true, force: true }); }
  });
});
