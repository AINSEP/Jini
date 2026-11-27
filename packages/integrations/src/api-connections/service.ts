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

type Bound<F> = F extends (required: infer A, ...rest: infer B) => infer R ? (required: Omit<A, 'deps'>, ...rest: B) => R : never;

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
    start: (requiredArgs, ...optionalArgs) => startApiConnectionAuthorization({ ...requiredArgs, deps }, ...optionalArgs),
    complete: (requiredArgs) => completeApiConnectionAuthorization({ ...requiredArgs, deps }),
    confirmSwitchAccount: (requiredArgs) => confirmSwitchAccount({ ...requiredArgs, deps }),
    cancelSwitchAccount: (requiredArgs) => cancelSwitchAccount({ ...requiredArgs, deps }),
    disconnect: (requiredArgs) => disconnectApiConnection({ ...requiredArgs, deps }),
    getStatus: (requiredArgs) => getApiConnectionStatus({ ...requiredArgs, deps }),
    getAccessToken: (...args) => accessTokens.getAccessToken(...args),
  };
}
