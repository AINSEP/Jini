import { constants } from 'node:fs';
import { copyFile, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { stageAttachmentClaim } from '../attachment-staging.js';

describe('site-contained attachment staging (owner 2026-10-23)', () => {
  it('requests copy-on-write, keeps independent file identity, and removes the staged batch on cleanup', async () => {
    const base = await mkdtemp(join(tmpdir(), 'attachment-site-'));
    try {
      const site = join(base, 'site'); const batch = join(base, 'external-batch');
      await mkdir(site); await mkdir(batch);
      const source = join(batch, 'image.png');
      await writeFile(source, 'CLAIMED_CANARY');
      await writeFile(join(batch, 'another-owner.txt'), 'UNCLAIMED_CANARY');
      const copy = vi.fn(copyFile);
      const staged = await stageAttachmentClaim({ filesystemRoot: site, deps: { copyFile: copy },
        claim: { batchDirectory: batch, attachments: [{ path: source, name: 'image.png', kind: 'image' }] },
      }, {});
      expect(staged.claim.batchDirectory?.startsWith(await realpath(site) + sep)).toBe(true);
      expect(await readdir(staged.claim.batchDirectory!)).toEqual(['image.png']);
      expect(await readFile(staged.claim.attachments[0]!.path, 'utf8')).toBe('CLAIMED_CANARY');
      expect(await readFile(source, 'utf8')).toBe('CLAIMED_CANARY');
      expect(copy).toHaveBeenCalledExactlyOnceWith(source, staged.claim.attachments[0]!.path, constants.COPYFILE_FICLONE);
      expect((await stat(source)).ino).not.toBe((await stat(staged.claim.attachments[0]!.path)).ino);
      await writeFile(staged.claim.attachments[0]!.path, 'STAGED_CHANGE');
      expect(await readFile(source, 'utf8')).toBe('CLAIMED_CANARY');
      await staged.cleanup();
      const batchDirectory = staged.claim.batchDirectory;
      if (batchDirectory === undefined) throw new Error('Expected a staged batch directory');
      await expect(stat(batchDirectory)).rejects.toThrow(`ENOENT: no such file or directory, stat '${batchDirectory}'`);
    } finally { await rm(base, { recursive: true, force: true }); }
  });

  it('removes a partial batch when a later source is unavailable', async () => {
    const base = await mkdtemp(join(tmpdir(), 'attachment-site-failure-'));
    try {
      const source = join(base, 'good.txt');
      await writeFile(source, 'CLAIMED_CANARY');
      const missing = join(base, 'missing.txt');
      const error = await stageAttachmentClaim({ filesystemRoot: base, deps: { copyFile }, claim: { attachments: [
        { path: source, name: 'good.txt', kind: 'file' },
        { path: missing, name: 'missing.txt', kind: 'file' },
      ] } }, {}).then(
        () => { throw new Error('Expected attachment staging to fail'); },
        (failure: NodeJS.ErrnoException & { dest?: string }) => failure,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ code: 'ENOENT', path: missing, syscall: 'copyfile' });
      expect(error.message).toBe(`ENOENT: no such file or directory, copyfile '${missing}' -> '${error.dest}'`);
      expect(await readdir(base)).toEqual(['good.txt']);
    } finally { await rm(base, { recursive: true, force: true }); }
  });
});
