import { it, expect } from 'vitest';
import { blankCredentialDraft, buildCredentialPatch, validateCredentialDraft, credentialLabel, filterCredentials, writePermission, otherWritePermission } from '../rules.js';
import type { CredentialSummary } from '../models.js';
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
