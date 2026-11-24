import { describe, expect, it } from 'vitest';
import { compareSiteVersions, SiteUpdateError } from '../contracts.js';
import { checkForUpdateFromFeed } from '../check-for-update.js';

const ids = { newId: () => 'ERR-AAAA-BBBB-CCCC-DDDD' };

describe('compareSiteVersions', () => {
  it.each([
    ['1.2.3', '1.2.3', 0],
    ['1.2.3', '1.2.4', -1],
    ['1.10.0', '1.9.9', 1],
    ['2.0.0', '10.0.0', -1],
    ['v0.7.3', '0.7.3', 0],
    ['0.7.3-next.2', '0.7.3', -1],
    ['0.7.3', '0.7.3-next.2', 1],
    ['0.7.3-next.2', '0.7.3-next.10', -1],
    ['0.7.3-next', '0.7.3-next.1', -1],
    ['0.7.3-alpha', '0.7.3-beta', -1],
    ['0.7.3-beta', '0.7.3-alpha', 1],
    ['0.7.3-1', '0.7.3-alpha', -1],
    ['0.7.3-alpha', '0.7.3-1', 1],
    ['0.7.3-rc.1', '0.7.3-rc.1', 0],
    ['1.0.0+build.5', '1.0.0+build.9', 0],
  ] as const)('%s vs %s -> %d', (left, right, expected) => {
    expect(compareSiteVersions({ left, right })).toBe(expected);
  });

  it('throws a plain-words error carrying an ERR- id for an invalid version', () => {
    let caught: unknown;
    try { compareSiteVersions({ left: 'latest', right: '1.0.0' }, { ids }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(SiteUpdateError);
    const error = caught as SiteUpdateError;
    expect(error.code).toBe('invalid-version');
    expect(error.errorId).toBe('ERR-AAAA-BBBB-CCCC-DDDD');
    expect(error.message).toBe('ERR-AAAA-BBBB-CCCC-DDDD: "latest" is not a version number like 1.2.3.');
  });

  it.each(['1.0', '1.0.0.0', '01.0.0', '1.0.0-', '1.0.0-a..b', '1.0.0-a_b', '1.0.0+', '1.0.0+a+b', '1.0.0+bad_meta', ''])('rejects the malformed version %j', (version) => {
    expect(() => compareSiteVersions({ left: version, right: '1.0.0' })).toThrow(SiteUpdateError);
  });

  it('falls back to the reserved unavailable id when no id source is injected', () => {
    expect(() => compareSiteVersions({ left: '1.0.0', right: '1.0' })).toThrow(/^ERR-0000-0000-0000-0000: "1.0" is not a version number/);
  });
});

describe('checkForUpdateFromFeed', () => {
  const feedOf = (release: { version: string; notes: string } | null) => ({ latestRelease: async () => release });

  it('returns the newer release with its notes', async () => {
    const result = await checkForUpdateFromFeed({ runningVersion: '0.7.3-next.2', feed: feedOf({ version: '0.7.3', notes: 'Faster pages.' }) });
    expect(result).toEqual({ latest: '0.7.3', notes: 'Faster pages.' });
  });

  it('returns null when the running version equals the latest release', async () => {
    expect(await checkForUpdateFromFeed({ runningVersion: '0.7.3', feed: feedOf({ version: '0.7.3', notes: '' }) })).toBeNull();
  });

  it('returns null when the running version is ahead of the latest release', async () => {
    expect(await checkForUpdateFromFeed({ runningVersion: '0.8.0', feed: feedOf({ version: '0.7.3', notes: '' }) })).toBeNull();
  });

  it('returns null when the feed has no release yet', async () => {
    expect(await checkForUpdateFromFeed({ runningVersion: '0.8.0', feed: feedOf(null) })).toBeNull();
  });

  it('passes the abort signal to the feed', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const feed = { latestRelease: async (_required: Record<string, never>, optional?: { signal?: AbortSignal }) => { seen = optional?.signal; return null; } };
    await checkForUpdateFromFeed({ runningVersion: '1.0.0', feed }, { signal: controller.signal });
    expect(seen).toBe(controller.signal);
  });
});
