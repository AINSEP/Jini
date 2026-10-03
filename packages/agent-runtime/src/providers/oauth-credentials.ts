/**
 * @module providers/oauth-credentials
 *
 * Runtime credential resolver on top of `oauth-tokens.ts` +
 * `oauth-provider.ts`: returns a fresh access token, automatically
 * refreshing in place when the stored token is within the expiry skew
 * window. Ported from OD's `integrations/xai-credentials.ts`, generalized
 * to any {@link OAuthPkceProviderConfig} (the origin's `resolveXAIBearer`
 * hardcoded the xAI refresh call and the `xai-tokens.json` filename).
 *
 * Refresh-on-read (lazy) is sufficient because OAuth bearer tokens are
 * typically short-lived — every active call site naturally sees expiry
 * often enough that a separate background refresher isn't needed.
 */
import { refreshOAuthPkceToken, type OAuthPkceProviderConfig } from './oauth-provider.js';
import {
  getStoredOAuthToken,
  isOAuthTokenExpired,
  setStoredOAuthToken,
  type StoredOAuthToken,
} from './oauth-tokens.js';

export interface ResolvedOAuthCredential {
  accessToken: string;
  /** Whether this came back unchanged from disk or was refreshed inline. */
  source: 'stored' | 'refreshed';
}

/**
 * Gets a usable bearer token for `config`'s provider, refreshing in place if
 * the stored token is within the expiry skew window. Returns null when
 * nothing is stored, the stored token has no refresh_token to renew with, or
 * the refresh call fails. Callers should treat null as "no OAuth available,
 * fall back to API key / re-login UI".
 */
export async function resolveOAuthBearer({ config, tokenFileName, dataDir }: { config: OAuthPkceProviderConfig; tokenFileName: string; dataDir: string }, { fetchImpl }: { fetchImpl?: typeof fetch } = {}
): Promise<ResolvedOAuthCredential | null> {
  const stored = await getStoredOAuthToken({ dataDir: dataDir, fileName: tokenFileName });
  if (!stored) return null;
  if (!isOAuthTokenExpired({ token: stored })) {
    return { accessToken: stored.accessToken, source: 'stored' };
  }

  // Within skew window — try a refresh. If there's no refresh_token (some
  // auth servers don't issue one) the caller has to re-login; recovery
  // isn't possible here.
  if (!stored.refreshToken) return null;

  try {
    const fresh = await (({ config, refreshToken, ...optionalArgs }: Parameters<typeof refreshOAuthPkceToken>[0] & NonNullable<Parameters<typeof refreshOAuthPkceToken>[1]>) => refreshOAuthPkceToken({ config, refreshToken }, optionalArgs))({
      config,
      refreshToken: stored.refreshToken,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    const next: StoredOAuthToken = {
      accessToken: fresh.access_token,
      tokenType: fresh.token_type ?? 'Bearer',
      savedAt: Date.now(),
    };
    // Preserves the existing refresh_token when the token endpoint omits
    // one in its response. RFC 6749 §6 lets a server skip refresh_token
    // rotation and keep the old one valid; dropping it here would leave the
    // next expiry with nothing to refresh against, forcing the user back
    // through a full sign-in even though their grant is still good.
    const carriedRefresh = fresh.refresh_token ?? stored.refreshToken;
    if (carriedRefresh) next.refreshToken = carriedRefresh;
    if (typeof fresh.expires_in === 'number') {
      next.expiresAt = Date.now() + fresh.expires_in * 1000;
    }
    if (fresh.scope) next.scope = fresh.scope;
    await setStoredOAuthToken({ dataDir: dataDir, fileName: tokenFileName, token: next });
    return { accessToken: next.accessToken, source: 'refreshed' };
  } catch {
    // Refresh failed (network blip, revoked refresh_token, server error).
    // Return null so the caller falls through to API-key resolution and
    // surfaces a re-login prompt if everything is empty.
    return null;
  }
}
