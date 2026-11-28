import { describe, expect, it } from 'vitest';
import { MemberLoginError, parseLoginProviders } from '../index.js';

const provider = {
  id: 'example', label: 'Example', issuer: 'https://id.example.com', authorizationEndpoint: 'https://id.example.com/authorize',
  tokenEndpoint: 'https://id.example.com/token', jwksUri: 'https://id.example.com/jwks', scopes: ['openid', 'email', 'profile'],
  signingAlgorithm: 'RS256', clientAuthentication: 'client_secret_post', pkce: 'S256', credentialLabel: 'Example login',
  credentialCardTarget: 'example-login', authoritativeEmailDomains: ['example.com'],
};
const file = (value: unknown) => JSON.stringify({ schemaVersion: 1, providers: [value] });

describe('parseLoginProviders', () => {
  it('accepts a v1 preset and keeps the declared fields', () => {
    const parsed = parseLoginProviders({ raw: file(provider) });
    expect(parsed).toEqual({ ok: true, descriptors: [provider] });
  });

  it.each([
    ['plain pkce', { pkce: 'plain' }], ['symmetric signing', { signingAlgorithm: 'HS256' }],
    ['public client', { clientAuthentication: 'none' }], ['extra scope', { scopes: ['openid', 'email', 'offline_access'] }],
    ['http issuer', { issuer: 'http://id.example.com' }], ['bad id', { id: 'Example' }], ['bad domain', { authoritativeEmailDomains: ['nope'] }],
  ])('refuses %s with the fixed code only', (_name, change) => {
    expect(parseLoginProviders({ raw: file({ ...provider, ...change }) })).toEqual({ ok: false, reason: 'LOGIN_PROVIDER_INVALID' });
  });

  it.each([
    ['non-object entry', 'example'], ['null entry', null], ['array entry', [provider]],
  ])('refuses a %s in the providers list', (_name, entry) => {
    expect(parseLoginProviders({ raw: file(entry) })).toEqual({ ok: false, reason: 'LOGIN_PROVIDER_INVALID' });
  });

  it.each([
    ['blank label', { label: '  ' }], ['non-string label', { label: 7 }], ['oversized label', { label: 'x'.repeat(2049) }],
    ['issuer with user info', { issuer: 'https://user@id.example.com' }], ['issuer with a password', { issuer: 'https://u:p@id.example.com' }],
    ['issuer with a fragment', { issuer: 'https://id.example.com/#frag' }], ['too many domains', { authoritativeEmailDomains: Array(17).fill('example.com') }],
    ['non-array domains', { authoritativeEmailDomains: 'example.com' }], ['non-string domain', { authoritativeEmailDomains: [7] }],
    ['bad hosted-domain claim', { hostedDomainClaim: 'Hd-Claim' }], ['non-string hosted-domain claim', { hostedDomainClaim: 3 }],
    ['non-array scopes', { scopes: 'openid email profile' }], ['two scopes', { scopes: ['openid', 'email'] }],
    ['duplicated scope', { scopes: ['openid', 'email', 'email'] }], ['unknown third scope', { scopes: ['openid', 'email', 'phone'] }],
  ])('refuses %s with the fixed code only', (_name, change) => {
    expect(parseLoginProviders({ raw: file({ ...provider, ...change }) })).toEqual({ ok: false, reason: 'LOGIN_PROVIDER_INVALID' });
  });

  it('defaults absent email authority to no domains and keeps a valid hosted-domain claim', () => {
    const { authoritativeEmailDomains: _omitted, ...withoutDomains } = provider;
    expect(parseLoginProviders({ raw: file({ ...withoutDomains, hostedDomainClaim: 'hd' }) }))
      .toEqual({ ok: true, descriptors: [{ ...withoutDomains, authoritativeEmailDomains: [], hostedDomainClaim: 'hd' }] });
  });

  it('refuses oversized, malformed and wrong-version files', () => {
    expect(parseLoginProviders({ raw: ' '.repeat(32769) }).ok).toBe(false);
    expect(parseLoginProviders({ raw: '{' }).ok).toBe(false);
    expect(parseLoginProviders({ raw: JSON.stringify({ schemaVersion: 2, providers: [provider] }) }).ok).toBe(false);
    expect(parseLoginProviders({ raw: JSON.stringify({ schemaVersion: 1, providers: Array(9).fill(provider) }) }).ok).toBe(false);
  });

  it('exposes a fixed-code error class', () => {
    const error = new MemberLoginError({ code: 'LOGIN_BLOCKED' });
    expect([error.name, error.code, error.message]).toEqual(['MemberLoginError', 'LOGIN_BLOCKED', 'LOGIN_BLOCKED']);
  });
});
