import { describe, expect, it, vi } from 'vitest';
import { credentialFailureText } from '../credential-failure.js';
import { englishSecurity } from '../messages.en.js';
import { buildCredentialPatch, formatTokenHint, providerMatchesQuery, sharedKeyRotationWarning } from '../rules.js';
import type { CredentialCategory, CredentialDraft } from '../models.js';

describe('credentialFailureText (SEC-14)', () => {
  it('shows the fixed fallback when the host describer itself throws, never the raw error', () => {
    const describeError = vi.fn(() => { throw new Error('describer broke on tok-a'); });
    const text = credentialFailureText({ error: new Error('server said tok-a'), fallback: 'Saving failed.', secrets: ['tok-a'] }, { describeError });
    expect(text).toBe('Saving failed.');
    expect(describeError).toHaveBeenCalledOnce();
  });
});

describe('englishSecurity (default copy)', () => {
  it('keeps a placeholder visible when its variable was not supplied, filling the ones that were', () => {
    expect(englishSecurity('sharedKeysMore', { site: 'Blog' })).toBe('Blog: {count} more not shown');
    expect(englishSecurity('sharedKeysMore', { site: 'Blog', count: 0 })).toBe('Blog: 0 more not shown');
  });
});

describe('formatTokenHint (SEC-9)', () => {
  it('separates a tail that starts with a literal dot from the ellipsis, without changing the tail', () => {
    expect(formatTokenHint({ hint: { length: 12, last4: '.x9z' } })).toBe('… .x9z, 12 chars');
    expect(formatTokenHint({ hint: { length: 12, last4: 'x.9z' } })).toBe('…x.9z, 12 chars');
  });
});

describe('sharedKeyRotationWarning (SEC-12)', () => {
  it('stays silent for a project key whose users are unknown', () => {
    expect(sharedKeyRotationWarning({ row: { scope: 'project', usedByThisSite: false } })).toBeNull();
    expect(sharedKeyRotationWarning({ row: { scope: 'project', usedByThisSite: true } })).toBeNull();
  });
});

describe('providerMatchesQuery (SEC-9 search)', () => {
  it('searches a category id this client has no label for by the id itself', () => {
    // The server owns the category list; one newer than this client still has to be findable.
    const provider = { label: 'Ledger', category: 'billing' as CredentialCategory };
    expect(providerMatchesQuery({ provider, query: 'billing' })).toBe(true);
    expect(providerMatchesQuery({ provider, query: 'hosting' })).toBe(false);
    expect(providerMatchesQuery({ provider: { label: 'Ledger', category: 'ops' }, query: 'Ops' })).toBe(true);
  });
});

describe('buildCredentialPatch for a saved custom key with no stored category or base URL', () => {
  const draft: CredentialDraft = { kind: 'custom', id: 'c1', providerId: '', label: 'Metrics', token: '', values: {}, category: 'general', baseUrl: '', additionalHosts: '', username: '' };
  it('treats the missing facts as "general" and an empty base URL, so an untouched edit sends nothing', () => {
    expect(buildCredentialPatch({ draft, providers: [] }, { saved: { label: 'Metrics' } })).toEqual({});
  });
  it('sends a category or base URL the owner actually set', () => {
    expect(buildCredentialPatch({ draft: { ...draft, category: 'ops', baseUrl: ' https://m.example ' }, providers: [] }, { saved: { label: 'Metrics' } }))
      .toEqual({ category: 'ops', baseUrl: 'https://m.example' });
  });
});
