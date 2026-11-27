import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { BackstopRefusal } from '../backstop-refusal.js';
import { createRawFileSitePort } from '../publish-backstop-file.js';

function fixture(siteDir: string) {
  return createRawFileSitePort({ siteDir, checkRawFilePath: () => null, maxBytes: 128,
    normalizeMode: ({ mode }) => mode & 0o111 ? 0o755 : 0o644 });
}

const bytes = (text: string) => Buffer.from(text, 'utf8');

it('captures a missing file, creates its parents and restores the original absence idempotently', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'cms-backstop-create-'));
  try {
    const port = fixture(root);
    const relPath = 'new-dir/theme.css';
    const before = await port.capture({ relPath });
    expect(before).toEqual({ relPath, backupName: null, sha256: null, size: null, mode: 0o644 });
    await port.replace({ relPath, bytes: bytes('body {}'), mode: 0o644 });
    expect(fs.readFileSync(join(root, relPath), 'utf8')).toBe('body {}');
    expect(fs.readdirSync(join(root, '.publish-staging'))).toEqual([]);
    await port.restore({ inverse: before });
    await port.restore({ inverse: before });
    expect(await port.read({ relPath })).toBeNull();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('restores checked bytes and mode from a private backup and safely handles a repeated restore', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'cms-backstop-restore-'));
  try {
    const port = fixture(root);
    const relPath = 'launch.sh';
    await port.replace({ relPath, bytes: bytes('original'), mode: 0o755 });
    const inverse = await port.capture({ relPath });
    expect(inverse).toMatchObject({ relPath, size: 8, mode: 0o755, sha256: createHash('sha256').update('original').digest('hex') });
    if (inverse.backupName === null) throw new Error('expected a backup for the existing file');
    expect(fs.statSync(join(root, '.publish-previous')).mode & 0o777).toBe(0o700);
    expect(fs.readFileSync(join(root, '.publish-previous', inverse.backupName), 'utf8')).toBe('original');
    await port.replace({ relPath, bytes: bytes('updated'), mode: 0o644 });
    await port.restore({ inverse });
    expect(fs.readFileSync(join(root, relPath), 'utf8')).toBe('original');
    expect(fs.statSync(join(root, relPath)).mode & 0o777).toBe(0o755);
    expect(fs.readdirSync(join(root, '.publish-previous'))).toEqual([]);
    await port.restore({ inverse });
    expect(fs.readFileSync(join(root, relPath), 'utf8')).toBe('original');
    await port.replace({ relPath, bytes: bytes('other'), mode: 0o644 });
    await expect(port.restore({ inverse })).rejects.toThrow(new BackstopRefusal({ message: 'The saved undo file is missing.' }));
    expect(fs.readFileSync(join(root, relPath), 'utf8')).toBe('other');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('leaves live bytes intact if the saved undo file has been changed', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'cms-backstop-checksum-'));
  try {
    const port = fixture(root);
    const relPath = 'notes.txt';
    await port.replace({ relPath, bytes: bytes('before'), mode: 0o644 });
    const inverse = await port.capture({ relPath });
    if (inverse.backupName === null) throw new Error('expected an undo file');
    fs.writeFileSync(join(root, '.publish-previous', inverse.backupName), 'edited');
    await port.replace({ relPath, bytes: bytes('live'), mode: 0o644 });
    await expect(port.restore({ inverse })).rejects.toThrow(new BackstopRefusal({ message: 'The saved undo file failed its checksum check.' }));
    expect(fs.readFileSync(join(root, relPath), 'utf8')).toBe('live');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('refuses non-file targets and symlink components before reading or replacing them', async () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'cms-backstop-path-'));
  try {
    const port = fixture(root);
    fs.mkdirSync(join(root, 'assets'));
    fs.writeFileSync(join(root, 'assets', 'theme.css'), 'original');
    fs.symlinkSync(join(root, 'assets'), join(root, 'linked'));
    expect(await port.check({ relPath: 'assets' })).toBe('Choose a regular file inside the site folder.');
    const linkMessage = 'Links are never sent; choose a regular file inside the site folder.';
    expect(await port.check({ relPath: 'linked/theme.css' })).toBe(linkMessage);
    await expect(port.replace({ relPath: 'linked/theme.css', bytes: bytes('change'), mode: 0o644 }))
      .rejects.toThrow(new BackstopRefusal({ message: linkMessage }));
    expect(fs.readFileSync(join(root, 'assets', 'theme.css'), 'utf8')).toBe('original');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
