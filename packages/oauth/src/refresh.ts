import { nowIso as readNowIso } from '@jini-ai/core/primitives';
import type { Clock } from '@jini-ai/core/primitives';
import type { OAuthRequiredArgs, OAuthOptionalArgs, OAuthEmptyArgs } from './args.js';
/** Refresh grant and token coordinator. Coalesce in-process calls, honor optional storage leases, and persist rotation before returning access tokens. */
import { requestOAuthToken } from "./token-endpoint.js";
import type { TokenRequestDeps } from "./token-endpoint.js";
import type { OAuthClient, OAuthResource } from "./ports.js";
import { OAuthError } from "./errors.js";
import type { OAuthTokenSet, TokenRefreshPort, OAuthSleep } from "./ports.js";
const DEFAULT_REFRESH_SKEW_MS = 120000;
const DEFAULT_LEASE_WAIT_MS = 5000;
const DEFAULT_LEASE_POLL_MS = 250;
export type { TokenRefreshPort } from "./ports.js";
export interface TokenRefresherDeps {
    readonly clock: Clock;
    readonly port: TokenRefreshPort;
    readonly refreshSkewMs?: number;
    readonly leaseWaitMs?: number;
    readonly leasePollMs?: number;
    readonly sleep: OAuthSleep;
}
export interface TokenRefresher {
    getAccessToken(requiredArgs: {
        readonly key: string;
    }): Promise<string>;
    inFlightCount(requiredArgs: OAuthEmptyArgs): number;
}
function needsReauthError(reason: string, options: {
    readonly cause?: unknown;
} = {}): OAuthError {
    return new OAuthError({
        code: "OAUTH_INVALID_GRANT", message: `this connection needs to be re-authorized (${reason})`,
        operatorAction: "Reconnect this server in the connection settings."
    }, {
        cause: options.cause
    });
}
export function isTokenDueForRefresh({ tokens, nowIso, skewMs }: {
    readonly tokens: OAuthTokenSet;
    readonly nowIso: string;
    readonly skewMs: number;
}): boolean {
    if (tokens.expiresAt === null)
        return false;
    return Date.parse(tokens.expiresAt) - skewMs <= Date.parse(nowIso);
}
function isHardExpired(tokens: OAuthTokenSet, nowIso: string): boolean {
    return tokens.expiresAt !== null && Date.parse(tokens.expiresAt) <= Date.parse(nowIso);
}
export function createTokenRefresher(deps: OAuthRequiredArgs<TokenRefresherDeps>, optionalArgs: OAuthOptionalArgs<TokenRefresherDeps> = {}): TokenRefresher {
    const skewMs = optionalArgs.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
    const leaseWaitMs = optionalArgs.leaseWaitMs ?? DEFAULT_LEASE_WAIT_MS;
    const leasePollMs = optionalArgs.leasePollMs ?? DEFAULT_LEASE_POLL_MS;
    const sleep = deps.sleep;
    const inFlight = new Map<string, Promise<string>>();
    // Preserve the terminal OAuth signal if the durable status write itself fails.
    const markNeedsReauthBestEffort = async (key: string, reason: string): Promise<unknown> => {
        try {
            await deps.port.markNeedsReauth({
                key: key,
                reason: reason
            });
            return undefined;
        }
        catch (error) {
            return error;
        }
    };
    const performRefresh = async (key: string, current: OAuthTokenSet): Promise<string> => {
        if (current.refreshToken === null) {
            const reason = isHardExpired(current, readNowIso({ clock: deps.clock }))
                ? "the provider issued no refresh token and the access token has expired"
                : "the provider issued no refresh token and the access token is due for refresh";
            const writeFailure = await markNeedsReauthBestEffort(key, reason);
            throw needsReauthError("no refresh token", { cause: writeFailure });
        }
        let rotated: OAuthTokenSet;
        try {
            rotated = await deps.port.refresh({
                key: key,
                refreshToken: current.refreshToken
            });
        }
        catch (error) {
            const terminal = error instanceof OAuthError && (error.code === "OAUTH_INVALID_GRANT" || error.code === "OAUTH_ACCESS_DENIED");
            if (terminal) {
                const reason = "the provider rejected the stored refresh token";
                const writeFailure = await markNeedsReauthBestEffort(key, reason);
                throw needsReauthError(reason, { cause: writeFailure });
            }
            throw error;
        }
        // Never hand out a rotated token before storage knows its new refresh token.
        await deps.port.persist({
            key: key,
            tokens: rotated
        });
        return rotated.accessToken;
    };
    const awaitLeaseHolder = async (key: string, current: OAuthTokenSet): Promise<string> => {
        const deadline = Date.parse(readNowIso({ clock: deps.clock })) + leaseWaitMs;
        for (;;) {
            await sleep({
                ms: leasePollMs
            });
            const reloaded = await deps.port.load({
                key: key
            });
            const nowIso = readNowIso({ clock: deps.clock });
            if (reloaded && !isTokenDueForRefresh({
                tokens: reloaded,
                nowIso: nowIso,
                skewMs: skewMs
            }))
                return reloaded.accessToken;
            if (Date.parse(nowIso) >= deadline) {
                const fallback = reloaded ?? current;
                if (!isHardExpired(fallback, nowIso))
                    return fallback.accessToken;
                throw new OAuthError({
                    code: "OAUTH_PROVIDER_UNREACHABLE", message: "another process is refreshing this connection's token and did not finish in time",
                    operatorAction: "Try again in a moment. If it keeps happening, reconnect this server in the connection settings."
                });
            }
        }
    };
    const refreshOnce = async (key: string, current: OAuthTokenSet): Promise<string> => {
        if (!deps.port.tryAcquireRefreshLease)
            return performRefresh(key, current);
        const acquired = await deps.port.tryAcquireRefreshLease({
            key: key
        });
        if (!acquired)
            return awaitLeaseHolder(key, current);
        try {
            return await performRefresh(key, current);
        }
        finally {
            await deps.port.releaseRefreshLease?.({
                key: key
            }).catch(() => undefined);
        }
    };
    return {
        async getAccessToken({ key }) {
            const current = await deps.port.load({
                key: key
            });
            if (current === null)
                throw needsReauthError("this connection holds no token");
            const nowIso = readNowIso({ clock: deps.clock });
            if (!isTokenDueForRefresh({
                tokens: current,
                nowIso: nowIso,
                skewMs: skewMs
            }))
                return current.accessToken;
            const existing = inFlight.get(key);
            if (existing)
                return existing;
            const attempt = refreshOnce(key, current).finally(() => {
                inFlight.delete(key);
            });
            inFlight.set(key, attempt);
            return attempt;
        },
        inFlightCount(_requiredArgs) {
            return inFlight.size;
        },
    };
}
/** RFC 6749 refresh grant, preserving a refresh token when the server does not rotate it.
 * Carry forward scope and resource binding so refresh cannot silently broaden authority or audience. */
export interface RefreshAccessTokenInput {
    readonly tokenEndpoint: string;
    readonly client: OAuthClient;
    readonly refreshToken: string;
    readonly scopes?: readonly string[];
    readonly resource?: OAuthResource;
    readonly timeoutMs?: number;
}
export async function refreshAccessToken(requiredArgs: OAuthRequiredArgs<TokenRequestDeps & RefreshAccessTokenInput>, optionalArgs: OAuthOptionalArgs<TokenRequestDeps & RefreshAccessTokenInput> = {}): Promise<OAuthTokenSet> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, tokenEndpoint: requiredArgs.tokenEndpoint, client: requiredArgs.client, refreshToken: requiredArgs.refreshToken };
    const tokens = await requestOAuthToken({
        ...deps,
        tokenEndpoint: input.tokenEndpoint, client: input.client,
        params: { grant_type: 'refresh_token', refresh_token: input.refreshToken,
            ...(input.scopes === undefined ? {} : { scope: input.scopes.join(' ') }) }
    }, {
        ...(input.resource === undefined ? {} : { resource: input.resource }),
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
    });
    return { ...tokens, refreshToken: tokens.refreshToken ?? input.refreshToken };
}
