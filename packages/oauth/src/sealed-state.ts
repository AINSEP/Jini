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

type OpenStateInput = Parameters<SealedAuthorizationState['open']>[0];
type AuthorizationPayload = AuthorizationEntry & { createdAt: string; exp: number };

function assertStateBinding({ value, workspaceId, serverId, principalId, ownerKey, providerId, redirectUri }: {
    value: Record<string, unknown>; workspaceId: string; serverId: string; principalId: string | undefined;
} & Omit<OpenStateInput, 'state'>, _optional: Record<string, never> = {}): void {
    const sameScope = value.workspaceId === workspaceId && value.serverId === serverId && value.principalId === principalId;
    const sameOwner = typeof value.ownerKey === 'string' && secureEquals({ a: value.ownerKey, b: ownerKey });
    const sameTarget = value.providerId === providerId && value.redirectUri === redirectUri;
    if (!sameScope || !sameOwner || !sameTarget) {
        throw invalidState({});
    }
}

function isValidStateResource({ resource }: { resource: unknown }, _optional: Record<string, never> = {}): boolean {
    return resource === undefined || typeof resource === 'string'
        || (Array.isArray(resource) && resource.every((item: unknown) => typeof item === 'string'));
}

function readStatePayload({ value, clock }: {
    value: Record<string, unknown>; clock: Clock;
}, _optional: Record<string, never> = {}): AuthorizationPayload {
    const live = Number.isSafeInteger(value.exp) && (value.exp as number) > clock.nowMs();
    const created = typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt));
    const scopesValid = Array.isArray(value.scopes) && value.scopes.every((scope: unknown) => typeof scope === 'string');
    const shapeValid = typeof value.codeVerifier === 'string' && created && scopesValid;
    if (!live || !shapeValid || !isValidStateResource({ resource: value.resource })) {
        throw invalidState({});
    }
    return value as AuthorizationPayload;
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
                const parsed: unknown = JSON.parse(await codec.open({ state }));
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    throw invalidState({});
                }
                const document = parsed as Record<string, unknown>;
                assertStateBinding({ value: document, workspaceId, serverId, principalId, ownerKey, providerId, redirectUri });
                const value = readStatePayload({ value: document, clock });
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
