import { OAuthError } from './errors.js';
import type { OAuthEmptyArgs } from './args.js';

/** A host chooses its metadata trust policy separately from its outbound URL policy. */
export interface OAuthDiscoveryPolicy {
  assertMetadata(requiredArgs: { issuer: string; document: Readonly<Record<string, unknown>> }): void;
}

function rejectMetadata({ message }: { message: string }, _optionalArgs: OAuthEmptyArgs = {}): never {
  throw new OAuthError({
    code: 'OAUTH_UNSAFE_ENDPOINT', message,
    operatorAction: 'Check the authorization server issuer and discovery endpoints before connecting.',
  });
}

function assertMetadataEndpoint({ endpoint, key, origin }: {
  endpoint: unknown; key: string; origin: string;
}, _optionalArgs: OAuthEmptyArgs = {}): void {
  if (endpoint === undefined || endpoint === null) return;
  if (typeof endpoint !== 'string') rejectMetadata({ message: `OAuth metadata ${key} is not an absolute HTTPS URL` });
  let url: URL;
  try { url = new URL(endpoint); }
  catch { return rejectMetadata({ message: `OAuth metadata ${key} is not an absolute HTTPS URL` }); }
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password)
    rejectMetadata({ message: `OAuth metadata ${key} does not share the issuer's HTTPS origin` });
}

/** Preserve exact issuer equality and HTTPS endpoint-origin consistency. */
// A hostile discovery document must not send registration/token credentials to an unrelated
// origin. URL safety alone cannot establish issuer binding; hosts select this metadata policy
// separately. Discovery enables this binding by default; a host opting out must explicitly
// select metadataPolicy: "none".
// openid-client's direct-document discovery does not compare issuers. Keep that comparison here
// against the original document: URL canonicalization would weaken this policy's exact equality,
// and a compatibility fallback for an omitted issuer must never hide a supplied hostile value.
export function createIssuerBoundDiscoveryPolicy(_requiredArgs: OAuthEmptyArgs): OAuthDiscoveryPolicy {
  return {
    assertMetadata({ issuer, document }) {
      // RFC 8414 section 3.3: a mismatched issuer was previously silently adopted. When this
      // policy runs (by default), reject the substitution instead of trusting a different server's metadata.
      if (document.issuer !== undefined && document.issuer !== issuer)
        rejectMetadata({ message: 'OAuth metadata issuer does not equal the requested issuer' });
      const origin = new URL(issuer).origin;
      for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'device_authorization_endpoint']) {
        assertMetadataEndpoint({ endpoint: document[key], key, origin });
      }
    },
  };
}
