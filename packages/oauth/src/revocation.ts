import { customFetch, tokenRevocation } from 'openid-client';
import type { OAuthOptionalArgs, OAuthRequiredArgs } from './args.js';
import { MAX_OAUTH_RESPONSE_BYTES } from './bounded-json.js';
import { assertSafeProviderEndpoint } from './endpoint-safety.js';
import { OAuthError } from './errors.js';
import { createOAuthCustomFetch } from './guarded-transport.js';
import type { OAuthClient, OAuthHttpPorts, OAuthTokenTypeHint } from './ports.js';
import { createOAuthClientConfiguration, DEFAULT_TOKEN_REQUEST_TIMEOUT_MS } from './token-endpoint.js';

export interface RevokeOAuthTokenInput {
    readonly revocationEndpoint: string;
    readonly client: OAuthClient;
    readonly token: string;
    readonly tokenTypeHint?: OAuthTokenTypeHint; readonly timeoutMs?: number;
}

/** HTTP 200 confirms only the RFC 7009 request, including an already invalid token.
 * The host must disable locally before calling; it owns credential deletion and retry policy.
 */
export async function revokeOAuthToken(requiredArgs: OAuthRequiredArgs<OAuthHttpPorts & RevokeOAuthTokenInput>,
    optionalArgs: OAuthOptionalArgs<OAuthHttpPorts & RevokeOAuthTokenInput> = {}): Promise<void> {
    const { client, token, guard, fetchFn } = requiredArgs;
    const endpoint = assertSafeProviderEndpoint(requiredArgs.revocationEndpoint, 'revocation endpoint', guard);
    const guardedFetch = createOAuthCustomFetch({
        fetchFn, guard, timeoutMs: optionalArgs.timeoutMs ?? DEFAULT_TOKEN_REQUEST_TIMEOUT_MS,
        endpointLabel: 'revocation endpoint', responseMessages: {
            overflowMessage: `the revocation response exceeded ${MAX_OAUTH_RESPONSE_BYTES} bytes`,
            overflowOperatorAction: 'Check the provider revocation endpoint. Remote revocation was not confirmed.',
        },
    }, { unreachable: { preserveCause: false,
        message: 'could not reach the token revocation endpoint',
        operatorAction: 'Check network access to this provider. Remote revocation was not confirmed.' } });
    try {
        const config = createOAuthClientConfiguration({ client, endpoint, endpointName: 'revocation_endpoint' });
        config[customFetch] = guardedFetch;
        await tokenRevocation(config, token, optionalArgs.tokenTypeHint === undefined
            ? undefined : { token_type_hint: optionalArgs.tokenTypeHint });
    } catch (error) {
        if (guardedFetch.failure) throw guardedFetch.failure.error;
        const invalidInput = error instanceof TypeError;
        throw new OAuthError({ code: invalidInput ? 'OAUTH_INVALID_REQUEST' : 'OAUTH_PROVIDER_REJECTED',
            message: invalidInput ? 'the OAuth revocation or client configuration is invalid'
                : 'the authorization server did not confirm token revocation',
            operatorAction: invalidInput ? 'Check the client identity, authentication method and token.'
                : 'Keep this connection disabled locally and retry revocation through the connection settings.' });
    }
}
