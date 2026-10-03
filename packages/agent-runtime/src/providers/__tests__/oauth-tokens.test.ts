import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMockState = vi.hoisted(() => ({
  chmodImpl: null as ((...args: unknown[]) => Promise<void>) | null,
  readFileImpl: null as ((...args: unknown[]) => Promise<string>) | null,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    chmod: (...args: unknown[]) =>
      fsMockState.chmodImpl ? fsMockState.chmodImpl(...args) : (actual.chmod as (...a: unknown[]) => Promise<void>)(...args),
    readFile: (...args: unknown[]) =>
      fsMockState.readFileImpl ? fsMockState.readFileImpl(...args) : (actual.readFile as (...a: unknown[]) => Promise<string>)(...args),
  };
});

import {
  clearStoredOAuthToken,
  getStoredOAuthToken,
  isOAuthTokenExpired,
  readOAuthTokenFile,
  sanitizeOAuthTokenFile,
  setStoredOAuthToken,
  type StoredOAuthToken,
} from '../oauth-tokens.js';

const FILE_NAME = 'test-provider-tokens.json';

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'oauth-tokens-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  fsMockState.chmodImpl = null;
  fsMockState.readFileImpl = null;
});

const token = (overrides: Partial<StoredOAuthToken> = {}): StoredOAuthToken => ({
  accessToken: 'at-1',
  tokenType: 'Bearer',
  savedAt: Date.now(),
  ...overrides,
});

describe('getStoredOAuthToken / setStoredOAuthToken / clearStoredOAuthToken', () => {
  it('returns null when nothing is stored', async () => {
    await expect(getStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME })).resolves.toBeNull();
  });

  it('stores and retrieves a token, chmod 0600 on POSIX', async () => {
    const t = token({ refreshToken: 'rt-1', scope: 'a b', expiresAt: 123 });
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: t });
    const stored = await getStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME });
    expect(stored).toEqual(t);
    if (process.platform !== 'win32') {
      const st = await import('node:fs/promises').then((fs) => fs.stat(path.join(dataDir, FILE_NAME)));
      expect(st.mode & 0o777).toBe(0o600);
    }
  });

  it('creates the data directory if missing', async () => {
    const nested = path.join(dataDir, 'nested', 'deeper');
    const t = token();
    await setStoredOAuthToken({ dataDir: nested, fileName: FILE_NAME, token: t });
    await expect(getStoredOAuthToken({ dataDir: nested, fileName: FILE_NAME })).resolves.toEqual(t);
  });

  it('clears a stored token and is a no-op when nothing is stored', async () => {
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: token() });
    await clearStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME });
    await expect(getStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME })).resolves.toBeNull();
    await expect(clearStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME })).resolves.toBeUndefined();
  });

  it('overwrites an existing token atomically', async () => {
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: token({ accessToken: 'first' }) });
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: token({ accessToken: 'second' }) });
    const stored = await getStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME });
    expect(stored?.accessToken).toBe('second');
  });

  it('serializes concurrent writes for the same dataDir+fileName without interleaving', async () => {
    await Promise.all([
      setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: token({ accessToken: 'a' }) }),
      setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: token({ accessToken: 'b' }) }),
      setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: token({ accessToken: 'c' }) }),
    ]);
    const stored = await getStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME });
    expect(['a', 'b', 'c']).toContain(stored?.accessToken);
  });

  it('does not let one dataDir+fileName lock block a different one', async () => {
    const otherDir = await mkdtemp(path.join(tmpdir(), 'oauth-tokens-other-'));
    try {
      await Promise.all([
        setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: token({ accessToken: 'dir1' }) }),
        setStoredOAuthToken({ dataDir: otherDir, fileName: FILE_NAME, token: token({ accessToken: 'dir2' }) }),
      ]);
      await expect(getStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME })).resolves.toMatchObject({ accessToken: 'dir1' });
      await expect(getStoredOAuthToken({ dataDir: otherDir, fileName: FILE_NAME })).resolves.toMatchObject({ accessToken: 'dir2' });
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });
});

describe('readOAuthTokenFile', () => {
  it('returns {} on ENOENT', async () => {
    await expect(readOAuthTokenFile({ dataDir: dataDir, fileName: 'missing.json' })).resolves.toEqual({});
  });

  it('returns {} and logs on corrupted JSON', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(dataDir, FILE_NAME), 'not json {{', 'utf8');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(readOAuthTokenFile({ dataDir: dataDir, fileName: FILE_NAME })).resolves.toEqual({});
    expect(errSpy).toHaveBeenCalled();
  });

  it('re-throws an unexpected (non-ENOENT, non-SyntaxError) read error', async () => {
    // Mocked rather than induced via real file permissions: this sandbox
    // runs as root, where chmod 000 does not actually deny a root reader
    // (see packages/agent-runtime/archived provenance ledger's launch.test.ts note for
    // the same pre-existing environment caveat), so a real permission
    // error can't be reproduced here.
    fsMockState.readFileImpl = async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    };
    await expect(readOAuthTokenFile({ dataDir: dataDir, fileName: FILE_NAME })).rejects.toMatchObject({ code: 'EACCES' });
  });
});

describe('writeTokenFile chmod fallback', () => {
  it('warns when chmod fails with a code other than ENOTSUP/EPERM', async () => {
    fsMockState.chmodImpl = async () => {
      throw Object.assign(new Error('io error'), { code: 'EIO' });
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: token() });
    expect(warnSpy).toHaveBeenCalledWith(
      '[oauth-tokens] could not chmod 0600',
      expect.stringContaining(FILE_NAME),
      'io error',
    );
  });

  it('silently ignores ENOTSUP and EPERM chmod failures', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const code of ['ENOTSUP', 'EPERM']) {
      fsMockState.chmodImpl = async () => {
        throw Object.assign(new Error('x'), { code });
      };
      await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: token() });
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to the raw error object when the chmod failure has no message', async () => {
    fsMockState.chmodImpl = async () => {
      throw { code: 'EIO' };
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setStoredOAuthToken({ dataDir: dataDir, fileName: FILE_NAME, token: token() });
    expect(warnSpy).toHaveBeenCalledWith('[oauth-tokens] could not chmod 0600', expect.stringContaining(FILE_NAME), { code: 'EIO' });
  });
});

describe('sanitizeOAuthTokenFile', () => {
  it('returns {} for non-plain-object input', () => {
    expect(sanitizeOAuthTokenFile({ raw: null })).toEqual({});
    expect(sanitizeOAuthTokenFile({ raw: [1, 2] })).toEqual({});
    expect(sanitizeOAuthTokenFile({ raw: 'a string' })).toEqual({});
  });

  it('drops a token missing accessToken', () => {
    expect(sanitizeOAuthTokenFile({ raw: { token: { tokenType: 'Bearer' } } })).toEqual({});
    expect(sanitizeOAuthTokenFile({ raw: { token: { accessToken: '   ' } } })).toEqual({});
    expect(sanitizeOAuthTokenFile({ raw: { token: null } })).toEqual({});
  });

  it('defaults tokenType to Bearer and savedAt to now when absent/invalid', () => {
    const before = Date.now();
    const result = sanitizeOAuthTokenFile({ raw: { token: { accessToken: 'at-1', tokenType: '  ' } } });
    expect(result.token?.tokenType).toBe('Bearer');
    expect(result.token?.savedAt).toBeGreaterThanOrEqual(before);
  });

  it('keeps refreshToken/scope/expiresAt when present and valid, drops when blank/invalid', () => {
    const withAll = sanitizeOAuthTokenFile({ raw: {
      token: { accessToken: 'at-1', refreshToken: 'rt-1', scope: 'a b', expiresAt: 12345, savedAt: 999 },
    } });
    expect(withAll.token).toEqual({
      accessToken: 'at-1',
      tokenType: 'Bearer',
      refreshToken: 'rt-1',
      scope: 'a b',
      expiresAt: 12345,
      savedAt: 999,
    });

    const withBlanks = sanitizeOAuthTokenFile({ raw: {
      token: { accessToken: 'at-1', refreshToken: '  ', scope: '  ', expiresAt: Number.NaN, savedAt: 'not-a-number' },
    } });
    expect(withBlanks.token?.refreshToken).toBeUndefined();
    expect(withBlanks.token?.scope).toBeUndefined();
    expect(withBlanks.token?.expiresAt).toBeUndefined();
  });

  it('trims accessToken', () => {
    const result = sanitizeOAuthTokenFile({ raw: { token: { accessToken: '  at-1  ' } } });
    expect(result.token?.accessToken).toBe('at-1');
  });
});

describe('isOAuthTokenExpired', () => {
  it('is false when no expiresAt is recorded', () => {
    expect(isOAuthTokenExpired({ token: token() })).toBe(false);
  });

  it('is false well before expiry and true within the skew window / past expiry', () => {
    const now = 1_000_000;
    const t = token({ expiresAt: now + 10_000 });
    expect(isOAuthTokenExpired({ token: t }, { now: now, skew: 1000 })).toBe(false);
    expect(isOAuthTokenExpired({ token: t }, { now: now + 9_500, skew: 1000 })).toBe(true);
    expect(isOAuthTokenExpired({ token: t }, { now: now + 10_001, skew: 1000 })).toBe(true);
  });

  it('uses the default skew and current time when not supplied', () => {
    const expired = token({ expiresAt: Date.now() - 1 });
    expect(isOAuthTokenExpired({ token: expired })).toBe(true);
    const fresh = token({ expiresAt: Date.now() + 10 * 60 * 1000 });
    expect(isOAuthTokenExpired({ token: fresh })).toBe(false);
  });
});
