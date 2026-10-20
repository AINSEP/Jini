import { describe, expect, it } from 'vitest';
import { createIssuerBoundDiscoveryPolicy } from '../../src/discovery-policy.js';

const issuer = 'https://auth.example/tenant';
const keys = ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'device_authorization_endpoint'];

describe('issuer-bound metadata characterization', () => {
  it('accepts missing issuer and absent or null endpoints', () => {
    const policy = createIssuerBoundDiscoveryPolicy({});
    expect(policy.assertMetadata({ issuer, document: {} })).toBeUndefined();
    expect(policy.assertMetadata({ issuer, document: Object.fromEntries(keys.map(key => [key, null])) })).toBeUndefined();
    expect(policy.assertMetadata({ issuer, document: { issuer, authorization_endpoint: undefined,
      token_endpoint: 'https://AUTH.example:443/token' } })).toBeUndefined();
  });

  it.each(['https://auth.example/tenant/', 'https://other.example/tenant', null, 7])
    ('rejects issuer substitution by exact equality: %s', advertised => {
      expect(() => createIssuerBoundDiscoveryPolicy({}).assertMetadata({ issuer, document: { issuer: advertised } }))
        .toThrow(expect.objectContaining({ code: 'OAUTH_UNSAFE_ENDPOINT', message: 'OAuth metadata issuer does not equal the requested issuer' }));
    });

  it.each(keys)('checks the HTTPS origin of %s and allows different endpoint paths', key => {
    const policy = createIssuerBoundDiscoveryPolicy({});
    expect(policy.assertMetadata({ issuer, document: { [key]: 'https://auth.example/other/path?query=1' } })).toBeUndefined();
    for (const endpoint of ['http://auth.example/token', 'https://other.example/token', 'https://auth.example:444/token',
      'https://user@auth.example/token', 'https://:secret@auth.example/token']) {
      expect(() => policy.assertMetadata({ issuer, document: { [key]: endpoint } }))
        .toThrow(expect.objectContaining({ code: 'OAUTH_UNSAFE_ENDPOINT',
          message: `OAuth metadata ${key} does not share the issuer's HTTPS origin`,
          operatorAction: 'Check the authorization server issuer and discovery endpoints before connecting.' }));
    }
  });

  it.each(keys)('refuses malformed and non-string values of %s', key => {
    const policy = createIssuerBoundDiscoveryPolicy({});
    for (const endpoint of ['', '/relative', 'https://[invalid', 3, false, {}, []]) {
      expect(() => policy.assertMetadata({ issuer, document: { [key]: endpoint } }))
        .toThrow(expect.objectContaining({ code: 'OAUTH_UNSAFE_ENDPOINT', message: `OAuth metadata ${key} is not an absolute HTTPS URL` }));
    }
  });

  it('preserves native URL errors for an invalid requested issuer', () => {
    expect(() => createIssuerBoundDiscoveryPolicy({}).assertMetadata({ issuer: '/relative', document: {} })).toThrow(TypeError);
  });
});
