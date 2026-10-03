import { OAuthError } from './errors.js';
import type { OAuthEmptyArgs } from './args.js';

/** A host chooses its metadata trust policy separately from its outbound URL policy. */
export interface OAuthDiscoveryPolicy {
  assertMetadata(requiredArgs: { issuer: string; document: Readonly<Record<string, unknown>> }): void;
}

/** Preserve exact issuer equality and HTTPS endpoint-origin consistency. */
// A hostile discovery document must not send registration/token credentials to an unrelated
// origin. URL safety alone cannot establish issuer binding; hosts select this metadata policy
// separately. Discovery enables this binding by default; a host opting out must explicitly
// select metadataPolicy: "none".
export function createIssuerBoundDiscoveryPolicy(_requiredArgs: OAuthEmptyArgs): OAuthDiscoveryPolicy {
  return {
    assertMetadata({ issuer, document }) {
      const reject = (message: string): never => {
        throw new OAuthError({
          code: 'OAUTH_UNSAFE_ENDPOINT', message,
          operatorAction: 'Check the authorization server issuer and discovery endpoints before connecting.',
        });
      };
      // RFC 8414 section 3.3: a mismatched issuer was previously silently adopted. When this
      // policy runs (by default), reject the substitution instead of trusting a different server's metadata.
      if (document.issuer !== undefined && document.issuer !== issuer)
        reject('OAuth metadata issuer does not equal the requested issuer');
      const origin = new URL(issuer).origin;
      for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'device_authorization_endpoint']) {
        const endpoint = document[key];
        if (endpoint === undefined || endpoint === null) continue;
        if (typeof endpoint !== 'string') reject(`OAuth metadata ${key} is not an absolute HTTPS URL`);
        let url: URL;
        try { url = new URL(endpoint as string); }
        catch { return reject(`OAuth metadata ${key} is not an absolute HTTPS URL`); }
        if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password)
          reject(`OAuth metadata ${key} does not share the issuer's HTTPS origin`);
      }
    },
  };
}
