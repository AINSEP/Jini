import { describe, expect, it, vi } from 'vitest';

import { assertExternalAssetUrl, validateBaseUrlResolved } from '../ssrf-guard.js';

/**
 * SSRF edges for `validateBaseUrlResolved` (Stryker L6: 19 survivors). The IP-literal shortcut
 * skips DNS, so anything that only LOOKS like a literal must still be resolved and vetted, and a
 * multi-address answer is refused if ANY address is internal, wherever it sits.
 */

const blocked = { ok: false, error: 'Internal IPs blocked', forbidden: true };
const publicAddr = { address: '93.184.216.34', family: 4 };
const internalAddr = { address: '10.0.0.5', family: 4 };

describe('IP-literal shortcut', () => {
  it.each([
    'http://1.2.3.4.example.com/a.png',
    'http://1.2.3.4.nip.io/a.png',
    'http://cdn-1.2.3.4.example.com/a.png',
  ])('%s is a DNS name, not a literal: it is resolved and an internal answer is blocked', async (baseUrl) => {
    const lookup = vi.fn(async () => [internalAddr]);
    expect(await validateBaseUrlResolved({ baseUrl }, { lookup })).toEqual(blocked);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it.each(['http://8.8.8.8/a.png', 'http://[2001:4860:4860::8888]/a.png', 'http://1.2.3/a.png'])(
    '%s (a public literal, after URL normalisation) is accepted without DNS',
    async (baseUrl) => {
      const lookup = vi.fn(async () => [internalAddr]);
      expect(await validateBaseUrlResolved({ baseUrl }, { lookup })).toEqual({ ok: true });
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it.each(['http://[::1]/a', 'http://[fd00::1]/a', 'http://[fe80::1]/a', 'http://[::ffff:10.0.0.1]/a', 'http://0x7f000001/a', 'http://2130706433/a'])(
    '%s (internal literal, any spelling) is blocked before DNS',
    async (baseUrl) => {
      const lookup = vi.fn(async () => [publicAddr]);
      expect(await validateBaseUrlResolved({ baseUrl }, { lookup })).toEqual(blocked);
      expect(lookup).not.toHaveBeenCalled();
    },
  );
});

describe('multi-address DNS answers', () => {
  it.each([
    ['first', [internalAddr, publicAddr, publicAddr]],
    ['middle', [publicAddr, internalAddr, publicAddr]],
    ['last', [publicAddr, publicAddr, internalAddr]],
    ['last (IPv6 ULA)', [publicAddr, { address: 'FD00::5', family: 6 }]],
    ['last (IPv6 loopback)', [publicAddr, { address: '::1', family: 6 }]],
  ])('one internal address (%s) blocks the whole answer', async (_where, answer) => {
    expect(await validateBaseUrlResolved({ baseUrl: 'https://cdn.example.com/x' }, { lookup: async () => answer })).toEqual(blocked);
  });

  it('all public addresses → ok', async () => {
    const answer = [publicAddr, { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }, { address: '1.1.1.1', family: 4 }];
    expect(await validateBaseUrlResolved({ baseUrl: 'https://cdn.example.com/x' }, { lookup: async () => answer })).toEqual({ ok: true });
  });

  it('an empty answer fails closed', async () => {
    expect(await validateBaseUrlResolved({ baseUrl: 'https://cdn.example.com/x' }, { lookup: async () => [] })).toEqual({
      ok: false,
      error: 'DNS resolution failed',
      forbidden: true,
    });
  });

  it('the hostname is lower-cased before lookup', async () => {
    const lookup = vi.fn(async () => [publicAddr]);
    await validateBaseUrlResolved({ baseUrl: 'https://CDN.Example.COM/x' }, { lookup });
    expect(lookup).toHaveBeenCalledWith({ hostname: 'cdn.example.com' });
  });
});

describe('sync URL checks', () => {
  it.each([
    ['username only', 'https://user@cdn.example.com/x'],
    ['password only', 'https://:pw@cdn.example.com/x'],
  ])('%s → credentials refusal, forbidden', async (_label, baseUrl) => {
    const lookup = vi.fn(async () => [publicAddr]);
    expect(await validateBaseUrlResolved({ baseUrl }, { lookup })).toMatchObject({ ok: false, forbidden: true });
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(['ftp://cdn.example.com/x', 'file:///etc/passwd', 'data:text/plain,hi', 'javascript:alert(1)'])(
    '%s → Only http/https allowed (not forbidden)',
    async (baseUrl) => {
      expect(await validateBaseUrlResolved({ baseUrl }, { lookup: async () => [publicAddr] })).toEqual({
        ok: false,
        error: 'Only http/https allowed',
        forbidden: false,
      });
    },
  );

  it('trailing slashes are stripped before parsing (a bare-host URL with many slashes stays valid)', async () => {
    expect(await validateBaseUrlResolved({ baseUrl: 'https://cdn.example.com///' }, { lookup: async () => [publicAddr] })).toEqual({ ok: true });
  });
});

describe('survivor follow-ups', () => {
  it.each(['http://100.200.30.4/a', 'http://203.0.113.255/a'])('multi-digit public literal %s skips DNS', async (baseUrl) => {
    const lookup = vi.fn(async () => [internalAddr]);
    expect(await validateBaseUrlResolved({ baseUrl }, { lookup })).toEqual({ ok: true });
    expect(lookup).not.toHaveBeenCalled();
  });
});

it.each([5, null, {}, ''])('assertExternalAssetUrl refuses a non-string or empty url (%j) as empty, without DNS', async (rawUrl) => {
  const lookup = vi.fn(async () => [publicAddr]);
  expect(await assertExternalAssetUrl({ rawUrl: rawUrl as string }, { lookup })).toEqual({ ok: false, error: 'empty download url' });
  expect(lookup).not.toHaveBeenCalled();
});
