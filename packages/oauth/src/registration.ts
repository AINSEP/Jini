import { defaultOAuthMessages, type OAuthMessages } from './messages.js';
import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
import {
    dynamicClientRegistrationRequest, processDynamicClientRegistrationResponse,
    customFetch, allowInsecureRequests, ResponseBodyError, OperationProcessingError, RESPONSE_IS_NOT_CONFORM,
} from 'oauth4webapi';
/** One-attempt RFC 7591 registration. Public clients use PKCE; a volunteered secret is returned for the application to protect. */
import { assertOAuthAppOptions } from "./options.js";
import { MAX_OAUTH_RESPONSE_BYTES, readOptionalString } from "./bounded-json.js";
import { assertSafeProviderEndpoint } from "./endpoint-safety.js";
import { adaptOAuthResponse, OAuthError } from "./errors.js";
import type { OAuthClientAuthMethod, OAuthHttpPorts, OAuthAppOptions, RegisteredOAuthClient } from "./ports.js";
import { createOAuthCustomFetch } from './guarded-transport.js';
export type { RegisteredOAuthClient } from "./ports.js";
const DEFAULT_REGISTRATION_TIMEOUT_MS = 15000;
const SUPPORTED_AUTH_METHODS: readonly OAuthClientAuthMethod[] = ["none", "client_secret_post", "client_secret_basic"];
export interface DynamicClientRegistrationDeps extends OAuthHttpPorts {
    readonly options: OAuthAppOptions;
}
export interface DynamicClientRegistrationInput {
    readonly messages?: OAuthMessages;
    readonly registrationEndpoint: string;
    readonly scopes: readonly string[];
    readonly grantTypes?: readonly string[];
    readonly responseTypes?: readonly string[];
    readonly tokenEndpointAuthMethod?: OAuthClientAuthMethod;
    readonly authMethodsSupported?: readonly string[];
    readonly initialAccessToken?: string;
    readonly timeoutMs?: number;
}
function readOptionalNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function resolveAuthMethod({ document }: { document: Record<string, unknown> },
    input: Pick<DynamicClientRegistrationInput, "tokenEndpointAuthMethod" | "authMethodsSupported"> = {}): OAuthClientAuthMethod {
    const requested = input.tokenEndpointAuthMethod ?? 'none';
    const echoed = SUPPORTED_AUTH_METHODS.find(method => method === readOptionalString(document.token_endpoint_auth_method));
    if (echoed) return echoed;
    if (requested !== 'none' || readOptionalString(document.client_secret) === null) return requested;
    const supported = input.authMethodsSupported ?? [];
    if (supported.length === 0 || supported.includes('client_secret_basic')) return 'client_secret_basic';
    return supported.includes('client_secret_post') ? 'client_secret_post' : requested;
}
/** Endpoint-only RFC 7591: openid-client's registration adds discovery, violating one-attempt
 * semantics here. Its engine owns the request/response; the host retains identity, auth policy and cache.
 */
export async function registerOAuthClientDynamically(requiredArgs: OAuthRequiredArgs<DynamicClientRegistrationDeps & DynamicClientRegistrationInput>, optionalArgs: OAuthOptionalArgs<DynamicClientRegistrationDeps & DynamicClientRegistrationInput> = {}): Promise<RegisteredOAuthClient> {
    assertOAuthAppOptions(requiredArgs.options);
    const input = { ...optionalArgs, ...requiredArgs };
    const endpoint = assertSafeProviderEndpoint(input.registrationEndpoint, 'registration endpoint', input.guard);
    const guardedFetch = createOAuthCustomFetch({
        ...requiredArgs, timeoutMs: optionalArgs.timeoutMs ?? DEFAULT_REGISTRATION_TIMEOUT_MS,
        endpointLabel: 'registration endpoint', responseMessages: {
            overflowMessage: `the client registration response exceeded ${MAX_OAUTH_RESPONSE_BYTES} bytes`,
            overflowOperatorAction: "This server's dynamic client registration endpoint is not behaving like an RFC 7591 endpoint.",
        },
    }, { unreachable: {
        message: `could not reach the client registration endpoint at ${endpoint.host}`,
        operatorAction: 'Check network access to this server, then try connecting again. Nothing was retried automatically.' } });
    try {
        // This opaque issuer is transport metadata, never a trusted identity or discovery URL.
        const response = await dynamicClientRegistrationRequest({
            issuer: 'urn:jini:oauth:transport-only', registration_endpoint: endpoint.href,
        }, registrationMetadata({ input }), {
            ...(input.initialAccessToken === undefined ? {} : { initialAccessToken: input.initialAccessToken }),
            [allowInsecureRequests]: endpoint.protocol === 'http:', [customFetch]: async (url, options) => adaptOAuthResponse({ response: await guardedFetch(url, options) }, { successStatus: 201 }),
        });
        const client = await processDynamicClientRegistrationResponse(response);
        return projectRegisteredClient({ client, input });
    } catch (error) {
        if (guardedFetch.failure) throw guardedFetch.failure.error;
        throw registrationError({ error, status: guardedFetch.status }, optionalArgs);
    }
}

/** Preserve registration response narrowing and auth-policy fallback. */
function projectRegisteredClient({ client, input }: {
    client: Record<string, unknown>; input: DynamicClientRegistrationInput;
}): RegisteredOAuthClient {
    const clientId = readOptionalString(client.client_id);
    if (clientId === null) throw new OAuthError({ code: 'OAUTH_MALFORMED_RESPONSE',
        message: 'the client registration response contained no client id',
        operatorAction: "This server's dynamic client registration endpoint is not behaving like an RFC 7591 endpoint." });
    return {
        clientId, clientSecret: readOptionalString(client.client_secret),
        tokenEndpointAuthMethod: resolveAuthMethod({ document: client }, input),
        registrationClientUri: readOptionalString(client.registration_client_uri),
        clientIdIssuedAt: readOptionalNumber(client.client_id_issued_at),
        clientSecretExpiresAt: readOptionalNumber(client.client_secret_expires_at),
    };
}

function registrationMetadata({ input }: { input: DynamicClientRegistrationDeps & DynamicClientRegistrationInput }) {
    return {
        client_name: input.options.clientDisplayName, software_id: input.options.softwareId,
        redirect_uris: [...input.options.redirectUris],
        grant_types: [...(input.grantTypes ?? ['authorization_code', 'refresh_token'])],
        response_types: [...(input.responseTypes ?? ['code'])],
        token_endpoint_auth_method: input.tokenEndpointAuthMethod ?? 'none', application_type: 'web',
        ...(input.scopes.length === 0 ? {} : { scope: input.scopes.join(' ') }),
    };
}

/** Transport failure precedence remains in the caller; protocol failures retain facade text. */
function registrationError({ error, status }: { error: unknown; status: number | undefined },
    optionalArgs: Pick<DynamicClientRegistrationInput, 'messages'> = {}): OAuthError {
    if (error instanceof OAuthError) return error;
    if (error instanceof ResponseBodyError) {
        return new OAuthError({
            code: 'OAUTH_PROVIDER_REJECTED',
            message: `the authorization server refused the client registration (HTTP ${status}, ${error.error})`,
            operatorAction: (optionalArgs.messages ?? defaultOAuthMessages).registrationRejectedAction,
        }, { providerErrorCode: error.error });
    }
    if (error instanceof OperationProcessingError && error.code === RESPONSE_IS_NOT_CONFORM) {
        return new OAuthError({ code: 'OAUTH_PROVIDER_REJECTED',
            message: `the authorization server refused the client registration (HTTP ${status})`,
            operatorAction: (optionalArgs.messages ?? defaultOAuthMessages).registrationRejectedAction });
    }
    return malformedRegistrationError({ error });
}
function malformedRegistrationError({ error }: { error: unknown }): OAuthError {
    const invalidInput = error instanceof TypeError;
    const missingId = error instanceof Error && error.message.includes('"client_id"');
    return new OAuthError({
        code: invalidInput ? 'OAUTH_INVALID_REQUEST' : 'OAUTH_MALFORMED_RESPONSE',
        message: invalidInput ? 'the OAuth client registration configuration is invalid'
            : missingId ? 'the client registration response contained no client id' : 'the client registration endpoint did not return a JSON object',
        operatorAction: invalidInput ? "Check this provider's registration endpoint and initial access token."
            : "This server's dynamic client registration endpoint is not behaving like an RFC 7591 endpoint.",
    });
}
