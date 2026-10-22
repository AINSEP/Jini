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
  { id: 'jini.capabilityProviders.visitorAuth.providerRegistry' },
);
export const VisitorAuthClientRegistrationToken = token<VisitorAuthClientRegistrationPort>(
  { id: 'jini.capabilityProviders.visitorAuth.clientRegistration' },
);
export const VisitorAuthAuthorizationServerToken = token<VisitorAuthAuthorizationServerPort>(
  { id: 'jini.capabilityProviders.visitorAuth.authorizationServer' },
);
export const VisitorAuthSecurityToken = token<VisitorAuthSecurityPort>(
  { id: 'jini.capabilityProviders.visitorAuth.security' },
);
export const VisitorAuthTransactionStoreToken = token<VisitorAuthTransactionStorePort>(
  { id: 'jini.capabilityProviders.visitorAuth.transactionStore' },
);
export const VisitorAuthTokenExchangeToken = token<VisitorAuthTokenExchangePort>(
  { id: 'jini.capabilityProviders.visitorAuth.tokenExchange' },
);
export const VisitorAuthIdTokenVerifierToken = token<VisitorAuthIdTokenVerifierPort>(
  { id: 'jini.capabilityProviders.visitorAuth.idTokenVerifier' },
);
