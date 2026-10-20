/** RFC 7009 wire operation. Local disablement, credential deletion and retry policy belong to the host. */
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
    readonly tokenTypeHint?: OAuthTokenTypeHint;
    readonly timeoutMs?: number;
}

/** Requests revocation once using the existing client-authentication and guarded transport owners.
 * HTTP 200 confirms the RFC 7009 request, including an already invalid token; it does not establish
 * which other tokens the provider invalidated. The host must disable locally before calling this.
 * @param requiredArgs - Explicit HTTP ports, approved revocation endpoint, client and token.
 * @param optionalArgs - Token type hint and request/body deadline in milliseconds.
 * @returns Nothing after the library accepts an HTTP 200; success bodies are ignored but bounded.
 * @throws {OAuthError} For unsafe endpoints, invalid configuration, transport errors or refusal.
 * @complexity O(n + b) time and space in the request and bounded response; one HTTP call, no retries.
 * @example await revokeOAuthToken({ fetchFn, guard, revocationEndpoint, client, token }, { tokenTypeHint: 'refresh_token' })
 */
export async function revokeOAuthToken(
    requiredArgs: OAuthRequiredArgs<OAuthHttpPorts & RevokeOAuthTokenInput>,
    optionalArgs: OAuthOptionalArgs<OAuthHttpPorts & RevokeOAuthTokenInput> = {},
): Promise<void> {
    const { client, token, guard, fetchFn } = requiredArgs;
    const endpoint = assertSafeProviderEndpoint(requiredArgs.revocationEndpoint, 'revocation endpoint', guard);
    let adapterFailure: { readonly error: unknown } | undefined;
    try {
        const config = createOAuthClientConfiguration({ client, endpoint, endpointName: 'revocation_endpoint' });
        const guardedFetch = createOAuthCustomFetch({
            fetchFn, guard, timeoutMs: optionalArgs.timeoutMs ?? DEFAULT_TOKEN_REQUEST_TIMEOUT_MS,
            endpointLabel: 'revocation endpoint', responseMessages: {
                overflowMessage: `the revocation response exceeded ${MAX_OAUTH_RESPONSE_BYTES} bytes`,
                overflowOperatorAction: 'Check the provider revocation endpoint. Remote revocation was not confirmed.',
            },
        });
        // openid-client wraps customFetch failures; retain facade safety errors without retaining
        // upstream errors, which may include the submitted credential or provider response text.
        config[customFetch] = async (url, options) => {
            try { return await guardedFetch(url, options); }
            catch (error) {
                const failure = error instanceof OAuthError ? error : new OAuthError({
                    code: 'OAUTH_PROVIDER_UNREACHABLE', message: 'could not reach the token revocation endpoint',
                    operatorAction: 'Check network access to this provider. Remote revocation was not confirmed.',
                });
                adapterFailure = { error: failure };
                throw failure;
            }
        };
        await tokenRevocation(config, token, optionalArgs.tokenTypeHint === undefined
            ? undefined : { token_type_hint: optionalArgs.tokenTypeHint });
    } catch (error) {
        if (adapterFailure) throw adapterFailure.error;
        const invalidInput = error instanceof TypeError;
        throw new OAuthError({
            code: invalidInput ? 'OAUTH_INVALID_REQUEST' : 'OAUTH_PROVIDER_REJECTED',
            message: invalidInput ? 'the OAuth revocation or client configuration is invalid'
                : 'the authorization server did not confirm token revocation',
            operatorAction: invalidInput ? 'Check the client identity, authentication method and token.'
                : 'Keep this connection disabled locally and retry revocation through the connection settings.',
        });
    }
}
