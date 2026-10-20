import { defaultOAuthMessages, type OAuthMessages } from './messages.js';
import type { OAuthRequiredArgs, OAuthOptionalArgs, OAuthEmptyArgs } from './args.js';
import {
    dynamicClientRegistrationRequest, processDynamicClientRegistrationResponse,
    customFetch, allowInsecureRequests, type Client,
} from 'oauth4webapi';
/** One-attempt RFC 7591 registration. Public clients use PKCE; a volunteered secret is returned for the application to protect. */
import { assertOAuthAppOptions } from "./options.js";
import { MAX_OAUTH_RESPONSE_BYTES, parseOAuthJsonObject, readOptionalString } from "./bounded-json.js";
import { assertSafeProviderEndpoint } from "./endpoint-safety.js";
import { OAuthError } from "./errors.js";
import type { OAuthClientAuthMethod, OAuthHttpPorts, OAuthAppOptions, RegisteredOAuthClient } from "./ports.js";
import { createOAuthCustomFetch } from './guarded-transport.js';
export type { RegisteredOAuthClient } from "./ports.js";
const DEFAULT_REGISTRATION_TIMEOUT_MS = 15000;
const REGISTRATION_MESSAGES = {
    overflowMessage: `the client registration response exceeded ${MAX_OAUTH_RESPONSE_BYTES} bytes`,
    overflowOperatorAction: "This server's dynamic client registration endpoint is not behaving like an RFC 7591 endpoint.",
    notJsonMessage: "the client registration endpoint did not return a JSON object",
    notJsonOperatorAction: "This server's dynamic client registration endpoint is not behaving like an RFC 7591 endpoint.",
} as const;
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
function buildClientMetadata(input: DynamicClientRegistrationInput, options: OAuthAppOptions): Partial<Client> {
    const scope = input.scopes.join(" ");
    return {
        client_name: options.clientDisplayName,
        software_id: options.softwareId,
        redirect_uris: [...options.redirectUris],
        grant_types: [...(input.grantTypes ?? ["authorization_code", "refresh_token"])],
        response_types: [...(input.responseTypes ?? ["code"])],
        token_endpoint_auth_method: input.tokenEndpointAuthMethod ?? "none",
        application_type: "web",
        ...(scope === "" ? {} : { scope }),
    };
}
function readOptionalNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function resolveAuthMethod({ document }: { document: Record<string, unknown> },
    input: Pick<DynamicClientRegistrationInput, "tokenEndpointAuthMethod" | "authMethodsSupported"> = {}): OAuthClientAuthMethod {
    const requested = input.tokenEndpointAuthMethod ?? "none";
    const supported = input.authMethodsSupported ?? [];
    const echoed = readOptionalString(document.token_endpoint_auth_method);
    if (SUPPORTED_AUTH_METHODS.includes(echoed as OAuthClientAuthMethod))
        return echoed as OAuthClientAuthMethod;
    if (requested !== "none" || readOptionalString(document.client_secret) === null)
        return requested;
    return pickSecretAuthMethod(supported) ?? requested;
}
function pickSecretAuthMethod(supported: readonly string[]): OAuthClientAuthMethod | null {
    if (supported.length === 0 || supported.includes("client_secret_basic"))
        return "client_secret_basic";
    return supported.includes("client_secret_post") ? "client_secret_post" : null;
}
function toRegistrationError(document: Record<string, unknown>, httpStatus: number, messages: OAuthMessages): OAuthError {
    const providerErrorCode = readOptionalString(document.error);
    return new OAuthError({
        code: "OAUTH_PROVIDER_REJECTED", message: `the authorization server refused the client registration (HTTP ${httpStatus}${providerErrorCode === null ? "" : `, ${providerErrorCode}`})`,
        operatorAction: messages.registrationRejectedAction
    }, {
        ...(providerErrorCode === null ? {} : { providerErrorCode })
    });
}
/** Sends endpoint-only RFC 7591 registration through the shared guarded transport.
 * openid-client.dynamicClientRegistration always discovers an issuer first. This public facade
 * has only a registration endpoint and promises one attempt, so use its engine's endpoint-only
 * operation rather than inventing discovery or adding another network request.
 * @returns A bounded response for facade error handling and upstream protocol processing.
 * @throws {OAuthError} For unsafe endpoints, invalid input, transport failure or oversized bodies.
 * @complexity O(n + b) time and space in client metadata and bounded response; one HTTP request.
 */
async function postClientRegistration({ deps, input, endpoint }: {
    readonly deps: DynamicClientRegistrationDeps; readonly input: DynamicClientRegistrationInput; readonly endpoint: URL;
}, _optionalArgs: OAuthEmptyArgs = {}): Promise<Response> {
    const guardedFetch = createOAuthCustomFetch({
        guard: deps.guard, timeoutMs: input.timeoutMs ?? DEFAULT_REGISTRATION_TIMEOUT_MS,
        endpointLabel: 'registration endpoint', responseMessages: REGISTRATION_MESSAGES,
        fetchFn: async (args, options) => {
            try { return await deps.fetchFn(args, options); }
            catch (cause) {
                throw new OAuthError({
                    code: 'OAUTH_PROVIDER_UNREACHABLE', message: `could not reach the client registration endpoint at ${endpoint.host}`,
                    operatorAction: 'Check network access to this server, then try connecting again. Nothing was retried automatically.',
                }, { cause });
            }
        },
    });
    let adapterFailure: { readonly error: unknown } | undefined;
    try {
        // This opaque issuer is transport-only metadata, not a trusted identity or a discovery URL.
        return await dynamicClientRegistrationRequest({
            issuer: 'urn:jini:oauth:transport-only', registration_endpoint: endpoint.href,
        }, buildClientMetadata(input, deps.options), {
            ...(input.initialAccessToken === undefined ? {} : { initialAccessToken: input.initialAccessToken }),
            [allowInsecureRequests]: endpoint.protocol === 'http:',
            [customFetch]: async (url, options) => {
                try {
                    // The engine omits a falsy initial token; preserve the facade's explicitly
                    // supplied empty Bearer header instead of silently changing that input.
                    const headers = input.initialAccessToken === ''
                        ? { ...options.headers, authorization: 'Bearer ' } : options.headers;
                    return await guardedFetch(url, { ...options, headers });
                }
                catch (error) { adapterFailure = { error }; throw error; }
            },
        });
    } catch {
        if (adapterFailure) throw adapterFailure.error;
        // Do not expose upstream causes: they can include registration credentials/metadata.
        throw new OAuthError({
            code: 'OAUTH_INVALID_REQUEST', message: 'the OAuth client registration configuration is invalid',
            operatorAction: 'Check this provider\'s registration endpoint and initial access token.',
        });
    }
}

/** Registers once and preserves facade normalization, auth-method policy and error copy.
 * Public clients use PKCE; a volunteered secret is returned for the application to protect.
 * @returns Registration values ready for the existing host-owned cache and secret storage.
 * @throws {OAuthError} For unsafe endpoints, invalid configuration, provider refusal or malformed JSON.
 * @complexity O(n + b) time and space in metadata and bounded response; exactly one HTTP request.
 * @example registerOAuthClientDynamically({ fetchFn, guard, options, registrationEndpoint, scopes: [] })
 */
export async function registerOAuthClientDynamically(requiredArgs: OAuthRequiredArgs<DynamicClientRegistrationDeps & DynamicClientRegistrationInput>, optionalArgs: OAuthOptionalArgs<DynamicClientRegistrationDeps & DynamicClientRegistrationInput> = {}): Promise<RegisteredOAuthClient> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, registrationEndpoint: requiredArgs.registrationEndpoint, scopes: requiredArgs.scopes };
    assertOAuthAppOptions(deps.options);
    const endpoint = assertSafeProviderEndpoint(input.registrationEndpoint, "registration endpoint", deps.guard);
    const response = await postClientRegistration({ deps, input, endpoint });
    const document = parseOAuthJsonObject(await response.text(), REGISTRATION_MESSAGES);
    if (typeof document.error === "string" || !response.ok)
        throw toRegistrationError(document, response.status, optionalArgs.messages ?? defaultOAuthMessages);
    const clientId = readOptionalString(document.client_id);
    if (clientId === null) {
        throw new OAuthError({
            code: "OAUTH_MALFORMED_RESPONSE", message: "the client registration response contained no client id",
            operatorAction: "This server's dynamic client registration endpoint is not behaving like an RFC 7591 endpoint."
        });
    }
    const clientSecret = readOptionalString(document.client_secret);
    let registered: Awaited<ReturnType<typeof processDynamicClientRegistrationResponse>>;
    try {
        // Preserve successful 2xx, optional/trimmed secrets and nullable timestamp fields.
        // Upstream requires 201 and an expiry for every secret; its 0 means no declared expiry.
        // The original timestamps below remain authoritative, including negative (expired) values,
        // so this compatibility projection can never turn an expired cached secret into a live one.
        registered = await processDynamicClientRegistrationResponse(Response.json({
            ...document, client_id: clientId, client_secret: clientSecret ?? undefined,
            ...(clientSecret === null ? {} : { client_secret_expires_at: Math.max(readOptionalNumber(document.client_secret_expires_at) ?? 0, 0) }),
        }, { status: 201 }));
    } catch {
        throw new OAuthError({
            code: 'OAUTH_MALFORMED_RESPONSE', message: REGISTRATION_MESSAGES.notJsonMessage,
            operatorAction: REGISTRATION_MESSAGES.notJsonOperatorAction,
        });
    }
    return {
        clientId: registered.client_id,
        clientSecret: readOptionalString(registered.client_secret),
        tokenEndpointAuthMethod: resolveAuthMethod({ document }, input),
        registrationClientUri: readOptionalString(document.registration_client_uri),
        clientIdIssuedAt: readOptionalNumber(document.client_id_issued_at),
        clientSecretExpiresAt: readOptionalNumber(document.client_secret_expires_at),
    };
}
