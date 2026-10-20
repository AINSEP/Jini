/**
 * @file Replaces a connection's live credential in three fenced steps.
 *
 * Token and record stores cannot share a transaction, so the record first moves to a new
 * generation in the fail-safe `reconnect-required` state (no token can be served and any write
 * fenced on the old generation is refused), then the tokens are written, then the record becomes
 * `connected` with the new account. A crash between steps leaves "reconnect required", never a
 * record that claims one account while the store serves another account's token.
 */
import type { OAuthTokenSet } from '@jini-ai/oauth';
import type { ApiConnectionServiceDeps } from './deps.js';
import { writeRecord } from './records.js';
import type { ApiConnectionAccount, ApiConnectionRecord } from './types.js';

export async function installCredential(
  deps: Pick<ApiConnectionServiceDeps, 'records' | 'tokens' | 'clock' | 'descriptor'>,
  requiredArgs: {
    readonly current: ApiConnectionRecord;
    readonly tokens: OAuthTokenSet;
    readonly account: ApiConnectionAccount;
    readonly grantedScopes: readonly string[];
  },
): Promise<ApiConnectionRecord> {
  const fenced = await writeRecord(deps, requiredArgs.current, {
    status: 'reconnect-required', generation: requiredArgs.current.generation + 1, staged: null,
  });
  // Fenced on the new generation: a disconnect, switch or newer attempt that moves it first wins.
  await deps.tokens.install({ key: fenced.key, tokens: requiredArgs.tokens, generation: fenced.generation });
  return writeRecord(deps, fenced, {
    status: 'connected', account: requiredArgs.account, grantedScopes: [...requiredArgs.grantedScopes], revocationFailure: null,
  });
}
