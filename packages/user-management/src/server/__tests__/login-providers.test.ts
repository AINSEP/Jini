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
