import type { TokenRefresherDeps, TokenRefresher, RefreshAccessTokenInput } from '@jini-ai/core/contracts/oauth';
export type { TokenRefresherDeps, TokenRefresher, RefreshAccessTokenInput } from '@jini-ai/core/contracts/oauth';
import { nowIso as readNowIso } from '@jini-ai/core/primitives';
import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
/** Refresh grant and token coordinator. Coalesce in-process calls, honor optional storage leases, and persist rotation before returning access tokens. */
import { requestOAuthToken } from "./token-endpoint.js";
import type { TokenRequestDeps } from "./token-endpoint.js";
import { OAuthError } from "./errors.js";
import type { OAuthTokenSet } from "./ports.js";
const DEFAULT_REFRESH_SKEW_MS = 120000;
const DEFAULT_LEASE_WAIT_MS = 5000;
const DEFAULT_LEASE_POLL_MS = 250;
export type { TokenRefreshPort } from "./ports.js";
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
interface RefreshCtx {
    readonly deps: OAuthRequiredArgs<TokenRefresherDeps>;
    readonly skewMs: number;
    readonly leaseWaitMs: number;
    readonly leasePollMs: number;
}
// Preserve the terminal OAuth signal if the durable status write itself fails.
async function markNeedsReauthBestEffort(ctx: RefreshCtx, key: string, reason: string): Promise<unknown> {
    try {
        await ctx.deps.port.markNeedsReauth({
            key: key,
            reason: reason
        });
        return undefined;
    }
    catch (error) {
        return error;
    }
}
async function failMissingRefreshToken(ctx: RefreshCtx, key: string, current: OAuthTokenSet): Promise<never> {
    const reason = isHardExpired(current, readNowIso({ clock: ctx.deps.clock }))
        ? "the provider issued no refresh token and the access token has expired"
        : "the provider issued no refresh token and the access token is due for refresh";
    const writeFailure = await markNeedsReauthBestEffort(ctx, key, reason);
    throw needsReauthError("no refresh token", { cause: writeFailure });
}
async function redeemRefreshToken(ctx: RefreshCtx, key: string, refreshToken: string): Promise<OAuthTokenSet> {
    try {
        return await ctx.deps.port.refresh({
            key: key,
            refreshToken: refreshToken
        });
    }
    catch (error) {
        const terminal = error instanceof OAuthError && (error.code === "OAUTH_INVALID_GRANT" || error.code === "OAUTH_ACCESS_DENIED");
        if (terminal) {
            const reason = "the provider rejected the stored refresh token";
            const writeFailure = await markNeedsReauthBestEffort(ctx, key, reason);
            throw needsReauthError(reason, { cause: writeFailure });
        }
        throw error;
    }
}
async function performRefresh(ctx: RefreshCtx, key: string, current: OAuthTokenSet): Promise<string> {
    if (current.refreshToken === null)
        return failMissingRefreshToken(ctx, key, current);
    const rotated = await redeemRefreshToken(ctx, key, current.refreshToken);
    // Never hand out a rotated token before storage knows its new refresh token.
    await ctx.deps.port.persist({
        key: key,
        tokens: rotated
    });
    return rotated.accessToken;
}
function leaseWaitTimeoutError(): OAuthError {
    return new OAuthError({
        code: "OAUTH_PROVIDER_UNREACHABLE", message: "another process is refreshing this connection's token and did not finish in time",
        operatorAction: "Try again in a moment. If it keeps happening, reconnect this server in the connection settings."
    });
}
/** Poll durable storage without redeeming another holder's token; deletion requires reauthorization. */
async function awaitLeaseHolder(ctx: RefreshCtx, { key }: { readonly key: string }): Promise<string> {
    const { deps } = ctx;
    const deadline = Date.parse(readNowIso({ clock: deps.clock })) + ctx.leaseWaitMs;
    for (;;) {
        await deps.sleep({
            ms: ctx.leasePollMs
        });
        const reloaded = await deps.port.load({
            key: key
        });
        if (reloaded === null)
            throw needsReauthError("this connection holds no token");
        const nowIso = readNowIso({ clock: deps.clock });
        if (!isTokenDueForRefresh({
            tokens: reloaded,
            nowIso: nowIso,
            skewMs: ctx.skewMs
        }))
            return reloaded.accessToken;
        if (Date.parse(nowIso) >= deadline) {
            if (!isHardExpired(reloaded, nowIso))
                return reloaded.accessToken;
            throw leaseWaitTimeoutError();
        }
    }
}
async function refreshUnderLease(ctx: RefreshCtx, key: string): Promise<string> {
    // Another holder may have rotated or cleared the token after our initial load.
    const reloaded = await ctx.deps.port.load({ key });
    if (reloaded === null)
        throw needsReauthError("this connection holds no token");
    if (!isTokenDueForRefresh({
        tokens: reloaded,
        nowIso: readNowIso({ clock: ctx.deps.clock }),
        skewMs: ctx.skewMs
    }))
        return reloaded.accessToken;
    return await performRefresh(ctx, key, reloaded);
}
async function refreshOnce(ctx: RefreshCtx, key: string, current: OAuthTokenSet): Promise<string> {
    const { port } = ctx.deps;
    if (!port.tryAcquireRefreshLease)
        return performRefresh(ctx, key, current);
    const acquired = await port.tryAcquireRefreshLease({
        key: key
    });
    if (!acquired)
        return awaitLeaseHolder(ctx, { key });
    try {
        return await refreshUnderLease(ctx, key);
    }
    finally {
        await port.releaseRefreshLease?.({
            key: key
        }).catch(() => undefined);
    }
}
async function getAccessTokenCoalesced(ctx: RefreshCtx, inFlight: Map<string, Promise<string>>, key: string): Promise<string> {
    const current = await ctx.deps.port.load({
        key: key
    });
    if (current === null)
        throw needsReauthError("this connection holds no token");
    const nowIso = readNowIso({ clock: ctx.deps.clock });
    if (!isTokenDueForRefresh({
        tokens: current,
        nowIso: nowIso,
        skewMs: ctx.skewMs
    }))
        return current.accessToken;
    const existing = inFlight.get(key);
    if (existing)
        return existing;
    const attempt = refreshOnce(ctx, key, current).finally(() => {
        inFlight.delete(key);
    });
    inFlight.set(key, attempt);
    return attempt;
}
export function createTokenRefresher(deps: OAuthRequiredArgs<TokenRefresherDeps>, optionalArgs: OAuthOptionalArgs<TokenRefresherDeps> = {}): TokenRefresher {
    const ctx: RefreshCtx = {
        deps,
        skewMs: optionalArgs.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS,
        leaseWaitMs: optionalArgs.leaseWaitMs ?? DEFAULT_LEASE_WAIT_MS,
        leasePollMs: optionalArgs.leasePollMs ?? DEFAULT_LEASE_POLL_MS,
    };
    const inFlight = new Map<string, Promise<string>>();
    return {
        getAccessToken: ({ key }) => getAccessTokenCoalesced(ctx, inFlight, key),
        inFlightCount(_requiredArgs) {
            return inFlight.size;
        },
    };
}
/** RFC 6749 refresh grant, preserving a refresh token when the server does not rotate it.
 * Carry forward scope and resource binding so refresh cannot silently broaden authority or audience.
 * The shared token endpoint dispatches refresh_token through openid-client's refreshTokenGrant;
 * single-flight, leases and persist-before-return remain exclusively in createTokenRefresher. */
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
