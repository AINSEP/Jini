import { describe, expect, it } from 'vitest';

import { BUILT_IN_VISITOR_AUTH_PROVIDERS, FACEBOOK_VISITOR_AUTH_PROVIDER, GOOGLE_VISITOR_AUTH_PROVIDER, LINKEDIN_VISITOR_AUTH_PROVIDER } from '../definitions.js';

/** Inline contract for the built-in provider definitions (Stryker L6: `required: true → false`
 * and `defaultScopes → []` survived). Dropping `required` on a client secret would let a tenant
 * save a half-configured provider; changing scopes changes what visitors are asked to share. */

const SECRET_PAIR = (publicKey: string, publicLabel: string, secretKey: string, secretLabel: string) => [
  { key: publicKey, label: publicLabel, kind: 'public', required: true },
  { key: secretKey, label: secretLabel, kind: 'secret', required: true },
];

describe('built-in visitor-auth provider definitions', () => {
  it('Google', () => {
    expect(GOOGLE_VISITOR_AUTH_PROVIDER).toEqual({
      id: 'google', label: 'Google', protocol: 'oidc',
      credentialSchema: SECRET_PAIR('clientId', 'Client ID', 'clientSecret', 'Client secret'),
      defaultScopes: ['openid', 'profile', 'email'],
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      implementation: 'metadata-only',
    });
  });

  it('Facebook (OAuth2, no discovery URL)', () => {
    expect(FACEBOOK_VISITOR_AUTH_PROVIDER).toEqual({
      id: 'facebook', label: 'Facebook', protocol: 'oauth2',
      credentialSchema: SECRET_PAIR('appId', 'App ID', 'appSecret', 'App secret'),
      defaultScopes: ['public_profile', 'email'],
      implementation: 'metadata-only',
    });
    expect(FACEBOOK_VISITOR_AUTH_PROVIDER).not.toHaveProperty('discoveryUrl');
  });

  it('LinkedIn', () => {
    expect(LINKEDIN_VISITOR_AUTH_PROVIDER).toEqual({
      id: 'linkedin', label: 'LinkedIn', protocol: 'oidc',
      credentialSchema: SECRET_PAIR('clientId', 'Client ID', 'clientSecret', 'Client secret'),
      defaultScopes: ['openid', 'profile', 'email'],
      discoveryUrl: 'https://www.linkedin.com/oauth/.well-known/openid-configuration',
      implementation: 'metadata-only',
    });
  });

  it('the built-in list is exactly these three, in order, and every definition is deeply frozen', () => {
    expect(BUILT_IN_VISITOR_AUTH_PROVIDERS).toEqual([GOOGLE_VISITOR_AUTH_PROVIDER, FACEBOOK_VISITOR_AUTH_PROVIDER, LINKEDIN_VISITOR_AUTH_PROVIDER]);
    for (const definition of BUILT_IN_VISITOR_AUTH_PROVIDERS) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.defaultScopes)).toBe(true);
      expect(Object.isFrozen(definition.credentialSchema)).toBe(true);
      for (const field of definition.credentialSchema) expect(Object.isFrozen(field)).toBe(true);
    }
  });
});
