import { token } from '@jini-ai/core';

import type {
  VisitorAuthAuthorizationServerPort,
  VisitorAuthClientRegistrationPort,
  VisitorAuthIdTokenVerifierPort,
  VisitorAuthSecurityPort,
  VisitorAuthTokenExchangePort,
  VisitorAuthTransactionStorePort,
} from './ports.js';
import type { VisitorAuthProviderRegistry } from './registry.js';

export const VisitorAuthProviderRegistryToken = token<VisitorAuthProviderRegistry>(
  'jini.capabilityProviders.visitorAuth.providerRegistry',
);
export const VisitorAuthClientRegistrationToken = token<VisitorAuthClientRegistrationPort>(
  'jini.capabilityProviders.visitorAuth.clientRegistration',
);
export const VisitorAuthAuthorizationServerToken = token<VisitorAuthAuthorizationServerPort>(
  'jini.capabilityProviders.visitorAuth.authorizationServer',
);
export const VisitorAuthSecurityToken = token<VisitorAuthSecurityPort>(
  'jini.capabilityProviders.visitorAuth.security',
);
export const VisitorAuthTransactionStoreToken = token<VisitorAuthTransactionStorePort>(
  'jini.capabilityProviders.visitorAuth.transactionStore',
);
export const VisitorAuthTokenExchangeToken = token<VisitorAuthTokenExchangePort>(
  'jini.capabilityProviders.visitorAuth.tokenExchange',
);
export const VisitorAuthIdTokenVerifierToken = token<VisitorAuthIdTokenVerifierPort>(
  'jini.capabilityProviders.visitorAuth.idTokenVerifier',
);
