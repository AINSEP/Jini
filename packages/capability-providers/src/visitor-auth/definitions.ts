/**
 * Provider-neutral metadata for public-site visitor sign-in.
 *
 * These definitions describe configuration, not executable adapters. In
 * particular, their presence does not mean that token exchange, ID-token
 * verification, account linking, or session minting has been wired by a host.
 */

export type VisitorAuthProtocol = 'oauth2' | 'oidc';

export type VisitorAuthCredentialFieldKind = 'public' | 'secret';

export interface VisitorAuthCredentialFieldDefinition {
  readonly key: string;
  readonly label: string;
  readonly kind: VisitorAuthCredentialFieldKind;
  readonly required: boolean;
}

export interface VisitorAuthProviderDefinition {
  /** Stable, open identifier. Third-party packages may register additional providers. */
  readonly id: string;
  readonly label: string;
  readonly protocol: VisitorAuthProtocol;
  readonly credentialSchema: readonly VisitorAuthCredentialFieldDefinition[];
  readonly defaultScopes: readonly string[];
  /** Standard discovery document when the provider publishes one. */
  readonly discoveryUrl?: string;
  /** Makes the current support boundary machine-readable and hard to overstate in a UI. */
  readonly implementation: 'metadata-only';
}

function freezeProviderDefinition(
  definition: VisitorAuthProviderDefinition,
): VisitorAuthProviderDefinition {
  return Object.freeze({
    ...definition,
    credentialSchema: Object.freeze(
      definition.credentialSchema.map((field) => Object.freeze({ ...field })),
    ),
    defaultScopes: Object.freeze([...definition.defaultScopes]),
  });
}

export const GOOGLE_VISITOR_AUTH_PROVIDER = freezeProviderDefinition({
  id: 'google',
  label: 'Google',
  protocol: 'oidc',
  credentialSchema: [
    { key: 'clientId', label: 'Client ID', kind: 'public', required: true },
    { key: 'clientSecret', label: 'Client secret', kind: 'secret', required: true },
  ],
  defaultScopes: ['openid', 'profile', 'email'],
  discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
  implementation: 'metadata-only',
});

export const FACEBOOK_VISITOR_AUTH_PROVIDER = freezeProviderDefinition({
  id: 'facebook',
  label: 'Facebook',
  protocol: 'oauth2',
  credentialSchema: [
    { key: 'appId', label: 'App ID', kind: 'public', required: true },
    { key: 'appSecret', label: 'App secret', kind: 'secret', required: true },
  ],
  defaultScopes: ['public_profile', 'email'],
  // Facebook's endpoints are versioned. A concrete adapter must resolve and
  // pin the supported Graph API version rather than this catalogue guessing it.
  implementation: 'metadata-only',
});

export const LINKEDIN_VISITOR_AUTH_PROVIDER = freezeProviderDefinition({
  id: 'linkedin',
  label: 'LinkedIn',
  protocol: 'oidc',
  credentialSchema: [
    { key: 'clientId', label: 'Client ID', kind: 'public', required: true },
    { key: 'clientSecret', label: 'Client secret', kind: 'secret', required: true },
  ],
  defaultScopes: ['openid', 'profile', 'email'],
  discoveryUrl: 'https://www.linkedin.com/oauth/.well-known/openid-configuration',
  implementation: 'metadata-only',
});

export const BUILT_IN_VISITOR_AUTH_PROVIDERS: readonly VisitorAuthProviderDefinition[] =
  Object.freeze([
    GOOGLE_VISITOR_AUTH_PROVIDER,
    FACEBOOK_VISITOR_AUTH_PROVIDER,
    LINKEDIN_VISITOR_AUTH_PROVIDER,
  ]);
