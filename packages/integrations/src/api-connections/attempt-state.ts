/**
 * @file Adapts the record store's attempts to the OAuth core's `SealedAuthorizationState` seam.
 *
 * Exists so `beginAuthorizationCode`/`completeAuthorizationCode` keep owning PKCE, redirect
 * allowlisting, callback errors and the token exchange, while the attempt itself is a stored,
 * expiring, single-use record bound to workspace, actor, plugin connection, callback URI and
 * credential generation. Every redemption failure is the core's indistinguishable invalid-state.
 */
import { invalidPendingAuthorizationState, PENDING_AUTHORIZATION_STATE_BYTES, generateOAuthState,
  secureEqualsForOwnerBinding, type PendingAuthorization, type SealedAuthorizationState } from '@jini-ai/oauth';
import { nowIso } from '@jini-ai/core/primitives';
import type { ApiConnectionServiceDeps } from './deps.js';
import type { ApiConnectionAttempt } from './types.js';

/** Long enough for consent and multi-factor prompts; abandoned attempts die quickly. */
export const ATTEMPT_TTL_MS = 10 * 60 * 1000;

type AttemptDraft = Omit<ApiConnectionAttempt, 'state' | 'codeVerifier' | 'redirectUri' | 'createdAt' | 'expiresAt'>;
type AttemptDeps = Pick<ApiConnectionServiceDeps, 'records' | 'clock' | 'randomBytesFn'>;

function toPending(attempt: ApiConnectionAttempt, providerId: string): PendingAuthorization {
  return {
    state: attempt.state, ownerKey: attempt.ownerKey, providerId, codeVerifier: attempt.codeVerifier,
    redirectUri: attempt.redirectUri, scopes: attempt.requestedScopes, createdAt: attempt.createdAt, expiresAt: attempt.expiresAt,
  };
}

/** Each adapter serves one direction; reaching the other means the core changed its contract. */
async function refuseUnexpected(): Promise<never> {
  throw invalidPendingAuthorizationState({});
}

/** Seal side: store the attempt under fresh random state. */
export function attemptSealer(deps: AttemptDeps, requiredArgs: { readonly draft: AttemptDraft }): SealedAuthorizationState {
  return {
    async seal({ entry }) {
      const createdAt = nowIso({ clock: deps.clock });
      const attempt: ApiConnectionAttempt = {
        ...requiredArgs.draft, codeVerifier: entry.codeVerifier, redirectUri: entry.redirectUri, createdAt,
        state: generateOAuthState({ randomBytesFn: deps.randomBytesFn }, { stateBytes: PENDING_AUTHORIZATION_STATE_BYTES }),
        expiresAt: new Date(Date.parse(createdAt) + ATTEMPT_TTL_MS).toISOString(),
      };
      await deps.records.putAttempt({ attempt });
      return toPending(attempt, entry.providerId);
    },
    open: refuseUnexpected,
  };
}

function matchesBinding(attempt: ApiConnectionAttempt, expected: { ownerKey: string; redirectUri: string }, nowMs: number): boolean {
  return Date.parse(attempt.expiresAt) > nowMs
    && secureEqualsForOwnerBinding({ a: attempt.ownerKey, b: expected.ownerKey })
    && attempt.redirectUri === expected.redirectUri;
}

/** Open side: consume first, then check binding, so a probe burns the state it guessed. */
export function attemptOpener(
  deps: AttemptDeps,
  requiredArgs: { readonly onOpen: (requiredArgs: { readonly attempt: ApiConnectionAttempt }) => void },
): SealedAuthorizationState {
  return {
    seal: refuseUnexpected,
    async open({ state, ownerKey, providerId, redirectUri }) {
      const attempt = await deps.records.takeAttempt({ state });
      if (attempt === null || !matchesBinding(attempt, { ownerKey, redirectUri }, deps.clock.nowMs())) {
        throw invalidPendingAuthorizationState({});
      }
      requiredArgs.onOpen({ attempt });
      return toPending(attempt, providerId);
    },
  };
}
