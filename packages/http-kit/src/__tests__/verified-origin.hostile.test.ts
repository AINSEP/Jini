import { describe, expect, it, vi } from 'vitest';
import { OriginRegistry, isSameOrigin, normalizeOriginCandidate } from '../verified-origin/origin.js';
import { planOriginBoot, resolveConfiguredOrigin } from '../verified-origin/configured-origin.js';

/** L9 §4: candidate normalization refuses each bad input on its own, cross-origin allowlisting is
 *  HTTPS-only, and operator-declared origins refuse userinfo / loopback look-alikes individually. */
describe('normalizeOriginCandidate', () => {
  it.each([
    ['https://Example.COM./p', { scheme: 'https', host: 'example.com', port: 443 }],
    ['http://example.com', { scheme: 'http', host: 'example.com', port: 80 }],
    ['https://example.com:8443', { scheme: 'https', host: 'example.com', port: 8443 }],
    ['http://example.com:443', { scheme: 'http', host: 'example.com', port: 443 }],
  ])('%s → %j', (rawUrl, expected) => {
    expect(normalizeOriginCandidate({ rawUrl })).toEqual(expected);
  });
  it.each([
    '', 5, null, undefined, 'not a url', 'ftp://example.com', 'javascript:alert(1)', 'https://user@example.com', 'https://:pw@example.com',
    'https://example.com/a b', 'https://exa\\mple.com', 'https://example.com\n', 'file:///etc/passwd',
  ])('refuses %j', (rawUrl) => {
    expect(normalizeOriginCandidate({ rawUrl: rawUrl as string })).toBeNull();
  });
});

describe('isSameOrigin', () => {
  const canonical = { scheme: 'https', host: 'Example.com.', verifiedAt: 'now', source: 'workspace-setting' } as never;
  it('scheme, host (case/trailing-dot) and default port each matter', () => {
    expect(isSameOrigin({ target: { scheme: 'https', host: 'example.com', port: 443 }, canonical })).toBe(true);
    expect(isSameOrigin({ target: { scheme: 'http', host: 'example.com', port: 443 }, canonical })).toBe(false);
    expect(isSameOrigin({ target: { scheme: 'https', host: 'example.org', port: 443 }, canonical })).toBe(false);
    expect(isSameOrigin({ target: { scheme: 'https', host: 'example.com', port: 8443 }, canonical })).toBe(false);
    expect(isSameOrigin({ target: { scheme: 'http', host: 'example.com', port: 80 }, canonical: { ...(canonical as object), scheme: 'http' } as never })).toBe(true);
  });
});

describe('OriginRegistry allowlisting', () => {
  const origin = { scheme: 'https', host: 'site.test', verifiedAt: '2026-01-01T00:00:00.000Z', source: 'workspace-setting' };
  const registry = (allow: string[] = [' Partner.TEST. '], found: unknown = origin) => new OriginRegistry({ repo: {
    findByWorkspaceId: vi.fn(async () => found), findRedirectAllowlist: vi.fn(async () => allow), findEgressAllowlist: vi.fn(async () => allow),
  } as never });
  it('allowlisted host passes only over https; the http variant is refused', async () => {
    const r = registry();
    expect(await r.isAllowedRedirectTarget({ context: { workspaceId: 'w' }, url: 'https://partner.test/x' })).toBe(true);
    expect(await r.isAllowedRedirectTarget({ context: { workspaceId: 'w' }, url: 'http://partner.test/x' })).toBe(false);
    expect(await r.isAllowedEgressTarget({ context: { workspaceId: 'w' }, url: 'https://evil.partner.test' })).toBe(false);
  });
  it('an unparseable target or a missing verified origin fails closed', async () => {
    expect(await registry().isAllowedEgressTarget({ context: { workspaceId: 'w' }, url: 'nope' })).toBe(false);
    expect(await registry([], null).isAllowedRedirectTarget({ context: { workspaceId: 'w' }, url: 'https://site.test' })).toBe(false);
  });
  it('canonicalOrigin names the workspace in OriginNotVerifiedError', async () => {
    await expect(registry([], null).canonicalOrigin({ workspaceId: 'ws-9' })).rejects.toThrow("no verified origin registered for workspace 'ws-9'");
  });
});

describe('resolveConfiguredOrigin refusals', () => {
  const clock = { nowIso: () => '2026-01-01T00:00:00.000Z' };
  const resolve = (value: string | undefined) => {
    const warn = vi.fn();
    return { origin: resolveConfiguredOrigin({ env: { URL: value }, envVarName: 'URL', clock, warn }), warn };
  };
  it.each([
    ['https://user@site.test', 'it carries a userinfo component'],
    ['https://:secret@site.test', 'it carries a userinfo component'],
    ['http://site.test', 'its scheme must be https'],
    ['https://site.test?x=1', 'it carries a query string or fragment'],
    ['https://127.0.0.1', "'127.0.0.1' is a loopback host, not a public origin"],
    ['https://127.255.0.10', "'127.255.0.10' is a loopback host, not a public origin"],
    ['https://app.localhost', "'app.localhost' is a loopback host, not a public origin"],
    ['https://[::1]', "'[::1]' is a loopback host, not a public origin"],
    ['not a url', 'it is not a parseable URL'],
  ])('%s refused: %s', (value, reason) => {
    const { origin, warn } = resolve(value);
    expect(origin).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(`URL is set but was refused as this deployment's public origin (${reason}); no origin was registered from it. Value: ${value}`);
  });
  it.each(['https://127.0.0.1.example.com', 'https://x127.0.0.1.test', 'https://1270.0.0.1.test', 'https://localhost.example.com'])('loopback look-alike %s is accepted as public', (value) => {
    expect(resolve(value).origin?.host).toBe(new URL(value).hostname);
  });
  it('strips trailing slashes from basePath and keeps an explicit port', () => {
    expect(resolve('  https://Site.Test.:8443/base//  ').origin).toMatchObject({ scheme: 'https', host: 'site.test', port: 8443, basePath: '/base' });
    expect(resolve('https://site.test/').origin).not.toHaveProperty('basePath');
  });
  it('blank values are quiet; planOriginBoot falls back to dev-seed or warns', () => {
    for (const value of [undefined, '', '   ']) {
      const { origin, warn } = resolve(value);
      expect(origin).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    }
    const warn = vi.fn();
    expect(planOriginBoot({ env: {}, envVarName: 'URL', clock, warn, allowDevSeed: () => true, missingOriginWarning: 'm' })).toEqual({ kind: 'dev-seed' });
    expect(planOriginBoot({ env: {}, envVarName: 'URL', clock, warn, allowDevSeed: () => false, missingOriginWarning: 'missing!' })).toEqual({ kind: 'none' });
    expect(warn).toHaveBeenCalledWith('missing!');
  });
});
