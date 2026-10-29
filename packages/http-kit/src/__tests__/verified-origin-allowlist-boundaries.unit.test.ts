import { expect, it } from 'vitest';
import { InMemoryOriginSettingRepo, OriginRegistry, normalizeOriginCandidate } from '../verified-origin.js';

it.each([
  ['good.example/path', 'good.example'], ['good.example?query', 'good.example'],
  ['good.example#fragment', 'good.example'], ['user@good.example', 'good.example'],
  ['good%2eexample', 'good.example'], ['good.example:443', 'good.example'], ['[::1]:443', '[::1]'], ['', 'good.example'],
])('does not treat URL syntax %j as an allowlisted host', (host, candidate) => {
  const repo = new InMemoryOriginSettingRepo({ seeds: [{ workspaceId: 'w',
    origin: { scheme: 'https', host: 'site.example', source: 'workspace-setting', verifiedAt: '2026-10-29T00:00:00Z' },
    redirectAllowlist: [host], egressAllowlist: [host] }] });
  const registry = new OriginRegistry({ repo });
  return Promise.all([
    expect(registry.isAllowedRedirectTarget({ context: { workspaceId: 'w' }, url: `https://${candidate}/file` })).resolves.toBe(false),
    expect(registry.isAllowedEgressTarget({ context: { workspaceId: 'w' }, url: `https://${candidate}/file` })).resolves.toBe(false),
  ]);
});

it('normalizes a bare IPv6 allowlist entry without accepting a different IPv6 host', async () => {
  const registry = new OriginRegistry({ repo: new InMemoryOriginSettingRepo({ seeds: [{ workspaceId: 'w',
    origin: { scheme: 'https', host: 'site.example', source: 'workspace-setting', verifiedAt: '2026-10-29T00:00:00Z' },
    redirectAllowlist: ['[2001:db8::1]'] }] }) });
  expect(await registry.isAllowedRedirectTarget({ context: { workspaceId: 'w' }, url: 'https://[2001:db8::1]/file' })).toBe(true);
  expect(await registry.isAllowedRedirectTarget({ context: { workspaceId: 'w' }, url: 'https://[2001:db8::2]/file' })).toBe(false);
});

it('fails closed on a non-string candidate received at a runtime boundary', () => {
  expect(normalizeOriginCandidate({ rawUrl: null as unknown as string })).toBeNull();
});
