/**
 * @file Decides what an exchanged token set becomes: a live credential or a staged switch.
 *
 * Exists to hold the post-exchange rules in one place: every requested scope must be granted,
 * the plugin's identity hook must name the account, the attempt must still match the current
 * credential generation, a reconnect must be the same account, and a switch is only staged.
 */
import { nowIso } from '@jini-ai/core/primitives';
import type { OAuthTokenSet } from '@jini-ai/oauth';
import { ATTEMPT_TTL_MS } from './attempt-state.js';
import type { ApiConnectionServiceDeps } from './deps.js';
import { ApiConnectionError } from './errors.js';
import { installCredential } from './install-credential.js';
import { stagedTokenKey } from './keys.js';
import { blankRecord, writeRecord } from './records.js';
import { isUnreadableTokenRecord } from './token-store/errors.js';
import type { ApiConnectionAccount, ApiConnectionAttempt, ApiConnectionRecord } from './types.js';

const MAX_IDENTITY_LENGTH = 256;

export interface CompletedAuthorization {
  readonly connectionRef: string;
  /** The `attemptId` `start` returned for this sign-in. */
  readonly attemptId: string;
  /** `staged` means a switch-account result awaits `confirmSwitchAccount`. */
  readonly outcome: 'connected' | 'staged';
  readonly account: ApiConnectionAccount;
  readonly grantedScopes: readonly string[];
  /** Plugin-declared callback fields; trust them only after the plugin verifies them via the API. */
  readonly callbackFields: Readonly<Record<string, string>>;
}

function grantedScopesOf(tokens: OAuthTokenSet, requested: readonly string[]): readonly string[] {
  // RFC 6749 §5.1: a token response omits `scope` only when it equals the requested scope.
  return tokens.scopes.length > 0 ? tokens.scopes : requested;
}

function assertGranted(requested: readonly string[], granted: readonly string[]): void {
  if (requested.some(scope => !granted.includes(scope))) {
    throw new ApiConnectionError({ code: 'scope-not-granted',
      message: 'The account did not grant every permission this connection needs. Connect again and allow all requested permissions.' });
  }
}

function isBoundedText(value: unknown, minLength: number): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= MAX_IDENTITY_LENGTH;
}

async function readAccount(deps: ApiConnectionServiceDeps, accessToken: string): Promise<ApiConnectionAccount> {
  const failed = (cause?: unknown) => new ApiConnectionError({ code: 'account-identity-invalid',
    message: 'Could not confirm which account signed in. Try connecting again.' }, { cause });
  const account = await deps.hooks.readAccount({ accessToken }).catch((cause: unknown) => { throw failed(cause); });
  if (!isBoundedText(account?.accountId, 1) || !isBoundedText(account.displayName, 0)) throw failed();
  return { accountId: account.accountId, displayName: account.displayName };
}

async function currentRecord(deps: ApiConnectionServiceDeps, attempt: ApiConnectionAttempt): Promise<ApiConnectionRecord> {
  const record = await deps.records.read({ key: attempt.key }) ?? blankRecord(deps, attempt);
  // A reconnect, switch, disconnect or newer completed attempt moved the generation: this one is stale.
  if (record.generation !== attempt.generation) {
    throw new ApiConnectionError({ code: 'attempt-superseded',
      message: 'A newer sign-in or account change replaced this one. Reload the connection status and start again if needed.' });
  }
  // Start refuses while a switch is staged; this catches one staged in the meantime. Either intent
  // would otherwise overwrite (switch) or drop unrevoked (connect) the consented staged credential.
  if (record.staged !== null) {
    throw new ApiConnectionError({ code: 'switch-in-progress',
      message: 'An account switch was staged while this sign-in ran. Confirm or cancel it, then sign in again.' });
  }
  return record;
}

/** Re-consent for the same account may omit a refresh token; the stored one stays valid. */
async function keepRefreshToken(deps: ApiConnectionServiceDeps, record: ApiConnectionRecord, tokens: OAuthTokenSet,
  account: ApiConnectionAccount): Promise<OAuthTokenSet> {
  if (tokens.refreshToken !== null || record.account?.accountId !== account.accountId) return tokens;
  // A row sealed for another client (the host changed its OAuth client) has no usable refresh token.
  const existing = await deps.tokens.load({ key: record.key }).catch((error: unknown) => {
    if (isUnreadableTokenRecord(error)) return null;
    throw error;
  });
  return existing?.refreshToken ? { ...tokens, refreshToken: existing.refreshToken } : tokens;
}

/**
 * An installed app has no other way to renew access: without a refresh token the credential would
 * stop working, silently, when its access token expires. Refuse before anything is written.
 */
function assertRenewable(deps: ApiConnectionServiceDeps, tokens: OAuthTokenSet): void {
  if (deps.clientKind === 'public' && tokens.refreshToken === null) {
    throw new ApiConnectionError({ code: 'offline-access-required',
      message: 'The account did not grant offline access, so this connection would stop working within the hour. Connect again and allow offline access.' });
  }
}

async function commitConnect(deps: ApiConnectionServiceDeps, record: ApiConnectionRecord, tokens: OAuthTokenSet,
  account: ApiConnectionAccount, grantedScopes: readonly string[]): Promise<void> {
  if (record.account !== null && record.account.accountId !== account.accountId) {
    throw new ApiConnectionError({ code: 'account-mismatch',
      message: 'A different account signed in than the one connected. Use "switch account" to change accounts.' });
  }
  const kept = await keepRefreshToken(deps, record, tokens, account);
  assertRenewable(deps, kept);
  await installCredential(deps, { current: record, tokens: kept, account, grantedScopes });
}

async function stageSwitch(deps: ApiConnectionServiceDeps, record: ApiConnectionRecord, attempt: ApiConnectionAttempt,
  tokens: OAuthTokenSet, account: ApiConnectionAccount, grantedScopes: readonly string[]): Promise<void> {
  // The provider usually holds one grant per client and account, so a staged copy of the live
  // account would share its grant: cancelling the switch would then revoke the live credential.
  if (record.account?.accountId === account.accountId) {
    throw new ApiConnectionError({ code: 'account-unchanged',
      message: 'This is the account already connected. Use reconnect instead of switching accounts.' });
  }
  assertRenewable(deps, tokens);
  const expiresAt = new Date(Date.parse(nowIso({ clock: deps.clock })) + ATTEMPT_TTL_MS).toISOString();
  // Claim the staged slot on the record first: of two concurrent switches only the compare-and-set
  // winner writes tokens, so the slot can never hold one account while the record names another.
  await writeRecord(deps, record, {
    staged: { account, grantedScopes: [...grantedScopes], actorId: attempt.actorId, generation: record.generation, expiresAt },
  });
  await deps.tokens.install({ key: stagedTokenKey({ key: record.key }), tokens, generation: record.generation });
}

export async function finishAuthorization(
  deps: ApiConnectionServiceDeps,
  requiredArgs: { readonly attempt: ApiConnectionAttempt; readonly tokens: OAuthTokenSet; readonly callbackFields: Readonly<Record<string, string>> },
): Promise<CompletedAuthorization> {
  const { attempt, tokens } = requiredArgs;
  const grantedScopes = grantedScopesOf(tokens, attempt.requestedScopes);
  assertGranted(attempt.requestedScopes, grantedScopes);
  const account = await readAccount(deps, tokens.accessToken);
  const record = await currentRecord(deps, attempt);
  const staged = attempt.intent === 'switch-account';
  await (staged ? stageSwitch(deps, record, attempt, tokens, account, grantedScopes)
    : commitConnect(deps, record, tokens, account, grantedScopes));
  return { connectionRef: attempt.key, attemptId: attempt.attemptId, outcome: staged ? 'staged' : 'connected', account, grantedScopes,
    callbackFields: requiredArgs.callbackFields };
}
