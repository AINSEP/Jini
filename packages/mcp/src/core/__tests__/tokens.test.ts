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
import type { Clock } from '@jini-ai/core/primitives';

// A package test supplies its own clock port; the system clock lives in the platform package.
const testClock = { nowMs: () => Date.now() };

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
    expect(sanitizeTokensFile({ raw: null, clock: testClock })).toEqual({ servers: {} });
    expect(sanitizeTokensFile({ raw: { servers: 5 }, clock: testClock })).toEqual({ servers: {} });
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
    expect(sanitizeTokensFile({ raw: { servers: { s1: full } }, clock: testClock })).toEqual({ servers: { s1: full } });
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
    const out = sanitizeTokensFile({ raw, clock: testClock });
    expect(out.servers.minimal).toEqual({ accessToken: 'tok', tokenType: 'Bearer', savedAt: expect.any(Number) });
    expect(out.servers.empties).toEqual({ accessToken: 'a', tokenType: 'Bearer', savedAt: expect.any(Number) });
    expect(out.servers).not.toHaveProperty('noaccess');
    expect(out.servers).not.toHaveProperty('notobject');
    expect(Object.keys(out.servers).sort()).toEqual(['empties', 'minimal']);
  });
});

describe('sanitizeTokensFile boundaries', () => {
  const fixedClock: Clock = { nowMs: () => 4242 };
  const OPTIONAL_STRINGS = ['refreshToken', 'scope', 'tokenEndpoint', 'clientId', 'clientSecret', 'authServerIssuer', 'redirectUri', 'resourceUrl'] as const;

  it('trims surrounding whitespace from every string field', () => {
    const raw: Record<string, unknown> = { accessToken: ' AT ', tokenType: ' DPoP ', savedAt: 1 };
    for (const key of OPTIONAL_STRINGS) raw[key] = `  ${key}-v  `;
    const expected: Record<string, unknown> = { accessToken: 'AT', tokenType: 'DPoP', savedAt: 1 };
    for (const key of OPTIONAL_STRINGS) expected[key] = `${key}-v`;
    expect(sanitizeTokensFile({ raw: { servers: { s: raw } }, clock: testClock }).servers.s).toEqual(expected);
  });

  it('drops non-string optional string fields and defaults a non-string tokenType', () => {
    const raw: Record<string, unknown> = { accessToken: 'AT', tokenType: 7, savedAt: 1 };
    for (const key of OPTIONAL_STRINGS) raw[key] = 7;
    expect(sanitizeTokensFile({ raw: { servers: { s: raw } }, clock: testClock }).servers.s).toEqual({ accessToken: 'AT', tokenType: 'Bearer', savedAt: 1 });
  });

  it('rejects a non-string or whitespace-only accessToken', () => {
    const out = sanitizeTokensFile({ raw: { servers: { num: { accessToken: 5 }, blank: { accessToken: '   ' } } }, clock: testClock });
    expect(out).toEqual({ servers: {} });
  });

  it('keeps a zero expiresAt and drops a non-finite one', () => {
    const out = sanitizeTokensFile({ raw: { servers: {
      zero: { accessToken: 'a', expiresAt: 0, savedAt: 1 },
      inf: { accessToken: 'b', expiresAt: Infinity, savedAt: 1 },
      nan: { accessToken: 'c', expiresAt: NaN, savedAt: 1 },
    } }, clock: testClock });
    expect(out.servers.zero).toStrictEqual({ accessToken: 'a', tokenType: 'Bearer', savedAt: 1, expiresAt: 0 });
    expect(out.servers.inf).toStrictEqual({ accessToken: 'b', tokenType: 'Bearer', savedAt: 1 });
    expect(out.servers.nan).toStrictEqual({ accessToken: 'c', tokenType: 'Bearer', savedAt: 1 });
  });

  // Stryker L3 F3: isPlainObject's Boolean(v) guard and the per-entry object check — null is
  // typeof 'object', so each needs its own null case; absent optionals must not appear as keys.
  it('treats a null file, null servers map and null entry as empty, never throwing', () => {
    expect(sanitizeTokensFile({ raw: null, clock: testClock })).toStrictEqual({ servers: {} });
    expect(sanitizeTokensFile({ raw: { servers: null }, clock: testClock })).toStrictEqual({ servers: {} });
    expect(sanitizeTokensFile({ raw: { servers: [{ accessToken: 'a' }] }, clock: testClock })).toStrictEqual({ servers: {} });
    expect(sanitizeTokensFile({ raw: { servers: { a: null, b: [], c: { accessToken: 'x', savedAt: 1 } } }, clock: testClock })).toStrictEqual({
      servers: { c: { accessToken: 'x', tokenType: 'Bearer', savedAt: 1 } },
    });
  });

  it('stamps savedAt from the injected clock when missing or non-finite, and keeps a finite one', () => {
    const out = sanitizeTokensFile({ raw: { servers: {
      missing: { accessToken: 'a' },
      inf: { accessToken: 'b', savedAt: -Infinity },
      kept: { accessToken: 'c', savedAt: 0 },
    } }, clock: testClock }, { clock: fixedClock });
    expect(out.servers.missing?.savedAt).toBe(4242);
    expect(out.servers.inf?.savedAt).toBe(4242);
    expect(out.servers.kept?.savedAt).toBe(0);
  });

  it('returns an empty store for an array servers value', () => {
    expect(sanitizeTokensFile({ raw: { servers: [{ accessToken: 'a' }] }, clock: testClock })).toEqual({ servers: {} });
  });
});

describe('readTokensFile', () => {
  it('returns an empty store when the file is missing', async () => {
    await expect(readTokensFile({ dataDir: tmp(), clock: testClock })).resolves.toEqual({ servers: {} });
  });
  it('returns an empty store on corrupt JSON', async () => {
    const dir = tmp();
    writeRaw(dir, '{ broken');
    await expect(readTokensFile({ dataDir: dir, clock: testClock })).resolves.toEqual({ servers: {} });
  });
  it('rethrows unexpected read errors (EISDIR)', async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'mcp-tokens.json'));
    await expect(readTokensFile({ dataDir: dir, clock: testClock })).rejects.toMatchObject({ code: 'EISDIR' });
  });
});

describe('token store mutations', () => {
  const tok: StoredMcpToken = { accessToken: 'AT', tokenType: 'Bearer', savedAt: 1 };

  it('C31: returns null for inherited entries and preserves corrupt contents before replacing the store', async () => {
    const dir = tmp();
    writeRaw(dir, '{"servers":{}}');
    expect.soft(await getToken({ dataDir: dir, serverId: 'toString', clock: testClock })).toBeNull();

    const corrupt = '{"servers":{"old":{"accessToken":"recover-me"}';
    writeRaw(dir, corrupt);
    await setToken({ dataDir: dir, serverId: 'new', token: tok, clock: testClock });

    // Recovery must retain the original bytes; no particular backup name is required.
    const backups = fs.readdirSync(dir)
      .filter((name) => name !== 'mcp-tokens.json')
      .map((name) => fs.readFileSync(path.join(dir, name), 'utf8'));
    expect.soft(backups).toContain(corrupt);
    expect(await getToken({ dataDir: dir, serverId: 'new', clock: testClock })).toEqual(tok);
  });

  it('sets, gets, bulk-reads, and clears a token', async () => {
    const dir = tmp();
    expect(await getToken({ dataDir: dir, serverId: 's1', clock: testClock })).toBeNull();
    await setToken({ dataDir: dir, serverId: 's1', token: tok, clock: testClock });
    expect(await getToken({ dataDir: dir, serverId: 's1', clock: testClock })).toEqual(tok);
    expect(await readAllTokens({ dataDir: dir, clock: testClock })).toEqual({ s1: tok });
    await clearToken({ dataDir: dir, serverId: 's1', clock: testClock });
    expect(await getToken({ dataDir: dir, serverId: 's1', clock: testClock })).toBeNull();
  });

  it('clearToken is a no-op when the server is absent', async () => {
    const dir = tmp();
    await setToken({ dataDir: dir, serverId: 's1', token: tok, clock: testClock });
    await clearToken({ dataDir: dir, serverId: 'missing', clock: testClock });
    expect(await getToken({ dataDir: dir, serverId: 's1', clock: testClock })).toEqual(tok);
  });

  it('serializes concurrent writes on the same dataDir', async () => {
    const dir = tmp();
    await Promise.all([
      setToken({ dataDir: dir, serverId: 'a', token: { accessToken: 'A', tokenType: 'Bearer', savedAt: 1 }, clock: testClock }),
      setToken({ dataDir: dir, serverId: 'b', token: { accessToken: 'B', tokenType: 'Bearer', savedAt: 2 }, clock: testClock }),
    ]);
    const all = await readAllTokens({ dataDir: dir, clock: testClock });
    expect(Object.keys(all).sort()).toEqual(['a', 'b']);
  });

  it('persists the token file with owner-only (0600) permissions from creation (CR-006 / SEC-RB-002)', async () => {
    const dir = tmp();
    await setToken({ dataDir: dir, serverId: 's1', token: tok, clock: testClock });
    if (process.platform !== 'win32') {
      const mode = fs.statSync(path.join(dir, 'mcp-tokens.json')).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('fails closed — rejects and leaves no token file — when the OS does not honor owner-only mode', async () => {
    hoisted.statMode = 'group-readable';
    const dir = tmp();
    await expect(setToken({ dataDir: dir, serverId: 's1', token: tok, clock: testClock })).rejects.toThrow(/owner-only/);
    expect(fs.existsSync(path.join(dir, 'mcp-tokens.json'))).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]); // no leftover temp file either
  });

  it('does not clobber a previously-persisted token when a later write fails closed', async () => {
    const dir = tmp();
    await setToken({ dataDir: dir, serverId: 's1', token: tok, clock: testClock });
    hoisted.statMode = 'group-readable';
    await expect(setToken({ dataDir: dir, serverId: 's2', token: { accessToken: 'B', tokenType: 'Bearer', savedAt: 2 }, clock: testClock })).rejects.toThrow('atomic write refused non-owner-only permissions');
    hoisted.statMode = 'ok';
    expect(await getToken({ dataDir: dir, serverId: 's1', clock: testClock })).toEqual(tok);
    expect(await getToken({ dataDir: dir, serverId: 's2', clock: testClock })).toBeNull();
  });
});

describe('isTokenExpired', () => {
  it('never expires a token without expiresAt', () => {
    expect(isTokenExpired({ token: { accessToken: 'x', tokenType: 'Bearer', savedAt: 1 }, clock: testClock })).toBe(false);
  });
  it('expires when past expiry (accounting for skew) and not before', () => {
    const t: StoredMcpToken = { accessToken: 'x', tokenType: 'Bearer', savedAt: 1, expiresAt: 1000 };
    expect(isTokenExpired({ token: t, clock: testClock }, { now: 500, skew: 0 })).toBe(false); // 1000 <= 500 -> not expired
    expect(isTokenExpired({ token: t, clock: testClock }, { now: 2000, skew: 0 })).toBe(true); // 1000 <= 2000 -> expired
    expect(isTokenExpired({ token: t, clock: testClock }, { now: 980, skew: 30_000 })).toBe(true); // -29000 <= 980 -> expired via skew
  });
  it('uses default now/skew when omitted', () => {
    expect(isTokenExpired({ token: { accessToken: 'x', tokenType: 'Bearer', savedAt: 1, expiresAt: 1 }, clock: testClock })).toBe(true);
  });
});

it('logs malformed token JSON as its class only, never the echoed file text', async () => {
  const dir = tmp();
  writeRaw(dir, 'boom api_key=SECRETSECRETSECRETSECRET');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(readTokensFile({ dataDir: dir, clock: testClock })).resolves.toEqual({ servers: {} });
    expect(log).toHaveBeenCalledWith('[mcp-tokens] Corrupted JSON, returning empty:', 'SyntaxError');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/boom|SECRETSECRET/);
  } finally { log.mockRestore(); }
});
