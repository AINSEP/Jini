/**
 * Pins the DEFAULT secret-file port of `core/config.ts` and `core/tokens.ts` (Stryker L3,
 * 2026-10-25: `writeSecretText`'s `verifyOwnerOnly: true` / `createParent: true` could be flipped to
 * `false`, and tokens.ts's `__proto__` / `constructor` id guard removed, with no test failing).
 * The secure-write primitive itself is covered by secure-write.test.ts; these tests prove the two
 * callers actually ask it for those guarantees.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Same interception as secure-write.test.ts: report a group-readable mode from the temp file's
// stat so the owner-only verification has something to refuse.
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

import { writeMcpConfig } from '../config.js';
import { readTokensFile, sanitizeTokensFile, setToken } from '../tokens.js';

const dirs: string[] = [];
function nestedMissingDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-mcp-secret-'));
  dirs.push(root);
  return path.join(root, 'not', 'yet', 'created');
}

afterEach(() => {
  hoisted.statMode = 'ok';
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const token = { accessToken: 'tok', tokenType: 'Bearer', savedAt: 1 };

describe.skipIf(process.platform === 'win32')('default secret-file port', () => {
  it('writeMcpConfig creates missing parents and writes the file 0600', async () => {
    const dataDir = nestedMissingDir();
    await writeMcpConfig({ dataDir, body: { servers: [] } });
    expect(fs.statSync(path.join(dataDir, 'mcp-config.json')).mode & 0o777).toBe(0o600);
  });

  it('setToken creates missing parents and writes the file 0600', async () => {
    const dataDir = nestedMissingDir();
    await setToken({ dataDir, serverId: 's1', token });
    expect(fs.statSync(path.join(dataDir, 'mcp-tokens.json')).mode & 0o777).toBe(0o600);
    expect((await readTokensFile({ dataDir })).servers.s1).toMatchObject({ accessToken: 'tok' });
  });

  it('writeMcpConfig fails closed when the written file is not owner-only', async () => {
    const dataDir = nestedMissingDir();
    hoisted.statMode = 'group-readable';
    await expect(writeMcpConfig({ dataDir, body: { servers: [] } })).rejects.toThrow(/owner-only/);
    expect(fs.existsSync(path.join(dataDir, 'mcp-config.json'))).toBe(false);
  });

  it('setToken fails closed when the written file is not owner-only', async () => {
    const dataDir = nestedMissingDir();
    hoisted.statMode = 'group-readable';
    await expect(setToken({ dataDir, serverId: 's1', token })).rejects.toThrow(/owner-only/);
    expect(fs.existsSync(path.join(dataDir, 'mcp-tokens.json'))).toBe(false);
  });
});

describe('sanitizeTokensFile prototype-key guard', () => {
  // JSON.parse (unlike an object literal) creates an OWN "__proto__" key, which is how a hand-edited
  // tokens file arrives; assigning it onto `out` would swap the servers map's prototype.
  it('never lets a "__proto__" or "constructor" server id through', () => {
    const raw = JSON.parse('{"servers":{"__proto__":{"accessToken":"p"},"constructor":{"accessToken":"c"},"ok":{"accessToken":"t"}}}');
    const out = sanitizeTokensFile({ raw }, { clock: { nowMs: () => 7 } });
    expect(Object.getPrototypeOf(out.servers)).toBe(Object.prototype);
    expect((out.servers as Record<string, unknown>).accessToken).toBeUndefined();
    expect(Object.keys(out.servers)).toEqual(['ok']);
    expect(Object.prototype.hasOwnProperty.call(out.servers, 'constructor')).toBe(false);
  });
});
