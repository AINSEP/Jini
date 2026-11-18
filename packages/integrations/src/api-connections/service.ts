/**
 * @file Composition root: one API-connection service per plugin-declared connection.
 *
 * Exists so a host wires the ports once (descriptor, client identity, stores, hooks, HTTP and
 * clock) and gets every connection operation with that wiring bound.
 */
import { createApiConnectionAccessTokens } from './access-token.js';
import { cancelSwitchAccount, confirmSwitchAccount, disconnectApiConnection } from './account-actions.js';
import { completeApiConnectionAuthorization, startApiConnectionAuthorization } from './authorization.js';
import { assertClientWiring, type ApiConnectionServiceDeps } from './deps.js';
import { getApiConnectionStatus } from './status.js';

type Bound<F> = F extends (required: { deps: ApiConnectionServiceDeps; requiredArgs: infer A }, ...rest: infer O) => infer R ? (requiredArgs: A, ...rest: O) => R : never;

export interface ApiConnectionService {
  readonly start: Bound<typeof startApiConnectionAuthorization>;
  readonly complete: Bound<typeof completeApiConnectionAuthorization>;
  readonly confirmSwitchAccount: Bound<typeof confirmSwitchAccount>;
  readonly cancelSwitchAccount: Bound<typeof cancelSwitchAccount>;
  readonly disconnect: Bound<typeof disconnectApiConnection>;
  readonly getStatus: Bound<typeof getApiConnectionStatus>;
  readonly getAccessToken: ReturnType<typeof createApiConnectionAccessTokens>['getAccessToken'];
}

/** @throws ApiConnectionError `configuration-invalid` when the client kind contradicts the client. */
export function createApiConnectionService(deps: ApiConnectionServiceDeps): ApiConnectionService {
  assertClientWiring(deps);
  const accessTokens = createApiConnectionAccessTokens(deps);
  return {
    start: (requiredArgs, optionalArgs) => startApiConnectionAuthorization({ deps, requiredArgs }, optionalArgs),
    complete: (requiredArgs) => completeApiConnectionAuthorization({ deps, requiredArgs }),
    confirmSwitchAccount: (requiredArgs) => confirmSwitchAccount({ deps, requiredArgs }),
    cancelSwitchAccount: (requiredArgs) => cancelSwitchAccount({ deps, requiredArgs }),
    disconnect: (requiredArgs) => disconnectApiConnection({ deps, requiredArgs }),
    getStatus: (requiredArgs) => getApiConnectionStatus({ deps, requiredArgs }),
    getAccessToken: (...args) => accessTokens.getAccessToken(...args),
  };
}
