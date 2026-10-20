import { describe, it, expect } from 'vitest';
import { blankCredentialDraft, buildCredentialPatch, validateCredentialDraft, credentialLabel, filterCredentials, filterOtherCredentials, writePermission, otherWritePermission, credentialStore, isRootKeyLocked, OTHER_STORES } from '../rules.js';
import { createMemorySecurityApi } from '../adapters/memory.js';
import type { CredentialProvider, CredentialSummary, OtherCredentialSummary, RootKeyState } from '../models.js';
it('preserves custom username tri-state and additional-host replacement without a secret retype', () => {
  const draft = { ...blankCredentialDraft({ kind: 'custom' }), id: 'one', label: 'Custom', baseUrl: 'https://api.example', additionalHosts: 'https://extra.example\nhttps://two.example', username: '' };
  expect(buildCredentialPatch({ draft, providers: [] })).toEqual({ label: 'Custom', category: 'general', baseUrl: 'https://api.example', additionalHosts: ['https://extra.example', 'https://two.example'], username: null });
  expect(validateCredentialDraft({ draft, rows: [], providers: [] })).toBeNull();
  expect(validateCredentialDraft({ draft: { ...draft, baseUrl: 'file:///tmp/a' }, rows: [], providers: [] })).toBe('Enter an HTTP or HTTPS URL');
});
it('requires descriptor extra fields only when replacing a secret', () => {
  const providers = [{ kind: 'publish' as const, id: 'cloud', label: 'Cloud', vendorLabel: 'Cloud', category: 'hosting' as const, tokenField: 'apiToken', fields: [{ name: 'account', label: 'Account', required: true }] }];
  const draft = { ...blankCredentialDraft({ kind: 'publish', providerId: 'cloud' }), id: 'one', label: 'Work' };
  expect(validateCredentialDraft({ draft, rows: [], providers })).toBeNull(); expect(buildCredentialPatch({ draft, providers })).toEqual({ label: 'Work' });
  expect(validateCredentialDraft({ draft: { ...draft, token: 'secret' }, rows: [], providers })).toBe('Complete all required fields');
  expect(buildCredentialPatch({ draft: { ...draft, token: 'secret', values: { account: ' acct ', extraneous: 'drop' } }, providers })).toEqual({ label: 'Work', connection: { providerId: 'cloud', apiToken: 'secret', account: 'acct' } });
});
it('keeps source and publish provider identities separate and computes legacy labels without migration', () => {
  const rows: CredentialSummary[] = ['publish', 'source-control'].map(kind => ({ kind: kind as 'publish' | 'source-control', id: kind, providerId: 'git', label: 'default', configured: true, isDefault: true, createdAt: 'd', updatedAt: 'd' }));
  const providers = [{ kind: 'publish' as const, id: 'git', label: 'Pages', vendorLabel: 'Git', category: 'hosting' as const, tokenField: 'token', fields: [] }];
  expect(credentialLabel({ row: rows[0]!, providers })).toBe('Pages token'); expect(rows[0]?.label).toBe('default');
  expect(filterCredentials({ rows, providers, query: '', category: 'hosting' }).map(r => r.id)).toEqual(['publish']);
  expect(writePermission({ kind: 'publish' })).toBe('system.publish'); expect(otherWritePermission({ store: 'media-provider' })).toBe('admin.integrations.manage');
});
describe('validateCredentialDraft boundaries', () => {
  const providers: CredentialProvider[] = [{ kind: 'publish', id: 'cloud', label: 'Cloud', vendorLabel: 'Cloud', category: 'hosting', tokenField: 'apiToken', fields: [{ name: 'apiToken', label: 'Token', required: true }, { name: 'account', label: 'Account', required: true }, { name: 'region', label: 'Region' }] }];
  const row = (over: Partial<CredentialSummary>): CredentialSummary => ({ kind: 'publish', id: 'saved', providerId: 'cloud', label: 'Work', configured: true, isDefault: true, createdAt: 'd', updatedAt: 'd', ...over });
  const publish = { ...blankCredentialDraft({ kind: 'publish', providerId: 'cloud' }), label: 'Home', token: 'tok', values: { account: 'acct' } };
  const custom = { ...blankCredentialDraft({ kind: 'custom' }), label: 'Api', token: 'tok', baseUrl: 'https://api.example' };
  it('refuses a blank or whitespace-only name', () => { expect(validateCredentialDraft({ draft: { ...publish, label: '  ' }, rows: [], providers })).toBe('Enter a name'); });
  it('checks the name before the token', () => { expect(validateCredentialDraft({ draft: { ...publish, label: '', token: '' }, rows: [], providers })).toBe('Enter a name'); });
  it('refuses a duplicate name under the same provider ignoring case and padding', () => { expect(validateCredentialDraft({ draft: { ...publish, label: ' work ' }, rows: [row({ label: 'Work' })], providers })).toBe('That name is already in use'); });
  it('allows the same name under a different provider', () => { expect(validateCredentialDraft({ draft: { ...publish, label: 'Work' }, rows: [row({ providerId: 'other' })], providers })).toBeNull(); });
  it('allows the same name under a different kind', () => { expect(validateCredentialDraft({ draft: { ...publish, label: 'Work' }, rows: [row({ kind: 'source-control' })], providers })).toBeNull(); });
  it('allows a row to keep its own name', () => { expect(validateCredentialDraft({ draft: { ...publish, id: 'saved', label: 'Work' }, rows: [row({})], providers })).toBeNull(); });
  it('refuses a duplicate custom name regardless of provider id', () => { expect(validateCredentialDraft({ draft: custom, rows: [row({ kind: 'custom', providerId: 'x', label: 'API' })], providers })).toBe('That name is already in use'); });
  it('checks duplicates before the token', () => { expect(validateCredentialDraft({ draft: { ...publish, label: 'Work', token: '' }, rows: [row({})], providers })).toBe('That name is already in use'); });
  it('refuses a new credential without a token', () => { expect(validateCredentialDraft({ draft: { ...publish, token: '   ' }, rows: [], providers })).toBe('Enter an access token'); });
  it('refuses a custom base URL that does not parse', () => { expect(validateCredentialDraft({ draft: { ...custom, baseUrl: 'not a url' }, rows: [], providers })).toBe('Enter an HTTP or HTTPS URL'); });
  it('accepts a custom http base URL', () => { expect(validateCredentialDraft({ draft: { ...custom, baseUrl: 'http://api.example' }, rows: [], providers })).toBeNull(); });
  it('does not look up a provider for a custom draft', () => { expect(validateCredentialDraft({ draft: custom, rows: [], providers: [] })).toBeNull(); });
  it('refuses a new credential whose provider is missing', () => { expect(validateCredentialDraft({ draft: { ...publish, providerId: 'gone' }, rows: [], providers })).toBe('Provider is unavailable'); });
  it('refuses a provider of the same id but a different kind', () => { expect(validateCredentialDraft({ draft: { ...publish, kind: 'source-control' }, rows: [], providers })).toBe('Provider is unavailable'); });
  it('skips provider checks for an edit that keeps its token', () => { expect(validateCredentialDraft({ draft: { ...publish, id: 'saved', token: '', providerId: 'gone' }, rows: [], providers })).toBeNull(); });
  it('checks the provider for an edit that replaces its token', () => { expect(validateCredentialDraft({ draft: { ...publish, id: 'saved', providerId: 'gone' }, rows: [], providers })).toBe('Provider is unavailable'); });
  it('refuses a whitespace-only required extra field', () => { expect(validateCredentialDraft({ draft: { ...publish, values: { account: '  ' } }, rows: [], providers })).toBe('Complete all required fields'); });
  it('does not require the token field among the extras or optional fields', () => { expect(validateCredentialDraft({ draft: publish, rows: [], providers })).toBeNull(); });
});
describe('buildCredentialPatch boundaries', () => {
  const providers: CredentialProvider[] = [{ kind: 'publish', id: 'cloud', label: 'Cloud', vendorLabel: 'Cloud', category: 'hosting', tokenField: 'apiToken', fields: [{ name: 'apiToken', label: 'Token' }, { name: 'account', label: 'Account' }, { name: 'region', label: 'Region' }] }];
  it('falls back to the token field name when the provider is missing', () => { expect(buildCredentialPatch({ draft: { ...blankCredentialDraft({ kind: 'source-control', providerId: 'git' }), label: ' Git ', token: ' tok ', values: { account: 'drop' } }, providers })).toEqual({ label: 'Git', connection: { providerId: 'git', token: 'tok' } }); });
  it('sends only non-blank extras and never re-sends the token field from values', () => { expect(buildCredentialPatch({ draft: { ...blankCredentialDraft({ kind: 'publish', providerId: 'cloud' }), label: 'W', token: 'tok', values: { apiToken: 'stale', account: ' a ', region: ' ' } }, providers })).toEqual({ label: 'W', connection: { providerId: 'cloud', apiToken: 'tok', account: 'a' } }); });
  it('sends a custom token with a trimmed username', () => { expect(buildCredentialPatch({ draft: { ...blankCredentialDraft({ kind: 'custom' }), label: 'C', token: 'tok', baseUrl: ' https://a ', additionalHosts: ' x ,\n\ny,', username: ' me ' }, providers: [] })).toEqual({ label: 'C', connection: { token: 'tok', username: 'me' }, category: 'general', baseUrl: 'https://a', additionalHosts: ['x', 'y'], username: 'me' }); });
  it('sends a custom token without a username when it is blank', () => { expect(buildCredentialPatch({ draft: { ...blankCredentialDraft({ kind: 'custom' }), label: 'C', token: 'tok', username: ' ' }, providers: [] })).toEqual({ label: 'C', connection: { token: 'tok' }, category: 'general', baseUrl: '', additionalHosts: [], username: null }); });
});
describe('kind default category', () => {
  it('defaults each kind to its category in a blank draft', () => { expect((['publish', 'source-control', 'custom'] as const).map(kind => blankCredentialDraft({ kind }).category)).toEqual(['hosting', 'source-control', 'general']); });
  it('filters rows by their stored category before their kind default', () => {
    const base = { providerId: 'p', label: 'L', configured: true, isDefault: false, createdAt: 'd', updatedAt: 'd' };
    const rows: CredentialSummary[] = [{ ...base, kind: 'custom', id: 'c', category: 'ai' }, { ...base, kind: 'custom', id: 'g' }, { ...base, kind: 'source-control', id: 's' }];
    expect(['ai', 'general', 'source-control'].map(category => filterCredentials({ rows, providers: [], query: '', category: category as 'ai' }).map(r => r.id))).toEqual([['c'], ['g'], ['s']]);
  });
});
describe('permission and store routing', () => {
  it('maps each credential kind to its write grant', () => { expect((['publish', 'source-control', 'custom'] as const).map(kind => writePermission({ kind }))).toEqual(['system.publish', 'source-control.credentials.write', 'custom-credentials.write']); });
  it('maps each other store to its write grant', () => { expect(OTHER_STORES.map(store => otherWritePermission({ store }))).toEqual(['admin.assistant.manage', 'admin.assistant.manage', 'admin.integrations.manage', 'admin.integrations.manage']); });
  it('routes each kind to its own store', () => {
    const api = createMemorySecurityApi({});
    expect((['publish', 'source-control', 'custom'] as const).map(kind => credentialStore({ api, kind }))).toEqual([api.publish, api.sourceControl, api.custom]);
  });
  it('labels a legacy default row by provider id when its provider is missing', () => { expect(credentialLabel({ row: { kind: 'publish', id: 'x', providerId: 'gone', label: 'default', configured: true, isDefault: true, createdAt: 'd', updatedAt: 'd' }, providers: [] })).toBe('gone token'); });
  it('keeps a custom row named default as is', () => { expect(credentialLabel({ row: { kind: 'custom', id: 'x', providerId: '', label: 'default', configured: true, isDefault: true, createdAt: 'd', updatedAt: 'd' }, providers: [] })).toBe('default'); });
  it('filters other rows by category and by label or store text', () => {
    const rows: OtherCredentialSummary[] = [{ store: 'media-provider', id: 'm', label: 'Media Key', category: 'media', configured: true, supportsReplace: true }, { store: 'site-assistant', id: 's', label: 'Assistant', category: 'ai', configured: true, supportsReplace: true }];
    expect(filterOtherCredentials({ rows, query: '', category: 'media' }).map(r => r.id)).toEqual(['m']);
    expect(filterOtherCredentials({ rows, query: ' SITE-ASS ', category: 'all' }).map(r => r.id)).toEqual(['s']);
  });
  it('treats only missing-with-data and mismatch as locked', () => {
    const states: RootKeyState[] = ['active', 'missing', 'missing-with-data', 'mismatch', 'invalid'];
    expect(states.map(state => isRootKeyLocked({ status: { active: false, source: 'none', state, keyFilePath: '/k', runtimeMode: 'local' } }))).toEqual([false, false, true, true, false]);
    expect(isRootKeyLocked({ status: null })).toBe(false);
  });
});
