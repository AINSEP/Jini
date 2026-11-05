/**
 * @file Consumes an explicitly shared OAuth connection without exposing owner credentials.
 * The host keeps issuing clients, refresh tokens and refreshers in its owner store. This port
 * checks the selected binding and live site grant on every use, including after a refresh.
 */
import { ApiConnectionError } from './errors.js';
import type { ApiConnectionAccount, ApiConnectionStatus } from './types.js';

/** Trusted declaration to match; a consuming site's own client must never replace the issuer's. */
export interface SharedOAuthIdentity {
  readonly pluginId: string;
  readonly connectionId: string;
  readonly tokenEndpoint: string;
  readonly authorizationEndpoint?: string;
  readonly issuer?: string;
  readonly resource?: string;
  /** Optional pin to the saved client; omit when the consumer has a different local client. */
  readonly clientId?: string;
}

/** Public owner metadata. Secret issuing context and tokens never belong in this value. */
export interface SharedOAuthConnection {
  readonly credentialId: string;
  readonly identity: SharedOAuthIdentity & { readonly clientId: string };
  readonly generation: number;
  readonly status: ApiConnectionStatus;
  readonly account: ApiConnectionAccount | null;
  readonly grantedScopes: readonly string[];
}

/** A binding uses the immutable site UUID: workspace-local is deliberately shared by sites. */
export interface SharedOAuthConsumerTarget {
  readonly siteId: string;
  readonly consumerId: string;
  readonly identity: SharedOAuthIdentity;
  readonly requiredScopes: readonly string[];
  readonly expectedAccountId?: string;
}

type ConsumerIdentity = Pick<SharedOAuthConsumerTarget, 'siteId' | 'consumerId'>;

export interface SharedOAuthConsumerDeps {
  readonly bindings: {
    read(requiredArgs: ConsumerIdentity): Promise<{ readonly credentialId: string } | null>;
  };
  readonly grants: {
    isGranted(requiredArgs: ConsumerIdentity & { readonly credentialId: string }): Promise<boolean>;
  };
  /** Owner adapter: reuse its service/refresher per credential in this process; never cache grants. */
  readonly connections: {
    read(requiredArgs: { readonly credentialId: string }): Promise<SharedOAuthConnection | null>;
    getAccessToken(requiredArgs: {
      readonly credentialId: string;
      readonly expectedGeneration: number;
      readonly expectedAccountId?: string;
    }): Promise<string>;
  };
}

function unavailable(): ApiConnectionError {
  return new ApiConnectionError({ code: 'connection-not-found',
    message: 'The selected shared connection does not match this connection. Choose a compatible saved connection or connect locally.' });
}

function denied(): ApiConnectionError {
  return new ApiConnectionError({ code: 'access-denied',
    message: 'Permission to use the selected shared connection was removed. Choose it again in the connection settings to request access.' });
}

/**
 * Validates public owner metadata before a user-approved grant is written. It does not authorize
 * consumption: every token request must still use the consumer's live binding/grant checks.
 * @complexity O(g + r) for granted/requested scopes; no storage or token I/O.
 */
export function assertSharedOAuthCompatibility(
  { connection, target }: { readonly connection: SharedOAuthConnection; readonly target: SharedOAuthConsumerTarget },
  _optionalArgs: Record<string, never> = {},
): void {
  const fields = ['pluginId', 'connectionId', 'tokenEndpoint', 'authorizationEndpoint', 'issuer', 'resource'] as const;
  if (fields.some(field => connection.identity[field] !== target.identity[field])) throw unavailable();
  if (target.identity.clientId !== undefined && connection.identity.clientId !== target.identity.clientId) throw unavailable();
  const granted = new Set(connection.grantedScopes);
  if (target.requiredScopes.some(scope => !granted.has(scope))) {
    throw new ApiConnectionError({ code: 'scope-not-granted',
      message: 'The selected shared connection does not grant the access this connection needs. Reconnect the shared account with the required permissions.' });
  }
  if (target.expectedAccountId !== undefined && connection.account?.accountId !== target.expectedAccountId) {
    throw new ApiConnectionError({ code: 'account-changed',
      message: 'The selected shared connection now uses a different account. Review the selected account in the connection settings.' });
  }
}

function assertConnected(connection: SharedOAuthConnection): void {
  if (connection.status === 'connected') return;
  if (connection.status === 'reconnect-required') {
    throw new ApiConnectionError({ code: 'reconnect-required', message: 'The shared connection needs a new sign-in. Reconnect the shared account in the connection settings.' });
  }
  if (connection.status === 'revocation-pending') {
    throw new ApiConnectionError({ code: 'revocation-pending', message: 'The shared connection was stopped on every site. Its owner can retry provider revocation in the shared connection settings.' });
  }
  throw new ApiConnectionError({ code: 'not-connected', message: 'The shared connection is disconnected. Choose a connected saved account or connect locally.' });
}

/** Copy only public fields, protecting both snapshots and status output from adapter extras. */
function publicConnection(connection: SharedOAuthConnection): SharedOAuthConnection {
  const identity = connection.identity;
  return { credentialId: connection.credentialId, generation: connection.generation, status: connection.status,
    identity: { pluginId: identity.pluginId, connectionId: identity.connectionId, tokenEndpoint: identity.tokenEndpoint,
      clientId: identity.clientId, ...(identity.issuer === undefined ? {} : { issuer: identity.issuer }),
      ...(identity.authorizationEndpoint === undefined ? {} : { authorizationEndpoint: identity.authorizationEndpoint }),
      ...(identity.resource === undefined ? {} : { resource: identity.resource }) },
    account: connection.account === null ? null : { accountId: connection.account.accountId, displayName: connection.account.displayName },
    grantedScopes: [...connection.grantedScopes] };
}

/**
 * Creates a live shared-connection consumer. Only an absent binding returns null status; a
 * selected but revoked binding always refuses, so hosts cannot silently fall back to local keys.
 * @complexity Each check reads one binding, one grant and one owner record; scope checks are
 * O(g + r), for granted and requested scopes. Token requests perform two checks and one owner
 * token acquisition; there is no polling, vault scan, cached authorization or site secret write.
 */
export function createSharedOAuthConsumer(
  deps: SharedOAuthConsumerDeps,
  _optionalArgs: Record<string, never> = {},
) {
  async function checked(target: SharedOAuthConsumerTarget): Promise<SharedOAuthConnection | null> {
    const consumer = { siteId: target.siteId, consumerId: target.consumerId };
    const binding = await deps.bindings.read(consumer);
    if (binding === null) return null;
    if (!await deps.grants.isGranted({ ...consumer, credentialId: binding.credentialId })) throw denied();
    const connection = await deps.connections.read({ credentialId: binding.credentialId });
    if (connection === null || connection.credentialId !== binding.credentialId) throw unavailable();
    assertSharedOAuthCompatibility({ connection, target });
    return publicConnection(connection);
  }

  async function connected(target: SharedOAuthConsumerTarget): Promise<SharedOAuthConnection> {
    const connection = await checked(target);
    if (connection === null) throw denied();
    assertConnected(connection);
    return connection;
  }

  return {
    getStatus: (target: SharedOAuthConsumerTarget, _options: Record<string, never> = {}) => checked(target),
    async assertAuthorized(target: SharedOAuthConsumerTarget, _options: Record<string, never> = {}): Promise<void> {
      await connected(target);
    },
    async getAccessToken(target: SharedOAuthConsumerTarget, _options: Record<string, never> = {}): Promise<string> {
      const before = await connected(target);
      const expectedAccountId = before.account?.accountId;
      const token = await deps.connections.getAccessToken({ credentialId: before.credentialId, expectedGeneration: before.generation,
        ...(expectedAccountId === undefined ? {} : { expectedAccountId }) });
      const after = await connected(target);
      if (after.credentialId !== before.credentialId || after.generation !== before.generation
        || after.identity.clientId !== before.identity.clientId || after.account?.accountId !== expectedAccountId) {
        throw new ApiConnectionError({ code: 'storage-conflict',
          message: 'The shared connection changed while this request was running. Review its status and retry.' });
      }
      return token;
    },
  };
}

export type SharedOAuthConsumer = ReturnType<typeof createSharedOAuthConsumer>;
