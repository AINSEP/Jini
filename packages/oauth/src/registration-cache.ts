import { nowIso as readNowIso } from '@jini-ai/core/primitives';
import type { Clock } from '@jini-ai/core/primitives';
import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
import { registerOAuthClientDynamically } from './registration.js';
import type { DynamicClientRegistrationDeps, DynamicClientRegistrationInput, RegisteredOAuthClient } from './registration.js';
import type { ClientRegistrationCache } from './ports.js';
import { assertOAuthAppOptions } from './options.js';
export interface OAuthClientRegistrarDeps extends DynamicClientRegistrationDeps {
    readonly cache: ClientRegistrationCache;
    readonly clock: Clock;
}
export interface CachedRegistrationInput extends DynamicClientRegistrationInput {
    readonly issuer: string;
}
export interface OAuthClientRegistrar {
    getOrRegister(requiredArgs: OAuthRequiredArgs<CachedRegistrationInput>, optionalArgs?: OAuthOptionalArgs<CachedRegistrationInput>): Promise<RegisteredOAuthClient>;
    /** Explicit app action after a refused client; it does not retry a failed grant. */
    invalidate(requiredArgs: OAuthRequiredArgs<CachedRegistrationInput>, optionalArgs?: OAuthOptionalArgs<CachedRegistrationInput>): Promise<void>;
}
/** Cache and coalesce registration per identity. Different instances may share a durable cache. */
// Repeated connections should reuse a registered client rather than register anew on each flow.
// Include issuer and callback identity in the key: a client registered for one server or redirect
// must not be borrowed by another. Expiry and explicit invalidation permit deliberate replacement.
export function createOAuthClientRegistrar(deps: OAuthClientRegistrarDeps): OAuthClientRegistrar {
    assertOAuthAppOptions(deps.options);
    const options = structuredClone(deps.options);
    const inFlight = new Map<string, Promise<RegisteredOAuthClient>>();
    const cacheKey = (input: CachedRegistrationInput): string => JSON.stringify([
        input.issuer, input.registrationEndpoint,
        [options.clientDisplayName, options.softwareId, options.redirectUris], input.scopes,
        input.grantTypes ?? ['authorization_code', 'refresh_token'], input.responseTypes ?? ['code'],
        input.tokenEndpointAuthMethod ?? 'none', input.authMethodsSupported ?? [],
    ]);
    return {
        async getOrRegister(requiredArgs, optionalArgs = {}) {
            const input = { ...optionalArgs, issuer: requiredArgs.issuer, registrationEndpoint: requiredArgs.registrationEndpoint, scopes: requiredArgs.scopes };
            // Validate current policy even on a cache hit. A cached identity is not an egress exemption.
            deps.guard.assertSafeUrl({
                raw: input.issuer,
                label: 'authorization server issuer'
            });
            deps.guard.assertSafeUrl({
                raw: input.registrationEndpoint,
                label: 'registration endpoint'
            });
            const key = cacheKey(input);
            const existing = inFlight.get(key);
            if (existing)
                return structuredClone(await existing);
            const attempt = (async () => {
                const cached = await deps.cache.get({
                    key: key
                });
                const expiry = cached?.clientSecretExpiresAt;
                if (cached && (expiry === null || expiry === 0 || expiry! * 1000 > Date.parse(readNowIso({ clock: deps.clock })))) {
                    return cached;
                }
                const registered = await registerOAuthClientDynamically({
                    ...deps, options,
                    registrationEndpoint: input.registrationEndpoint,
                    scopes: input.scopes
                }, optionalArgs);
                // Complete persistence before returning a client whose secret may be needed on another process.
                await deps.cache.set({
                    key: key,
                    client: registered
                });
                return registered;
            })().finally(() => { inFlight.delete(key); });
            inFlight.set(key, attempt);
            return structuredClone(await attempt);
        },
        async invalidate(requiredArgs, optionalArgs = {}) {
            const input = { ...optionalArgs, issuer: requiredArgs.issuer, registrationEndpoint: requiredArgs.registrationEndpoint, scopes: requiredArgs.scopes };
            const key = cacheKey(input);
            // Wait for an outstanding registration write so it cannot resurrect an invalidated client.
            await inFlight.get(key)?.catch(() => undefined);
            await deps.cache.delete({
                key: key
            });
        },
    };
}
