import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_VISITOR_AUTH_PROVIDERS,
  createVisitorAuthProviderRegistry,
  GOOGLE_VISITOR_AUTH_PROVIDER,
  VisitorAuthRegistryError,
  type VisitorAuthProviderDefinition,
} from '../index.js';

describe('visitor-auth provider definitions', () => {
  it('describes the three currently exposed providers without claiming runtime support', () => {
    expect(
      BUILT_IN_VISITOR_AUTH_PROVIDERS.map((provider) => ({
        id: provider.id,
        protocol: provider.protocol,
        implementation: provider.implementation,
      })),
    ).toEqual([
      { id: 'google', protocol: 'oidc', implementation: 'metadata-only' },
      { id: 'facebook', protocol: 'oauth2', implementation: 'metadata-only' },
      { id: 'linkedin', protocol: 'oidc', implementation: 'metadata-only' },
    ]);
  });

  it('marks every client credential secret as secret metadata and carries no value', () => {
    for (const provider of BUILT_IN_VISITOR_AUTH_PROVIDERS) {
      const secretFields = provider.credentialSchema.filter((field) => field.kind === 'secret');
      expect(secretFields).toHaveLength(1);
      expect(secretFields[0]?.key.toLowerCase()).toContain('secret');
      for (const field of provider.credentialSchema) {
        expect(field).not.toHaveProperty('value');
        expect(field).not.toHaveProperty('defaultValue');
      }
    }
  });

  it('keeps versioned Facebook endpoints out of neutral metadata', () => {
    const facebook = BUILT_IN_VISITOR_AUTH_PROVIDERS.find(({ id }) => id === 'facebook');
    expect(facebook?.discoveryUrl).toBeUndefined();
    expect(facebook).not.toHaveProperty('authorizationEndpoint');
    expect(facebook).not.toHaveProperty('tokenEndpoint');
  });
});

describe('createVisitorAuthProviderRegistry', () => {
  it('preserves registration order and returns immutable defensive copies', () => {
    const source: VisitorAuthProviderDefinition = {
      id: 'custom',
      label: 'Custom',
      protocol: 'oauth2',
      credentialSchema: [
        { key: 'clientSecret', label: 'Client secret', kind: 'secret', required: true },
      ],
      defaultScopes: ['profile'],
      implementation: 'metadata-only',
    };
    const registry = createVisitorAuthProviderRegistry({
      seed: [source, ...BUILT_IN_VISITOR_AUTH_PROVIDERS],
    });

    expect(registry.list().map(({ id }) => id)).toEqual([
      'custom',
      'google',
      'facebook',
      'linkedin',
    ]);
    expect(registry.get('custom')).not.toBe(source);
    expect(Object.isFrozen(registry.get('custom'))).toBe(true);
    expect(Object.isFrozen(registry.get('custom')?.credentialSchema)).toBe(true);
  });

  it('rejects duplicate providers and malformed schema entries', () => {
    const registry = createVisitorAuthProviderRegistry({
      seed: [GOOGLE_VISITOR_AUTH_PROVIDER],
    });
    expect(() => registry.register(GOOGLE_VISITOR_AUTH_PROVIDER)).toThrowError(
      expect.objectContaining<Partial<VisitorAuthRegistryError>>({
        code: 'duplicate-provider',
      }),
    );

    expect(() =>
      registry.register({
        id: 'bad provider',
        label: 'Bad',
        protocol: 'oauth2',
        credentialSchema: [],
        defaultScopes: [],
        implementation: 'metadata-only',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<VisitorAuthRegistryError>>({
        code: 'invalid-provider',
      }),
    );
  });

  it('creates isolated registries rather than shared ambient state', () => {
    const first = createVisitorAuthProviderRegistry();
    const second = createVisitorAuthProviderRegistry();
    first.register(GOOGLE_VISITOR_AUTH_PROVIDER);
    expect(first.has('google')).toBe(true);
    expect(second.has('google')).toBe(false);
  });
});
