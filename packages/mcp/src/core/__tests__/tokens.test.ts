import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// `stat` is intercepted so the fail-closed "the OS didn't honor mode 0600"
// path (CR-006 / SEC-RB-002 — `writeFileAtomicAsync`) can be exercised
// deterministically without needing an OS that actually misbehaves. All
// other fs/promises calls delegate to the real implementation.
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

import {
  sanitizeTokensFile,
  readTokensFile,
  getToken,
  setToken,
  clearToken,
  readAllTokens,
  isTokenExpired,
  type StoredMcpToken,
} from '../tokens.js';

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-mcp-tok-'));
  tmpDirs.push(d);
  return d;
}
function writeRaw(dir: string, json: string): void {
  fs.writeFileSync(path.join(dir, 'mcp-tokens.json'), json);
}

beforeEach(() => {
  hoisted.statMode = 'ok';
});
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('sanitizeTokensFile / sanitizeToken', () => {
  it('returns an empty store for non-objects and a non-object servers map', () => {
    expect(sanitizeTokensFile({ raw: null })).toEqual({ servers: {} });
    expect(sanitizeTokensFile({ raw: { servers: 5 } })).toEqual({ servers: {} });
  });

  it('keeps a fully-populated token verbatim', () => {
    const full: StoredMcpToken = {
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: 123456,
      tokenType: 'Bearer',
      scope: 'read write',
      savedAt: 999,
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'cid',
      clientSecret: 'secret',
      authServerIssuer: 'https://auth.example.com',
      redirectUri: 'https://cb.example.com',
      resourceUrl: 'https://mcp.example.com',
    };
    expect(sanitizeTokensFile({ raw: { servers: { s1: full } } })).toEqual({ servers: { s1: full } });
  });

  it('applies defaults, drops falsy optionals, trims, and rejects bad entries', () => {
    const raw = JSON.parse(
      JSON.stringify({
        servers: {
          minimal: { accessToken: 'tok' },
          empties: {
            accessToken: '  a  ',
            tokenType: '   ',
            refreshToken: '  ',
            scope: '',
            expiresAt: 'nope',
            savedAt: 'x',
            tokenEndpoint: '',
            clientId: '  ',
            clientSecret: '',
            authServerIssuer: '',
            redirectUri: '',
            resourceUrl: '',
          },
          noaccess: { tokenType: 'Bearer' },
          notobject: 5,
          '__proto__': { accessToken: 'p' },
          constructor: { accessToken: 'c' },
        },
      }),
    );
    const out = sanitizeTokensFile({ raw });
    expect(out.servers.minimal).toEqual({ accessToken: 'tok', tokenType: 'Bearer', savedAt: expect.any(Number) });
    expect(out.servers.empties).toEqual({ accessToken: 'a', tokenType: 'Bearer', savedAt: expect.any(Number) });
    expect(out.servers).not.toHaveProperty('noaccess');
    expect(out.servers).not.toHaveProperty('notobject');
    expect(Object.keys(out.servers).sort()).toEqual(['empties', 'minimal']);
  });
});

describe('readTokensFile', () => {
  it('returns an empty store when the file is missing', async () => {
    await expect(readTokensFile({ dataDir: tmp() })).resolves.toEqual({ servers: {} });
  });
  it('returns an empty store on corrupt JSON', async () => {
    const dir = tmp();
    writeRaw(dir, '{ broken');
    await expect(readTokensFile({ dataDir: dir })).resolves.toEqual({ servers: {} });
  });
  it('rethrows unexpected read errors (EISDIR)', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'mcp-tokens.json'));
    await expect(readTokensFile({ dataDir: dir })).rejects.toThrow();
  });
});

describe('token store mutations', () => {
  const tok: StoredMcpToken = { accessToken: 'AT', tokenType: 'Bearer', savedAt: 1 };

  it('sets, gets, bulk-reads, and clears a token', async () => {
    const dir = tmp();
    expect(await getToken({ dataDir: dir, serverId: 's1' })).toBeNull();
    await setToken({ dataDir: dir, serverId: 's1', token: tok });
    expect(await getToken({ dataDir: dir, serverId: 's1' })).toEqual(tok);
    expect(await readAllTokens({ dataDir: dir })).toEqual({ s1: tok });
    await clearToken({ dataDir: dir, serverId: 's1' });
    expect(await getToken({ dataDir: dir, serverId: 's1' })).toBeNull();
  });

  it('clearToken is a no-op when the server is absent', async () => {
    const dir = tmp();
    await setToken({ dataDir: dir, serverId: 's1', token: tok });
    await clearToken({ dataDir: dir, serverId: 'missing' });
    expect(await getToken({ dataDir: dir, serverId: 's1' })).toEqual(tok);
  });

  it('serializes concurrent writes on the same dataDir', async () => {
    const dir = tmp();
    await Promise.all([
      setToken({ dataDir: dir, serverId: 'a', token: { accessToken: 'A', tokenType: 'Bearer', savedAt: 1 } }),
      setToken({ dataDir: dir, serverId: 'b', token: { accessToken: 'B', tokenType: 'Bearer', savedAt: 2 } }),
    ]);
    const all = await readAllTokens({ dataDir: dir });
    expect(Object.keys(all).sort()).toEqual(['a', 'b']);
  });

  it('persists the token file with owner-only (0600) permissions from creation (CR-006 / SEC-RB-002)', async () => {
    const dir = tmp();
    await setToken({ dataDir: dir, serverId: 's1', token: tok });
    if (process.platform !== 'win32') {
      const mode = fs.statSync(path.join(dir, 'mcp-tokens.json')).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('fails closed — rejects and leaves no token file — when the OS does not honor owner-only mode', async () => {
    hoisted.statMode = 'group-readable';
    const dir = tmp();
    await expect(setToken({ dataDir: dir, serverId: 's1', token: tok })).rejects.toThrow(/owner-only/);
    expect(fs.existsSync(path.join(dir, 'mcp-tokens.json'))).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]); // no leftover temp file either
  });

  it('does not clobber a previously-persisted token when a later write fails closed', async () => {
    const dir = tmp();
    await setToken({ dataDir: dir, serverId: 's1', token: tok });
    hoisted.statMode = 'group-readable';
    await expect(setToken({ dataDir: dir, serverId: 's2', token: { accessToken: 'B', tokenType: 'Bearer', savedAt: 2 } })).rejects.toThrow();
    hoisted.statMode = 'ok';
    expect(await getToken({ dataDir: dir, serverId: 's1' })).toEqual(tok);
    expect(await getToken({ dataDir: dir, serverId: 's2' })).toBeNull();
  });
});

describe('isTokenExpired', () => {
  it('never expires a token without expiresAt', () => {
    expect(isTokenExpired({ token: { accessToken: 'x', tokenType: 'Bearer', savedAt: 1 } })).toBe(false);
  });
  it('expires when past expiry (accounting for skew) and not before', () => {
    const t: StoredMcpToken = { accessToken: 'x', tokenType: 'Bearer', savedAt: 1, expiresAt: 1000 };
    expect(isTokenExpired({ token: t }, { now: 500, skew: 0 })).toBe(false); // 1000 <= 500 -> not expired
    expect(isTokenExpired({ token: t }, { now: 2000, skew: 0 })).toBe(true); // 1000 <= 2000 -> expired
    expect(isTokenExpired({ token: t }, { now: 980, skew: 30_000 })).toBe(true); // -29000 <= 980 -> expired via skew
  });
  it('uses default now/skew when omitted', () => {
    expect(isTokenExpired({ token: { accessToken: 'x', tokenType: 'Bearer', savedAt: 1, expiresAt: 1 } })).toBe(true);
  });
});
