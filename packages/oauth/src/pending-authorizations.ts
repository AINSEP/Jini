import { nowIso } from '@jini-ai/core/primitives';
import { generateOAuthState } from './pkce.js';
import type { Clock } from '@jini-ai/core/primitives';
import type { OAuthRequiredArgs, OAuthOptionalArgs, OAuthEmptyArgs } from './args.js';
/** Async pending-authorization contract and shared constant-time owner binding helpers. Store adapters must consume state before checking ownership. */
import { timingSafeEqual } from "node:crypto";
import type { ISODateTime } from '@jini-ai/core/primitives';
import { OAuthError } from "./errors.js";
import type { OAuthRandomBytes } from "./ports.js";
export const STATE_BYTES = 24;
export const DEFAULT_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_ENTRIES = 256;
/** Keep codeVerifier secret and preserve redirectUri and optional resource binding verbatim. */
export interface PendingAuthorization {
    readonly state: string;
    readonly ownerKey: string;
    readonly providerId: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
    readonly scopes: readonly string[];
    readonly resource?: import("./ports.js").OAuthResource;
    readonly createdAt: ISODateTime;
    readonly expiresAt: ISODateTime;
}
/** take must atomically consume across processes and use the same error for every redemption failure. */
export interface PendingAuthorizationStore {
    put(requiredArgs: OAuthRequiredArgs<Omit<PendingAuthorization, "state" | "createdAt" | "expiresAt">>, optionalArgs?: OAuthOptionalArgs<Omit<PendingAuthorization, "state" | "createdAt" | "expiresAt">>): Promise<PendingAuthorization>;
    take(input: {
        state: string;
        ownerKey: string;
    }): Promise<PendingAuthorization>;
    size(requiredArgs: OAuthEmptyArgs): Promise<number>;
}
export interface PendingAuthorizationStoreDeps {
    readonly clock: Clock;
    readonly ttlMs?: number;
    readonly maxEntries?: number;
    readonly randomBytesFn: OAuthRandomBytes;
    readonly scheduler?: PendingAuthorizationScheduler;
}
/** Constant-time equality after a non-secret length comparison, for durable store adapters. */
export function secureEquals({ a, b }: {
    readonly a: string;
    readonly b: string;
}): boolean {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    return left.length === right.length && timingSafeEqual(left, right);
}
/** Shared indistinguishable response for unknown, expired, replayed or wrongly owned state. */
export function invalidState(_requiredArgs: OAuthEmptyArgs): OAuthError {
    return new OAuthError({
        code: "OAUTH_INVALID_STATE", message: "the authorization request could not be matched — it may have expired or already been used",
        operatorAction: "Start the connection again from the connection settings."
    });
}

/** Timer ownership is explicit: the scheduler returns an idempotent cancellation operation. */
export interface PendingAuthorizationScheduler {
    every(requiredArgs: { intervalMs: number; run: () => void }): () => void;
}
/** Fixed-issuer hosts may retain their payload and choose an absolute expiry instant.
 * Main owner-bound stores expire at the deadline; legacy callback caches can request an
 * exclusive deadline to retain the original `age > ttl` boundary.
 */
export interface PendingAuthorizationCacheOptions<T> {
    readonly expiry: (requiredArgs: { value: T; ttlMs: number }) => number;
    readonly scheduler?: PendingAuthorizationScheduler;
    readonly ttlMs?: number;
    readonly maxEntries?: number;
    readonly exclusiveExpiry?: boolean;
}
/** Synchronous callback storage, for hosts that already generate and bind their own state. */
export interface PendingAuthorizationCache<T> {
    put(requiredArgs: { state: string; value: T }): void;
    consume(requiredArgs: { state: string }): T | null;
    size(requiredArgs: OAuthEmptyArgs): number;
    stop(requiredArgs: OAuthEmptyArgs): void;
}
/** One process-local, single-use store: an explicit expiry option selects host payloads;
 * otherwise entropy creates owner-bound authorizations. Both use the same bounded map,
 * expiry sweep and removal-before-return contract. No persistence is required for a local
 * browser callback; durable adapters must implement the async contract atomically.
 */
export function createPendingAuthorizationStore<T>(
    deps: { readonly clock: Clock },
    optionalArgs: PendingAuthorizationCacheOptions<T>,
): PendingAuthorizationCache<T>;
export function createPendingAuthorizationStore(
    deps: OAuthRequiredArgs<PendingAuthorizationStoreDeps>,
    optionalArgs?: OAuthOptionalArgs<PendingAuthorizationStoreDeps>,
): PendingAuthorizationStore;
export function createPendingAuthorizationStore<T>(
    deps: { readonly clock: Clock; readonly randomBytesFn?: OAuthRandomBytes },
    optionalArgs: PendingAuthorizationCacheOptions<T> | OAuthOptionalArgs<PendingAuthorizationStoreDeps> = {},
): PendingAuthorizationCache<T> | PendingAuthorizationStore {
    const ttlMs = optionalArgs.ttlMs ?? DEFAULT_TTL_MS;
    const maxEntries = optionalArgs.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 1) {
        throw new OAuthError({ code: 'OAUTH_INVALID_REQUEST', message: 'pending store limits must be positive',
            operatorAction: 'Configure positive TTL and capacity values.' });
    }
    function entries<Value>(options: PendingAuthorizationCacheOptions<Value>): PendingAuthorizationCache<Value> {
        const pending = new Map<string, Value>();
        let cancel: (() => void) | null = null;
        const stop = (): void => { cancel?.(); cancel = null; };
        const expired = (value: Value, now: number): boolean => {
            const deadline = options.expiry({ value, ttlMs });
            return options.exclusiveExpiry === true ? deadline < now : deadline <= now;
        };
        const sweep = (): void => {
            const now = deps.clock.nowMs();
            for (const [key, value] of pending) if (expired(value, now)) pending.delete(key);
            if (pending.size === 0) stop();
        };
        return {
            put({ state, value }) {
                sweep();
                // Bound allocation without evicting on a replacement of an existing state.
                while (!pending.has(state) && pending.size >= maxEntries) {
                    const oldest = pending.keys().next();
                    if (oldest.done) break;
                    pending.delete(oldest.value);
                }
                pending.set(state, value);
                cancel ??= options.scheduler?.every({ intervalMs: Math.min(ttlMs, 60_000), run: sweep }) ?? null;
            },
            consume({ state }) {
                const value = pending.get(state);
                // Remove before returning or checking expiry so a callback replay cannot reuse state.
                pending.delete(state);
                if (pending.size === 0) stop();
                if (value === undefined || expired(value, deps.clock.nowMs())) return null;
                return value;
            },
            size(_requiredArgs) { sweep(); return pending.size; },
            stop(_requiredArgs) { stop(); },
        };
    }
    if ('expiry' in optionalArgs) return entries(optionalArgs);
    const randomBytesFn = deps.randomBytesFn;
    if (!randomBytesFn) throw new TypeError('owner-bound authorizations require cryptographic entropy');
    const pending = entries<PendingAuthorization>({
        expiry: ({ value }) => Date.parse(value.expiresAt),
        ...(optionalArgs.scheduler === undefined ? {} : { scheduler: optionalArgs.scheduler }),
    });
    const authorizationStore: PendingAuthorizationStore = {
        async put(requiredArgs, optional = {}) {
            const input = { ...optional, ownerKey: requiredArgs.ownerKey, providerId: requiredArgs.providerId,
                codeVerifier: requiredArgs.codeVerifier, redirectUri: requiredArgs.redirectUri, scopes: requiredArgs.scopes };
            const createdAt = nowIso({ clock: deps.clock });
            const entry: PendingAuthorization = {
                ...structuredClone(input), state: generateOAuthState({ randomBytesFn }, { stateBytes: STATE_BYTES }),
                createdAt, expiresAt: new Date(Date.parse(createdAt) + ttlMs).toISOString(),
            };
            pending.put({ state: entry.state, value: entry });
            return structuredClone(entry);
        },
        async take({ state, ownerKey }) {
            const entry = pending.consume({ state });
            // Burn state before the owner check so wrong owners cannot retry as an oracle.
            if (!entry || !secureEquals({ a: entry.ownerKey, b: ownerKey })) throw invalidState({});
            return structuredClone(entry);
        },
        async size(requiredArgs) { return pending.size(requiredArgs); },
    };
    return authorizationStore;
}
