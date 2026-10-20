/**
 * @file Composition root: one API-connection service per plugin-declared connection.
 *
 * Exists so a host wires the ports once (descriptor, client identity, stores, hooks, HTTP and
 * clock) and gets every connection operation with that wiring bound.
 */
import { createApiConnectionAccessTokens } from './access-token.js';
import { cancelSwitchAccount, confirmSwitchAccount, disconnectApiConnection } from './account-actions.js';
import { completeApiConnectionAuthorization, startApiConnectionAuthorization } from './authorization.js';
import type { ApiConnectionServiceDeps } from './deps.js';
import { createApiConnectionGenerationReader, deriveApiConnectionKey } from './keys.js';
import { getApiConnectionStatus } from './status.js';

type Bound<F> = F extends (deps: ApiConnectionServiceDeps, ...rest: infer A) => infer R ? (...rest: A) => R : never;

export interface ApiConnectionService {
  readonly start: Bound<typeof startApiConnectionAuthorization>;
  readonly complete: Bound<typeof completeApiConnectionAuthorization>;
  readonly confirmSwitchAccount: Bound<typeof confirmSwitchAccount>;
  readonly cancelSwitchAccount: Bound<typeof cancelSwitchAccount>;
  readonly disconnect: Bound<typeof disconnectApiConnection>;
  readonly getStatus: Bound<typeof getApiConnectionStatus>;
  readonly getAccessToken: ReturnType<typeof createApiConnectionAccessTokens>['getAccessToken'];
  /** The connectionRef for a workspace, before or after it has ever connected. */
  connectionRefFor(requiredArgs: { readonly workspaceId: string }): string;
  /** Fence reader to inject into a generation-aware token store. */
  readonly readGeneration: ReturnType<typeof createApiConnectionGenerationReader>;
}

export function createApiConnectionService(deps: ApiConnectionServiceDeps): ApiConnectionService {
  const accessTokens = createApiConnectionAccessTokens(deps);
  const { pluginId, connectionId } = deps.descriptor;
  return {
    start: (...args) => startApiConnectionAuthorization(deps, ...args),
    complete: (...args) => completeApiConnectionAuthorization(deps, ...args),
    confirmSwitchAccount: (...args) => confirmSwitchAccount(deps, ...args),
    cancelSwitchAccount: (...args) => cancelSwitchAccount(deps, ...args),
    disconnect: (...args) => disconnectApiConnection(deps, ...args),
    getStatus: (...args) => getApiConnectionStatus(deps, ...args),
    getAccessToken: (...args) => accessTokens.getAccessToken(...args),
    connectionRefFor: ({ workspaceId }) => deriveApiConnectionKey({ workspaceId, pluginId, connectionId }),
    readGeneration: createApiConnectionGenerationReader({ records: deps.records }),
  };
}
