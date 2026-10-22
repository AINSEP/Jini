import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFsAttachmentStaging } from '../staging.js';

let cwd: string;
let outside: string;

beforeEach(async () => {
  cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jini-media-staging-cwd-'));
  outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jini-media-staging-outside-'));
});

afterEach(async () => {
  await fs.promises.rm(cwd, { recursive: true, force: true });
  await fs.promises.rm(outside, { recursive: true, force: true });
});

describe('createFsAttachmentStaging', () => {
    it('returns [] for an empty or non-array input', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd });
        expect(await staging.stage({ imagePaths: [] })).toEqual([]);
        expect(await staging.stage({ imagePaths: undefined as unknown as string[] })).toEqual([]);
    });
    it('uses a path already inside cwd as-is (no copy, no uploadRoot needed)', async () => {
        const inside = path.join(cwd, 'already-here.png');
        await fs.promises.writeFile(inside, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        const staged = await staging.stage({ imagePaths: [inside] });
        expect(staged).toEqual([await fs.promises.realpath(inside)]);
    });
    it('copies a path outside cwd into the staging directory when it resolves inside uploadRoot', async () => {
        const externalFile = path.join(outside, 'photo.png');
        await fs.promises.writeFile(externalFile, 'external-bytes');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        const [staged] = await staging.stage({ imagePaths: [externalFile] }, { uploadRoot: outside });
        expect(staged).toBeDefined();
        expect(staged!.startsWith(path.join(cwd, '.media-attachments'))).toBe(true);
        expect(await fs.promises.readFile(staged!, 'utf8')).toBe('external-bytes');
        // original untouched
        expect(await fs.promises.readFile(externalFile, 'utf8')).toBe('external-bytes');
    });
    it('respects a custom stagingDirName option', async () => {
        const externalFile = path.join(outside, 'photo.png');
        await fs.promises.writeFile(externalFile, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd }, { stagingDirName: '.custom-staging' });
        const [staged] = await staging.stage({ imagePaths: [externalFile] }, { uploadRoot: outside });
        expect(staged!.startsWith(path.join(cwd, '.custom-staging'))).toBe(true);
    });
    it('rejects an absolute, traversal, or separator-containing stagingDirName', () => {
        expect(() => createFsAttachmentStaging({ cwd: cwd }, { stagingDirName: '/abs' })).toThrow(/safe path component/);
        expect(() => createFsAttachmentStaging({ cwd: cwd }, { stagingDirName: '../escape' })).toThrow(/safe path component/);
        expect(() => createFsAttachmentStaging({ cwd: cwd }, { stagingDirName: 'a/b' })).toThrow(/safe path component/);
        expect(() => createFsAttachmentStaging({ cwd: cwd }, { stagingDirName: '..' })).toThrow(/safe path component/);
    });
    it('rejects a path outside uploadRoot when uploadRoot is supplied', async () => {
        const uploadRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jini-media-staging-upload-'));
        try {
            const outsideUploadRoot = path.join(outside, 'not-allowed.png');
            await fs.promises.writeFile(outsideUploadRoot, 'x');
            const staging = createFsAttachmentStaging({ cwd: cwd });
            expect(await staging.stage({ imagePaths: [outsideUploadRoot] }, { uploadRoot: uploadRoot })).toEqual([]);
        }
        finally {
            await fs.promises.rm(uploadRoot, { recursive: true, force: true });
        }
    });
    it('accepts a path inside uploadRoot when uploadRoot is supplied', async () => {
        const uploadRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jini-media-staging-upload-'));
        try {
            const allowed = path.join(uploadRoot, 'allowed.png');
            await fs.promises.writeFile(allowed, 'x');
            const staging = createFsAttachmentStaging({ cwd: cwd });
            const staged = await staging.stage({ imagePaths: [allowed] }, { uploadRoot: uploadRoot });
            expect(staged).toHaveLength(1);
        }
        finally {
            await fs.promises.rm(uploadRoot, { recursive: true, force: true });
        }
    });
    it('SEC-RB-003: throws without copying an outside-cwd file when no uploadRoot is supplied at all — deny by default, not unrestricted', async () => {
        const externalFile = path.join(outside, 'photo.png');
        await fs.promises.writeFile(externalFile, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        await expect(staging.stage({ imagePaths: [externalFile] })).rejects.toThrow('attachment staging: files outside cwd require an uploadRoot');
        expect(await fs.promises.readdir(path.join(cwd, '.media-attachments'))).toEqual([]);
        expect(await fs.promises.readFile(externalFile, 'utf8')).toBe('x');
    });
    it.each([null, undefined])('rejects an external file when uploadRoot is explicitly %s', async (uploadRoot) => {
        const externalFile = path.join(outside, 'photo.png');
        await fs.promises.writeFile(externalFile, 'external-bytes');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        await expect(staging.stage({ imagePaths: [externalFile] }, { uploadRoot })).rejects.toThrow('attachment staging: files outside cwd require an uploadRoot');
        expect(await fs.promises.readdir(path.join(cwd, '.media-attachments'))).toEqual([]);
    });
    it('rejects a symlink inside cwd pointing outside it, even after advisory and in-root inputs', async () => {
        const insideFile = path.join(cwd, 'inside.png');
        const externalFile = path.join(outside, 'photo.png');
        const linkedFile = path.join(cwd, 'linked.png');
        await fs.promises.writeFile(insideFile, 'inside-bytes');
        await fs.promises.writeFile(externalFile, 'external-bytes');
        await fs.promises.symlink(externalFile, linkedFile);
        const staging = createFsAttachmentStaging({ cwd: cwd });
        await expect(staging.stage({ imagePaths: ['', path.join(cwd, 'missing.png'), insideFile, linkedFile] })).rejects.toThrow('attachment staging: files outside cwd require an uploadRoot');
        expect(await fs.promises.readdir(path.join(cwd, '.media-attachments'))).toEqual([]);
        expect(await fs.promises.readFile(externalFile, 'utf8')).toBe('external-bytes');
        expect(await staging.stage({ imagePaths: [insideFile] })).toEqual([await fs.promises.realpath(insideFile)]);
    });
    it('SEC-RB-003: rejects the whole call when an explicitly-supplied uploadRoot cannot be resolved, rather than silently disabling the restriction', async () => {
        const externalFile = path.join(outside, 'photo.png');
        await fs.promises.writeFile(externalFile, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        await expect(staging.stage({ imagePaths: [externalFile] }, { uploadRoot: path.join(outside, 'does-not-exist') })).rejects.toThrow(/could not be resolved/);
    });
    it('SEC-RB-003: refuses to use a staging directory that is itself a preexisting symlink', async () => {
        const stagingDirName = '.media-attachments';
        const elsewhere = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jini-media-staging-elsewhere-'));
        try {
            await fs.promises.symlink(elsewhere, path.join(cwd, stagingDirName), 'dir');
            const staging = createFsAttachmentStaging({ cwd: cwd });
            const externalFile = path.join(outside, 'photo.png');
            await fs.promises.writeFile(externalFile, 'x');
            await expect(staging.stage({ imagePaths: [externalFile] }, { uploadRoot: outside })).rejects.toThrow(/symlink/);
        }
        finally {
            await fs.promises.rm(elsewhere, { recursive: true, force: true });
        }
    });
    it('SEC-RB-003: rejects a stage() call with more paths than maxItems', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd }, { maxItems: 2 });
        const inside = path.join(cwd, 'a.png');
        await fs.promises.writeFile(inside, 'x');
        await expect(staging.stage({ imagePaths: [inside, inside, inside] })).rejects.toThrow(/exceeds the 2-item limit/);
    });
    it('SEC-RB-003: skips a file larger than maxBytesPerFile instead of copying it', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd }, { maxBytesPerFile: 4 });
        const externalFile = path.join(outside, 'big.png');
        await fs.promises.writeFile(externalFile, 'this is more than four bytes');
        expect(await staging.stage({ imagePaths: [externalFile] }, { uploadRoot: outside })).toEqual([]);
    });
    it('skips a blank-string path', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd });
        expect(await staging.stage({ imagePaths: ['   '] })).toEqual([]);
    });
    it('skips a non-string entry', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd });
        expect(await staging.stage({ imagePaths: [123 as unknown as string] })).toEqual([]);
    });
    it('skips a path that does not exist', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd });
        expect(await staging.stage({ imagePaths: [path.join(outside, 'missing.png')] }, { uploadRoot: outside })).toEqual([]);
    });
    it('skips a directory path (not a file)', async () => {
        const dir = path.join(outside, 'a-directory');
        await fs.promises.mkdir(dir);
        const staging = createFsAttachmentStaging({ cwd: cwd });
        expect(await staging.stage({ imagePaths: [dir] }, { uploadRoot: outside })).toEqual([]);
    });
    it('prunes staged files older than maxAgeMs on a later call', async () => {
        const externalFile = path.join(outside, 'photo.png');
        await fs.promises.writeFile(externalFile, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd }, { maxAgeMs: 1 });
        const [staged] = await staging.stage({ imagePaths: [externalFile] }, { uploadRoot: outside });
        expect(fs.existsSync(staged!)).toBe(true);
        // Backdate the staged file's mtime so the next call's prune sees it as stale.
        const past = new Date(Date.now() - 10000);
        await fs.promises.utimes(staged!, past, past);
        const externalFile2 = path.join(outside, 'photo2.png');
        await fs.promises.writeFile(externalFile2, 'y');
        await staging.stage({ imagePaths: [externalFile2] }, { uploadRoot: outside });
        expect(fs.existsSync(staged!)).toBe(false);
    });
    it('prune treats a readdir failure as nothing-to-prune (best-effort)', async () => {
        const externalFile = path.join(outside, 'photo.png');
        await fs.promises.writeFile(externalFile, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        const readdirSpy = vi.spyOn(fs.promises, 'readdir').mockRejectedValueOnce(new Error('boom'));
        const staged = await staging.stage({ imagePaths: [externalFile] }, { uploadRoot: outside });
        // mkdir still ran, then prune's readdir failed and was swallowed, then staging itself still succeeds.
        expect(staged).toHaveLength(1);
        readdirSpy.mockRestore();
    });
    it('prune treats a per-entry stat failure as best-effort and continues', async () => {
        const staleFile = path.join(outside, 'stale.png');
        await fs.promises.writeFile(staleFile, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd }, { maxAgeMs: 1 });
        const [staged] = await staging.stage({ imagePaths: [staleFile] }, { uploadRoot: outside });
        expect(staged).toBeDefined();
        const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementationOnce(async () => {
            throw new Error('boom');
        });
        const externalFile2 = path.join(outside, 'photo2.png');
        await fs.promises.writeFile(externalFile2, 'y');
        // The prune pass hits the mocked stat failure for the pre-existing staged file (best-effort,
        // swallowed) before staging photo2.png for real.
        const staged2 = await staging.stage({ imagePaths: [externalFile2] }, { uploadRoot: outside });
        expect(staged2).toHaveLength(1);
        statSpy.mockRestore();
    });
    it('prune skips a non-file entry (e.g. a stray subdirectory) in the staging dir', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd });
        const externalFile = path.join(outside, 'photo.png');
        await fs.promises.writeFile(externalFile, 'x');
        await staging.stage({ imagePaths: [externalFile] }, { uploadRoot: outside });
        await fs.promises.mkdir(path.join(cwd, '.media-attachments', 'a-stray-dir'));
        const externalFile2 = path.join(outside, 'photo2.png');
        await fs.promises.writeFile(externalFile2, 'y');
        const staged2 = await staging.stage({ imagePaths: [externalFile2] }, { uploadRoot: outside });
        expect(staged2).toHaveLength(1);
        expect(fs.existsSync(path.join(cwd, '.media-attachments', 'a-stray-dir'))).toBe(true);
    });
    it('is a no-op prune when the staging directory does not exist yet', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd });
        // No prior stage() call, so the staging dir has never been created; stage([]) short-circuits
        // before mkdir/prune, so drive a real file through it to exercise the readdir-catch path once,
        // then delete the dir and stage again to hit "readdir fails -> return" on a fresh instance.
        const staging2 = createFsAttachmentStaging({ cwd: path.join(cwd, 'does-not-exist-yet') });
        const externalFile = path.join(outside, 'photo.png');
        await fs.promises.writeFile(externalFile, 'x');
        const staged = await staging2.stage({ imagePaths: [externalFile] }, { uploadRoot: outside });
        expect(staged).toHaveLength(1);
    });
    it('accepts exactly maxItems paths (the limit is inclusive)', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd }, { maxItems: 2 });
        const inside = path.join(cwd, 'a.png');
        await fs.promises.writeFile(inside, 'x');
        const real = await fs.promises.realpath(inside);
        expect(await staging.stage({ imagePaths: [inside, inside] })).toEqual([real, real]);
    });
    it('rejects too many paths with a message naming the count and the limit', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd }, { maxItems: 1 });
        await expect(staging.stage({ imagePaths: ['a', 'b'] })).rejects.toThrow('attachment staging: 2 paths exceeds the 1-item limit');
    });
    it('copies a file of exactly maxBytesPerFile bytes (the size limit is inclusive)', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd }, { maxBytesPerFile: 4 });
        const externalFile = path.join(outside, 'four.png');
        await fs.promises.writeFile(externalFile, 'abcd');
        const [staged] = await staging.stage({ imagePaths: [externalFile] }, { uploadRoot: outside });
        expect(await fs.promises.readFile(staged!, 'utf8')).toBe('abcd');
    });
    it('names the unresolvable uploadRoot and keeps the fs reason in the message', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd });
        const missingRoot = path.join(outside, 'does-not-exist');
        await expect(staging.stage({ imagePaths: ['x'] }, { uploadRoot: missingRoot })).rejects.toThrow(`attachment staging: uploadRoot ${JSON.stringify(missingRoot)} could not be resolved: ENOENT`);
    });
    it('rejects an unresolvable uploadRoot before creating the staging directory', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd });
        await expect(staging.stage({ imagePaths: ['x'] }, { uploadRoot: path.join(outside, 'nope') })).rejects.toThrow('could not be resolved');
        expect(fs.existsSync(path.join(cwd, '.media-attachments'))).toBe(false);
    });
    it('rejects the item limit before creating the staging directory', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd }, { maxItems: 1 });
        await expect(staging.stage({ imagePaths: ['a', 'b'] })).rejects.toThrow('exceeds the 1-item limit');
        expect(fs.existsSync(path.join(cwd, '.media-attachments'))).toBe(false);
    });
    it('creates the staging directory even when every path is skipped', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd });
        expect(await staging.stage({ imagePaths: ['   '] })).toEqual([]);
        expect(fs.existsSync(path.join(cwd, '.media-attachments'))).toBe(true);
    });
    it('names the symlinked staging directory in the refusal', async () => {
        const elsewhere = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jini-media-staging-elsewhere-'));
        try {
            await fs.promises.symlink(elsewhere, path.join(cwd, '.media-attachments'), 'dir');
            const staging = createFsAttachmentStaging({ cwd: cwd });
            await expect(staging.stage({ imagePaths: ['x'] })).rejects.toThrow(`attachment staging: staging directory ${path.join(path.resolve(cwd), '.media-attachments')} is a symlink, refusing to use it`);
        }
        finally {
            await fs.promises.rm(elsewhere, { recursive: true, force: true });
        }
    });
    it('uses an in-cwd file as-is even when it lies outside the supplied uploadRoot', async () => {
        const inside = path.join(cwd, 'here.png');
        await fs.promises.writeFile(inside, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        expect(await staging.stage({ imagePaths: [inside] }, { uploadRoot: outside })).toEqual([await fs.promises.realpath(inside)]);
    });
    it('resolves a relative path against process.cwd(), not the staging cwd', async () => {
        const inside = path.join(cwd, 'rel.png');
        await fs.promises.writeFile(inside, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        const relative = path.relative(process.cwd(), inside);
        expect(await staging.stage({ imagePaths: [relative] })).toEqual([await fs.promises.realpath(inside)]);
    });
    it('copies a file when uploadRoot is the file itself (the root-equals-candidate case)', async () => {
        const externalFile = path.join(outside, 'exact.png');
        await fs.promises.writeFile(externalFile, 'exact');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        const [staged] = await staging.stage({ imagePaths: [externalFile] }, { uploadRoot: externalFile });
        expect(await fs.promises.readFile(staged!, 'utf8')).toBe('exact');
    });
    it('names the copy <uuid>-<basename> inside the staging directory', async () => {
        const externalFile = path.join(outside, 'named.png');
        await fs.promises.writeFile(externalFile, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        const [staged] = await staging.stage({ imagePaths: [externalFile] }, { uploadRoot: outside });
        expect(path.dirname(staged!)).toBe(path.join(path.resolve(cwd), '.media-attachments'));
        expect(path.basename(staged!)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-named\.png$/);
    });
    it('keeps staging later paths after skipping an earlier missing one', async () => {
        const externalFile = path.join(outside, 'ok.png');
        await fs.promises.writeFile(externalFile, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        const staged = await staging.stage({ imagePaths: [path.join(outside, 'missing.png'), externalFile] }, { uploadRoot: outside });
        expect(staged).toHaveLength(1);
    });
    it('treats an in-cwd file whose name starts with ".." as outside cwd (reported, not fixed)', async () => {
        // isWithinRoot tests relativePath.startsWith('..'), which also matches a
        // child literally named "..foo". It fails closed (asks for uploadRoot), so
        // it is a usability bug, not a containment bypass.
        const oddName = path.join(cwd, '..foo.png');
        await fs.promises.writeFile(oddName, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        await expect(staging.stage({ imagePaths: [oddName] })).rejects.toThrow('attachment staging: files outside cwd require an uploadRoot');
    });
    it('skips a file copy that fails and keeps going (advisory input)', async () => {
        const externalFile = path.join(outside, 'copyfail.png');
        await fs.promises.writeFile(externalFile, 'x');
        const staging = createFsAttachmentStaging({ cwd: cwd });
        const copySpy = vi.spyOn(fs.promises, 'copyFile').mockRejectedValueOnce(new Error('disk full'));
        try {
            expect(await staging.stage({ imagePaths: [externalFile, externalFile] }, { uploadRoot: outside })).toHaveLength(1);
        }
        finally {
            copySpy.mockRestore();
        }
    });
    it('falls back to the raw cwd when the cwd realpath lookup fails', async () => {
        const inside = path.join(cwd, 'a.png');
        await fs.promises.writeFile(inside, 'x');
        const realCwd = await fs.promises.realpath(cwd);
        const staging = createFsAttachmentStaging({ cwd: realCwd });
        const original = fs.promises.realpath;
        const realpathSpy = vi.spyOn(fs.promises, 'realpath').mockImplementation(async (p, o) => {
            if (p === realCwd) throw new Error('boom');
            return original(p, o);
        });
        try {
            expect(await staging.stage({ imagePaths: [inside] })).toEqual([path.join(realCwd, 'a.png')]);
        }
        finally {
            realpathSpy.mockRestore();
        }
    });
    it('prunes only files older than maxAgeMs and keeps fresh ones', async () => {
        const staging = createFsAttachmentStaging({ cwd: cwd }, { maxAgeMs: 60000 });
        const a = path.join(outside, 'a.png');
        await fs.promises.writeFile(a, 'a');
        const [first] = await staging.stage({ imagePaths: [a] }, { uploadRoot: outside });
        await staging.stage({ imagePaths: [a] }, { uploadRoot: outside });
        expect(fs.existsSync(first!)).toBe(true);
    });
});
