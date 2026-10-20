/**
 * @file Serves access tokens for a connection, refreshing through the OAuth core's refresher.
 *
 * Exists so plugin tool and delivery code never touch refresh tokens: they ask for an access
 * token by `connectionRef` immediately before an HTTP call. Only `connected` records are served,
 * an optional frozen account id stops a binding from silently following an account switch (checked
 * again after the token is read, so a switch landing in between cannot leak through), and a
 * rejected refresh moves the record to `reconnect-required`.
 */
import { createTokenRefresher, OAuthError, refreshAccessToken, type TokenRefreshPort } from '@jini-ai/oauth';
import type { ApiConnectionServiceDeps } from './deps.js';
import { ApiConnectionError, type ApiConnectionErrorCode } from './errors.js';
import { loadOwnedRecord, writeRecord, type OwnedRecordArgs } from './records.js';
import type { ApiConnectionRecord, ApiConnectionStatus } from './types.js';

export interface ApiConnectionAccessTokens {
  getAccessToken(
    requiredArgs: OwnedRecordArgs,
    optionalArgs?: { readonly expectedAccountId?: string },
  ): Promise<string>;
}

const REFUSALS: Readonly<Record<Exclude<ApiConnectionStatus, 'connected'>, { code: ApiConnectionErrorCode; message: string }>> = {
  'reconnect-required': { code: 'reconnect-required', message: 'This connection needs to be reconnected. Reconnect the account in the connection settings.' },
  'revocation-pending': { code: 'revocation-pending', message: 'This connection was disconnected. Finish disconnecting or connect again.' },
  disconnected: { code: 'not-connected', message: 'This connection is not connected. Connect the account first.' },
};

function assertServable(record: ApiConnectionRecord, expectedAccountId: string | undefined): void {
  if (record.status !== 'connected') throw new ApiConnectionError(REFUSALS[record.status]);
  if (expectedAccountId !== undefined && record.account?.accountId !== expectedAccountId) {
    throw new ApiConnectionError({ code: 'account-changed',
      message: 'This connection now uses a different account than this task was set up with. Review the task and reassign it.' });
  }
}

/** Status write after a terminal refresh failure; only a still-connected record is downgraded. */
async function markReconnectRequired(deps: ApiConnectionServiceDeps, key: string): Promise<void> {
  const record = await deps.records.read({ key });
  if (record?.status === 'connected') await writeRecord(deps, record, { status: 'reconnect-required' });
}

/**
 * The token store reads the live generation, so a confirmed switch, disconnect or reconnect that
 * landed between the record check and the token read could hand over another credential: refuse
 * unless the record still serves the same generation. A retry reads the new state consistently.
 */
async function assertUnchangedSince(deps: ApiConnectionServiceDeps, requiredArgs: OwnedRecordArgs & {
  readonly checked: ApiConnectionRecord; readonly expectedAccountId: string | undefined;
}): Promise<void> {
  const current = await loadOwnedRecord(deps, requiredArgs);
  assertServable(current, requiredArgs.expectedAccountId);
  if (current.generation !== requiredArgs.checked.generation) {
    throw new ApiConnectionError({ code: 'storage-conflict',
      message: 'This connection changed while the request was running. Reload its status and try again.' });
  }
}

function refreshPort(deps: ApiConnectionServiceDeps): TokenRefreshPort {
  const { tokens } = deps;
  return {
    load: args => tokens.load(args),
    persist: args => tokens.persist(args),
    async markNeedsReauth(args) {
      await tokens.markNeedsReauth(args);
      await markReconnectRequired(deps, args.key);
    },
    ...(tokens.tryAcquireRefreshLease ? { tryAcquireRefreshLease: tokens.tryAcquireRefreshLease.bind(tokens) } : {}),
    ...(tokens.releaseRefreshLease ? { releaseRefreshLease: tokens.releaseRefreshLease.bind(tokens) } : {}),
    refresh: ({ refreshToken }) => refreshAccessToken({ fetchFn: deps.fetchFn, guard: deps.guard, clock: deps.clock,
      tokenEndpoint: deps.descriptor.tokenEndpoint, client: deps.client, refreshToken }),
  };
}

export function createApiConnectionAccessTokens(deps: ApiConnectionServiceDeps): ApiConnectionAccessTokens {
  const refresher = createTokenRefresher({ clock: deps.clock, sleep: deps.sleep, port: refreshPort(deps) });
  return {
    async getAccessToken(requiredArgs, optionalArgs = {}) {
      const { expectedAccountId } = optionalArgs;
      const record = await loadOwnedRecord(deps, requiredArgs);
      assertServable(record, expectedAccountId);
      const accessToken = await refresher.getAccessToken({ key: record.key }).catch((error: unknown) => {
        if (error instanceof OAuthError && error.code === 'OAUTH_INVALID_GRANT') {
          throw new ApiConnectionError(REFUSALS['reconnect-required'], { cause: error });
        }
        throw error;
      });
      await assertUnchangedSince(deps, { ...requiredArgs, checked: record, expectedAccountId });
      return accessToken;
    },
  };
}
