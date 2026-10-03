import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The temporary FileHandle's `stat` is intercepted so the fail-closed "the OS didn't honor mode 0600"
// path can be exercised deterministically without needing a real filesystem
// that misbehaves. Every other fs/promises call delegates to the real
// implementation.
const hoisted = vi.hoisted(() => ({ statMode: 'ok' as 'ok' | 'group-readable' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      return new Proxy(handle, {
        get(target, key) {
          if (key === 'stat') return async () => {
            const info = await target.stat();
            if (hoisted.statMode === 'group-readable') info.mode = (info.mode & ~0o777) | 0o644;
            return info;
          };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

import { writeFileAtomicAsync } from '@jini-ai/platform/fs';

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-mcp-secure-write-'));
  tmpDirs.push(d);
  return d;
}
beforeEach(() => {
  hoisted.statMode = 'ok';
});
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('writeFileAtomicAsync', () => {
  // PARITY
  it('writes the content and survives the atomic rename, leaving no temp file behind', async () => {
    const dir = tmp();
    const file = path.join(dir, 'secret.json');
    await writeFileAtomicAsync({ filePath: file, content: '{"a":1}' }, { mode: 0o600, verifyOwnerOnly: true, createParent: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a":1}');
    expect(fs.readdirSync(dir)).toEqual(['secret.json']);
  });

  // PARITY
  it('creates the file with owner-only (0600) permissions from the first byte (POSIX)', async () => {
    const dir = tmp();
    const file = path.join(dir, 'secret.json');
    await writeFileAtomicAsync({ filePath: file, content: 'x' }, { mode: 0o600, verifyOwnerOnly: true, createParent: true });
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  // PARITY
  it('creates missing parent directories', async () => {
    const dir = tmp();
    const file = path.join(dir, 'nested', 'deep', 'secret.json');
    await writeFileAtomicAsync({ filePath: file, content: 'x' }, { mode: 0o600, verifyOwnerOnly: true, createParent: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('x');
  });

  // PARITY
  it('overwrites a prior write via a fresh temp name each time, leaving only the final file', async () => {
    const dir = tmp();
    const file = path.join(dir, 'secret.json');
    await writeFileAtomicAsync({ filePath: file, content: 'first' }, { mode: 0o600, verifyOwnerOnly: true, createParent: true });
    await writeFileAtomicAsync({ filePath: file, content: 'second' }, { mode: 0o600, verifyOwnerOnly: true, createParent: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('second');
    expect(fs.readdirSync(dir)).toEqual(['secret.json']);
  });

  // PARITY
  it('fails closed and removes the temp file when the on-disk mode is not owner-only (POSIX)', async () => {
    hoisted.statMode = 'group-readable';
    const dir = tmp();
    const file = path.join(dir, 'secret.json');
    await expect(writeFileAtomicAsync({ filePath: file, content: 'x' }, { mode: 0o600, verifyOwnerOnly: true, createParent: true })).rejects.toThrow(/owner-only/);
    expect(fs.existsSync(file)).toBe(false); // never renamed into place
    expect(fs.readdirSync(dir)).toEqual([]); // temp file cleaned up
  });

  // PARITY
  it('does not clobber a prior valid file when a later write fails closed', async () => {
    const dir = tmp();
    const file = path.join(dir, 'secret.json');
    await writeFileAtomicAsync({ filePath: file, content: 'good' }, { mode: 0o600, verifyOwnerOnly: true, createParent: true });
    hoisted.statMode = 'group-readable';
    await expect(writeFileAtomicAsync({ filePath: file, content: 'bad' }, { mode: 0o600, verifyOwnerOnly: true, createParent: true })).rejects.toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('good');
  });

  // PARITY
  it('skips the POSIX mode check when platform is overridden to win32', async () => {
    hoisted.statMode = 'group-readable'; // would fail closed on POSIX
    const dir = tmp();
    const file = path.join(dir, 'secret.json');
    await writeFileAtomicAsync({ filePath: file, content: 'x' }, { platform: 'win32', mode: 0o600, verifyOwnerOnly: true, createParent: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('x');
  });
});
