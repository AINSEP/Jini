import { describe, expect, it } from 'vitest';

import * as root from '../../index.js';
import * as visitorAuth from '../index.js';

describe('@jini-ai/capability-providers/visitor-auth public surface', () => {
  it('exports stable typed token ids from the dedicated subpath', () => {
    expect(visitorAuth.VisitorAuthProviderRegistryToken.id).toBe(
      'jini.capabilityProviders.visitorAuth.providerRegistry',
    );
    expect(visitorAuth.VisitorAuthClientRegistrationToken.id).toBe(
      'jini.capabilityProviders.visitorAuth.clientRegistration',
    );
    expect(visitorAuth.VisitorAuthAuthorizationServerToken.id).toBe(
      'jini.capabilityProviders.visitorAuth.authorizationServer',
    );
    expect(visitorAuth.VisitorAuthSecurityToken.id).toBe(
      'jini.capabilityProviders.visitorAuth.security',
    );
    expect(visitorAuth.VisitorAuthTransactionStoreToken.id).toBe(
      'jini.capabilityProviders.visitorAuth.transactionStore',
    );
    expect(visitorAuth.VisitorAuthTokenExchangeToken.id).toBe(
      'jini.capabilityProviders.visitorAuth.tokenExchange',
    );
    expect(visitorAuth.VisitorAuthIdTokenVerifierToken.id).toBe(
      'jini.capabilityProviders.visitorAuth.idTokenVerifier',
    );
  });

  it('does not widen the root barrel or export a concrete provider adapter', () => {
    expect(Reflect.get(root, 'VisitorAuthProviderRegistryToken')).toBeUndefined();
    expect(Reflect.get(visitorAuth, 'createGoogleAdapter')).toBeUndefined();
    expect(Reflect.get(visitorAuth, 'exchangeGoogleToken')).toBeUndefined();
  });
});
