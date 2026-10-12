import type { Clock } from '@jini-ai/core/primitives';
import { DEFAULT_TTL_MS, invalidState, secureEquals, type PendingAuthorization } from './pending-authorizations.js';

/** Bounds both callback allocation and the encrypted payload carried through the browser. */
export const MAX_AUTHORIZATION_STATE_LENGTH = 4096;

/** Host adapter uses its existing authenticated sealer and context AAD; no crypto lives here. */
export interface AuthorizationStateCodec {
    seal(requiredArgs: { plaintext: string }, optionalArgs?: Record<string, never>): Promise<string>;
    open(requiredArgs: { state: string }, optionalArgs?: Record<string, never>): Promise<string>;
}
type AuthorizationEntry = Omit<PendingAuthorization, 'state' | 'createdAt' | 'expiresAt'>;
export interface SealedAuthorizationState {
    seal(requiredArgs: { entry: AuthorizationEntry }, optionalArgs?: Record<string, never>): Promise<PendingAuthorization>;
    open(requiredArgs: { state: string; ownerKey: string; providerId: string; redirectUri: string }, optionalArgs?: Record<string, never>): Promise<PendingAuthorization>;
}

/** Stateless redirect binding. Replay is rejected by the provider's single-use code, not a store.
 * Seal errors propagate; all open/expiry/binding failures are OAUTH_INVALID_STATE.
 * @example beginAuthorizationCode({ ...grant, stateless: createSealedAuthorizationState({ clock, codec, workspaceId, serverId }) })
 * @complexity O(state bytes) per seal/open; callback state is bounded to 4096 characters.
 */
export function createSealedAuthorizationState(requiredArgs: {
    clock: Clock; codec: AuthorizationStateCodec; workspaceId: string; serverId: string;
}, optionalArgs: { principalId?: string } = {}): SealedAuthorizationState {
    const { clock, codec, workspaceId, serverId } = requiredArgs;
    const principalId = optionalArgs.principalId;
    const context = { workspaceId, serverId, ...(principalId === undefined ? {} : { principalId }) };
    return {
        async seal({ entry }, _optional = {}) {
            const now = clock.nowMs();
            const exp = now + DEFAULT_TTL_MS;
            const createdAt = new Date(now).toISOString();
            const state = await codec.seal({ plaintext: JSON.stringify({ ...entry, ...context, createdAt, exp }) });
            if (state.length === 0 || state.length > MAX_AUTHORIZATION_STATE_LENGTH) throw invalidState({});
            return { ...entry, state, createdAt, expiresAt: new Date(exp).toISOString() };
        },
        async open({ state, ownerKey, providerId, redirectUri }, _optional = {}) {
            if (state.length === 0 || state.length > MAX_AUTHORIZATION_STATE_LENGTH) throw invalidState({});
            try {
                const value = JSON.parse(await codec.open({ state }));
                if (!value || typeof value !== 'object' || Array.isArray(value)
                    || value.workspaceId !== workspaceId || value.serverId !== serverId
                    || value.principalId !== principalId
                    || typeof value.ownerKey !== 'string' || !secureEquals({ a: value.ownerKey, b: ownerKey })
                    || value.providerId !== providerId || value.redirectUri !== redirectUri
                    || !Number.isSafeInteger(value.exp) || value.exp <= clock.nowMs()
                    || typeof value.codeVerifier !== 'string' || typeof value.createdAt !== 'string'
                    || !Number.isFinite(Date.parse(value.createdAt))
                    || !Array.isArray(value.scopes) || !value.scopes.every((scope: unknown) => typeof scope === 'string')
                    || (value.resource !== undefined && typeof value.resource !== 'string'
                        && (!Array.isArray(value.resource) || !value.resource.every((resource: unknown) => typeof resource === 'string')))) {
                    throw invalidState({});
                }
                return { state, ownerKey: value.ownerKey, providerId: value.providerId,
                    codeVerifier: value.codeVerifier, redirectUri: value.redirectUri, scopes: value.scopes,
                    createdAt: value.createdAt, expiresAt: new Date(value.exp).toISOString(),
                    ...(value.resource === undefined ? {} : { resource: value.resource }) };
            } catch {
                // Malformed envelopes, authentication failure and binding failures have one public error.
                throw invalidState({});
            }
        },
    };
}
