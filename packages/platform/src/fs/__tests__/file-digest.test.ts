import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileDigest } from '../index.js';

it('file digests notice changes beyond the read buffer and release the file on read failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-digest-'));
  const target = path.join(root, 'asset.bin');
  const bytes = Buffer.alloc(150_000, 255);
  try {
    fs.writeFileSync(target, bytes);
    expect(fileDigest({ path: target }).toString('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
    bytes[149_999] = 0; fs.writeFileSync(target, bytes);
    expect(fileDigest({ path: target }).toString('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
    let closed = false;
    expect(() => fileDigest({ path: target }, { filesystem: { ...fs,
      readSync: () => { throw new Error('read failed'); },
      closeSync: descriptor => { closed = true; fs.closeSync(descriptor); },
    } })).toThrow('read failed');
    expect(closed).toBe(true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
