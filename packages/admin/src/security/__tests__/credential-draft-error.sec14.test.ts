import { describe, it, expect, vi } from 'vitest';
import { createMemorySecurityApi, createMemoryOtherCredentials } from '../adapters/memory.js';
import { createAccessTokensController } from '../controllers/access-tokens.controller.js';
import { createOtherCredentialsController } from '../controllers/other-credentials.controller.js';
import { credentialDraftError, type CredentialDraftError } from '../credential-failure.js';
import type { CredentialProvider, CredentialSummary, OtherCredentialSummary } from '../models.js';
const providers: CredentialProvider[] = [{ kind: 'source-control', id: 'git', label: 'Git host', vendorLabel: 'Git vendor', category: 'source-control', tokenField: 'token', fields: [] }];
const ACCESS = ['security.read', 'source-control.credentials.write', 'custom-credentials.write'];
const OTHER = ['security.read', 'admin.assistant.manage'];
/** Stand-in for the host validator's own input error: it names a rule, never the value. */
class FixtureInputError extends Error {}
const assertToken = ({ value }: { value: string }) => { if (value.trim() === '') throw new FixtureInputError('blank'); if (value.includes('!')) throw new FixtureInputError('ascii'); };
const describeInputError = ({ error }: { error: unknown }) => (error instanceof FixtureInputError ? `copy:${error.message}` : undefined);

describe('credentialDraftError reproduces Tovu credentialDraftError (SEC-14)', () => {
  it('an empty optional draft is not checked at all', () => {
    const check = vi.fn(assertToken);
    expect(credentialDraftError({ value: '', assertToken: check, describeInputError })).toBeNull(); expect(check).not.toHaveBeenCalled();
  });
  it('an empty required draft is checked and refused with the validator copy', () => {
    expect(credentialDraftError({ value: '', assertToken, describeInputError }, { required: true })).toBe('copy:blank');
  });
  it('a valid token gives null; a rule break gives the described copy', () => {
    expect(credentialDraftError({ value: 'fixture-token', assertToken, describeInputError })).toBeNull();
    expect(credentialDraftError({ value: 'fixture!token', assertToken, describeInputError })).toBe('copy:ascii');
  });
  it('any other failure is rethrown, so an unknown exception never gains display permission', () => {
    const boom = new Error('fixture-internal');
    expect(() => credentialDraftError({ value: 'x', assertToken: () => { throw boom; }, describeInputError })).toThrow(boom);
  });
});

describe('controllers run the host draftError before any write (SEC-14)', () => {
  const draftError: CredentialDraftError = ({ value }, { required = false } = {}) => credentialDraftError({ value, assertToken, describeInputError }, { required });
  it('access tokens: a refused create sends nothing and shows the copy; a create is required, an edit is not', async () => {
    const saved: CredentialSummary = { kind: 'source-control', id: 'r1', providerId: 'git', label: 'Old', configured: true, isDefault: true, createdAt: 'c', updatedAt: 'u' };
    const api = createMemorySecurityApi({ providers, rows: [saved] }); const create = vi.spyOn(api.sourceControl, 'create'); const seen = vi.fn(draftError);
    const c = createAccessTokensController({ api, permissions: ACCESS }, { draftError: seen }); await c.load({});
    c.begin({ kind: 'source-control', providerId: 'git' }); c.setDraft({ patch: { label: 'Mine', token: 'fixture!token-789' } });
    expect(await c.save({})).toBe(false); expect(create).not.toHaveBeenCalled(); expect(c.getSnapshot().error).toBe('copy:ascii');
    expect(seen).toHaveBeenLastCalledWith({ value: 'fixture!token-789' }, { required: true });
    c.cancel({}); c.begin({ row: c.getSnapshot().rows[0]! }); c.setDraft({ patch: { label: 'Renamed' } }); expect(await c.save({})).toBe(true);
    expect(seen).toHaveBeenLastCalledWith({ value: '' }, { required: false });
  });
  it('access tokens: a host check that echoes the draft cannot put the secret in the snapshot', async () => {
    const c = createAccessTokensController({ api: createMemorySecurityApi({ providers }), permissions: ACCESS }, { draftError: ({ value }) => `bad ${value}` }); await c.load({});
    c.begin({ kind: 'source-control', providerId: 'git' }); c.setDraft({ patch: { label: 'Mine', token: 'fixture-token-456' } }); expect(await c.save({})).toBe(false);
    expect(c.getSnapshot().error).toBe('bad [redacted]'); expect(JSON.stringify({ ...c.getSnapshot(), draft: null })).not.toContain('fixture-token-456');
  });
  it('other stores: a refused replace sends nothing and the row error is the redacted copy', async () => {
    const row: OtherCredentialSummary = { store: 'site-assistant', id: 'site-assistant', label: 'Assistant', category: 'ai', configured: true, supportsReplace: true };
    const api = createMemoryOtherCredentials({ rows: [row] }); const replace = vi.spyOn(api, 'replace');
    const c = createOtherCredentialsController({ api, permissions: OTHER }, { draftError: ({ value }) => (value.includes('!') ? `copy for ${value}` : null) }); await c.load({});
    c.setDraft({ key: 'site-assistant:site-assistant', token: ' fixture!token-123 ' }); expect(await c.replace({ row })).toBe(false);
    expect(replace).not.toHaveBeenCalled(); expect(c.getSnapshot().rowErrors['site-assistant:site-assistant']).toBe('copy for [redacted]');
    c.setDraft({ key: 'site-assistant:site-assistant', token: 'fixture-token-123' }); expect(await c.replace({ row })).toBe(true); expect(replace).toHaveBeenCalledTimes(1);
  });
});
