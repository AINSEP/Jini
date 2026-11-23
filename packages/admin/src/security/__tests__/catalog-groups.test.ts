import { describe, it, expect } from 'vitest';
import { providersWithSavedRows, sortCredentialGroups, legacyCredentialLabel, credentialLabel, rowMatchesQuery, providerMatchesQuery, credentialCountText } from '../rules.js';
import { createHttpSecurityApi } from '../adapters/http.js';
import { createMemorySecurityApi } from '../adapters/memory.js';
import { createAccessTokensController } from '../controllers/access-tokens.controller.js';
import type { SecurityTransportPort } from '../ports.js';
import type { CredentialProvider, CredentialSummary } from '../models.js';

const cdn: CredentialProvider = { kind: 'publish', id: 'cdn', label: 'CDN', vendorLabel: 'CDN vendor', category: 'hosting', tokenField: 'token', fields: [] };
const git: CredentialProvider = { kind: 'source-control', id: 'git', label: 'Git host', vendorLabel: 'Git vendor', category: 'source-control', tokenField: 'token', fields: [] };
const row = (over: Partial<CredentialSummary>): CredentialSummary => ({ kind: 'publish', id: 'r', providerId: 'cdn', label: 'Production', configured: true, isDefault: true, createdAt: 'c', updatedAt: 'u', ...over });

describe('providersWithSavedRows (P29)', () => {
  it('adds a bare unlisted entry for each saved provider row whose provider vanished, never for custom rows', () => {
    const rows = [row({ id: '1' }), row({ id: '2', providerId: 'gone' }), row({ id: '3', kind: 'source-control', providerId: 'old-git' }), row({ id: '4', kind: 'custom', providerId: '' }), row({ id: '5', providerId: 'gone' })];
    expect(providersWithSavedRows({ providers: [cdn], rows })).toEqual([cdn,
      { kind: 'publish', id: 'gone', label: 'gone', vendorLabel: 'gone', category: 'hosting', tokenField: 'token', fields: [], unlisted: true },
      { kind: 'source-control', id: 'old-git', label: 'old-git', vendorLabel: 'old-git', category: 'source-control', tokenField: 'token', fields: [], unlisted: true }]);
  });
});

describe('sortCredentialGroups (P30)', () => {
  it('puts saved groups first, then category rank, then label case-insensitively, without mutating input', () => {
    const groups = [{ provider: { category: 'hosting' as const, label: 'b host' }, rows: [] }, { provider: { category: 'general' as const, label: 'Custom' }, rows: [1] },
      { provider: { category: 'hosting' as const, label: 'A host' }, rows: [1] }, { provider: { category: 'source-control' as const, label: 'Git' }, rows: [] }, { provider: { category: 'hosting' as const, label: 'a2' }, rows: [] }];
    const before = groups.map(g => g.provider.label);
    expect(sortCredentialGroups({ groups }).map(g => g.provider.label)).toEqual(['A host', 'Custom', 'Git', 'a2', 'b host']);
    expect(groups.map(g => g.provider.label)).toEqual(before);
  });
});

describe('numbered legacy labels (P32)', () => {
  it('numbers each legacy sentinel row per provider and leaves custom rows alone', () => {
    expect(legacyCredentialLabel({ providerLabel: 'CDN', index: 0 })).toBe('CDN token');
    expect(legacyCredentialLabel({ providerLabel: 'CDN', index: 2 })).toBe('CDN token 3');
    const rows = [row({ id: 'a', label: 'default' }), row({ id: 'x', label: 'default', kind: 'source-control', providerId: 'git' }), row({ id: 'b', label: 'default' }), row({ id: 'c', kind: 'custom', label: 'default' })];
    expect(rows.map(r => credentialLabel({ row: r, providers: [cdn, git] }, { rows }))).toEqual(['CDN token', 'Git host token', 'CDN token 2', 'default']);
    expect(credentialLabel({ row: rows[2]!, providers: [cdn] })).toBe('CDN token');
  });
});

describe('search and count copy (P31)', () => {
  it('matches provider label, purpose and row name; an empty query matches everything', () => {
    const r = row({ label: '30-day test' });
    expect(['cdn', 'HOSTING', '30-day', '  '].map(query => rowMatchesQuery({ row: r, provider: cdn, query }))).toEqual([true, true, true, true]);
    expect(rowMatchesQuery({ row: r, provider: cdn, query: 'git' })).toBe(false);
    expect(['Git', 'source control', 'nope'].map(query => providerMatchesQuery({ provider: git, query }))).toEqual([true, true, false]);
  });
  it('writes a whole sentence whose noun follows the total', () => {
    expect(credentialCountText({ total: 1, matched: 1, query: '' })).toBe('1 token saved');
    expect(credentialCountText({ total: 3, matched: 3, query: ' ' })).toBe('3 tokens saved');
    expect(credentialCountText({ total: 3, matched: 1, query: 'cd$&' })).toBe('1 of 3 tokens matching “cd$&”');
    expect(credentialCountText({ total: 1, matched: 0, query: 'x' }, { t: key => key.replace('token', 'TOKEN') })).toBe('0 of 1 TOKEN matching “x”');
  });
});

describe('independent catalogs (P28)', () => {
  function transport(replies: Record<string, unknown>) {
    const calls: string[] = [];
    const port: SecurityTransportPort = { async request<T>({ path }: { path: string }): Promise<T> { calls.push(path); return replies[path] as T; } };
    return { port, calls };
  }
  it('serves each kind from its own endpoint; no kind still returns both', async () => {
    const t = transport({ '/w/system/publish-targets': { targets: [{ id: 'cdn', label: 'CDN', credential: { tokenField: 'token' } }] }, '/w/system/source-control/providers': { providers: [{ id: 'git', label: 'Git' }] } });
    const api = createHttpSecurityApi({ transport: t.port, workspacePath: '/w' });
    expect((await api.providers({ kind: 'publish' })).map(p => p.id)).toEqual(['cdn']); expect(t.calls).toEqual(['/w/system/publish-targets']);
    expect((await api.providers({ kind: 'source-control' })).map(p => p.id)).toEqual(['git']); expect(t.calls[1]).toBe('/w/system/source-control/providers');
    expect((await api.providers({})).map(p => p.id)).toEqual(['cdn', 'git']);
    expect((await createMemorySecurityApi({ providers: [cdn, git] }).providers({ kind: 'source-control' })).map(p => p.id)).toEqual(['git']);
  });
  it('one failed catalog leaves the other shown', async () => {
    const api = createMemorySecurityApi({ providers: [cdn, git] }); const real = api.providers; const kinds: unknown[] = [];
    api.providers = (required, optional) => { kinds.push(required.kind); return required.kind === 'publish' ? Promise.reject(new Error('down')) : real(required, optional); };
    const c = createAccessTokensController({ api, permissions: ['security.read'] }); await c.load({});
    expect(kinds.sort()).toEqual(['publish', 'source-control']);
    expect(c.getSnapshot().providers).toEqual([git]); expect(c.getSnapshot().error).toBe('Provider catalog unavailable');
  });
});
