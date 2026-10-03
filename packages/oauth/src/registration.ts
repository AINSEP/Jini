import { defaultOAuthMessages, type OAuthMessages } from './messages.js';
import type { OAuthRequiredArgs, OAuthOptionalArgs } from './args.js';
/** One-attempt RFC 7591 registration. Public clients use PKCE; a volunteered secret is returned for the application to protect. */
import { assertOAuthAppOptions } from "./options.js";
import { MAX_OAUTH_RESPONSE_BYTES, readBoundedOAuthJson, readOptionalString } from "./bounded-json.js";
import { assertSafeProviderEndpoint } from "./endpoint-safety.js";
import { OAuthError } from "./errors.js";
import type { OAuthClientAuthMethod, OAuthFetch, OAuthHttpPorts, OAuthAppOptions, RegisteredOAuthClient } from "./ports.js";
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
function buildClientMetadata(input: DynamicClientRegistrationInput, options: OAuthAppOptions): Record<string, unknown> {
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
function resolveAuthMethod(document: Record<string, unknown>, requested: OAuthClientAuthMethod, supported: readonly string[]): OAuthClientAuthMethod {
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
export async function registerOAuthClientDynamically(requiredArgs: OAuthRequiredArgs<DynamicClientRegistrationDeps & DynamicClientRegistrationInput>, optionalArgs: OAuthOptionalArgs<DynamicClientRegistrationDeps & DynamicClientRegistrationInput> = {}): Promise<RegisteredOAuthClient> {
    const deps = requiredArgs;
    const input = { ...optionalArgs, registrationEndpoint: requiredArgs.registrationEndpoint, scopes: requiredArgs.scopes };
    assertOAuthAppOptions(deps.options);
    const endpoint = assertSafeProviderEndpoint(input.registrationEndpoint, "registration endpoint", deps.guard);
    const fetchFn = deps.fetchFn;
    const requestedAuthMethod = input.tokenEndpointAuthMethod ?? "none";
    let response: Response;
    try {
        response = await fetchFn({
            url: endpoint.toString()
        }, {
            method: "POST",
            headers: {
                accept: "application/json",
                "content-type": "application/json",
                ...(input.initialAccessToken === undefined ? {} : { authorization: `Bearer ${input.initialAccessToken}` }),
            },
            body: JSON.stringify(buildClientMetadata(input, deps.options)),
            redirect: "error",
            signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_REGISTRATION_TIMEOUT_MS),
        });
    }
    catch (cause) {
        throw new OAuthError({
            code: "OAUTH_PROVIDER_UNREACHABLE", message: `could not reach the client registration endpoint at ${endpoint.host}`,
            operatorAction: "Check network access to this server, then try connecting again. Nothing was retried automatically."
        }, {
            cause
        });
    }
    const document = await readBoundedOAuthJson(response, REGISTRATION_MESSAGES);
    if (typeof document.error === "string" || !response.ok)
        throw toRegistrationError(document, response.status, optionalArgs.messages ?? defaultOAuthMessages);
    const clientId = readOptionalString(document.client_id);
    if (clientId === null) {
        throw new OAuthError({
            code: "OAUTH_MALFORMED_RESPONSE", message: "the client registration response contained no client id",
            operatorAction: "This server's dynamic client registration endpoint is not behaving like an RFC 7591 endpoint."
        });
    }
    return {
        clientId,
        clientSecret: readOptionalString(document.client_secret),
        tokenEndpointAuthMethod: resolveAuthMethod(document, requestedAuthMethod, input.authMethodsSupported ?? []),
        registrationClientUri: readOptionalString(document.registration_client_uri),
        clientIdIssuedAt: readOptionalNumber(document.client_id_issued_at),
        clientSecretExpiresAt: readOptionalNumber(document.client_secret_expires_at),
    };
}
