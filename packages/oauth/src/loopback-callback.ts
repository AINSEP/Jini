/**
 * @file Pure decisions for the installed-app loopback receiver: which incoming request is the
 * callback, and what a callback query means. Kept apart from the listener so every security
 * rule here (Host pinning, single-valued parameters, constant-time state, declared-field
 * allowlist, size bounds) is a plain function of its inputs.
 */
import { OAuthError } from './errors.js';
import { MAX_CODE_LENGTH, toCallbackError } from './authorization-code.js';
import { invalidState, secureEquals } from './pending-authorizations.js';
import { MAX_AUTHORIZATION_STATE_LENGTH } from './sealed-state.js';

// `completeAuthorizationCode`'s code bound (MAX_CODE_LENGTH), applied here so an oversized code fails at the edge.
export const MAX_CALLBACK_FIELD_LENGTH = 4096;
export const MAX_CALLBACK_FIELDS = 16;
const CALLBACK_FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
// Protocol parameters the receiver interprets itself; a plugin may not re-declare them as data.
const RESERVED_CALLBACK_PARAMS: ReadonlySet<string> = new Set(['code', 'state', 'error', 'error_description', 'error_uri', 'iss']);

export interface LoopbackAuthorizationResult {
    readonly code: string;
    /** Only the callback fields the caller declared, and only those present in the redirect. */
    readonly fields: Readonly<Record<string, string>>;
}

/** Status for a request that is not the callback. Such requests never consume the single slot. */
export type LoopbackRoute = { readonly kind: 'callback'; readonly query: URLSearchParams } | { readonly kind: 'ignore'; readonly status: 400 | 404 | 405 };

export interface LoopbackRequestFacts {
    readonly method: string | undefined;
    readonly rawUrl: string | undefined;
    readonly host: string | undefined;
    readonly hasBody: boolean;
}

function invalidRequest(message: string): OAuthError {
    return new OAuthError({ code: 'OAUTH_INVALID_REQUEST', message, operatorAction: 'Start the connection again from the connection settings.' });
}

function invalidConfiguration(message: string): OAuthError {
    return new OAuthError({ code: 'OAUTH_INVALID_REQUEST', message, operatorAction: "Fix the connection's declared callback fields." });
}

/**
 * The name rule for a provider callback field a plugin may declare: a short identifier that is not
 * a protocol parameter the receiver reads itself. API-connection descriptors apply this same check
 * (and admin-surface declarations copy it), so a declaration valid on hosted is valid on desktop.
 */
export function isCallbackFieldName(name: string): boolean {
    return CALLBACK_FIELD_NAME.test(name) && !RESERVED_CALLBACK_PARAMS.has(name);
}

/** Rejects a callback field list a plugin declared wrongly, before any port is opened. */
export function assertLoopbackConfiguration(requiredArgs: { readonly callbackFields: readonly string[] }): void {
    if (requiredArgs.callbackFields.length > MAX_CALLBACK_FIELDS)
        throw invalidConfiguration(`at most ${MAX_CALLBACK_FIELDS} callback fields may be declared`);
    for (const name of requiredArgs.callbackFields) {
        if (!isCallbackFieldName(name))
            throw invalidConfiguration(`'${name.slice(0, 64)}' cannot be declared as a callback field`);
    }
}

/**
 * Decides whether a request is the callback. Host is pinned to the bound origin so a DNS-rebound
 * page cannot reach the slot; anything else is noise (favicon, prefetch) and is answered without
 * consuming the listener.
 */
export function routeLoopbackRequest(requiredArgs: { readonly request: LoopbackRequestFacts; readonly expectedHost: string; readonly path: string; readonly armed: boolean }): LoopbackRoute {
    const { request } = requiredArgs;
    if (request.host !== requiredArgs.expectedHost || !request.rawUrl?.startsWith('/'))
        return { kind: 'ignore', status: 400 };
    const url = new URL(request.rawUrl, `http://${requiredArgs.expectedHost}`);
    if (url.pathname !== requiredArgs.path || !requiredArgs.armed)
        return { kind: 'ignore', status: 404 };
    if (request.method !== 'GET')
        return { kind: 'ignore', status: 405 };
    // A real redirect never carries a body; refusing it unread bounds what the listener accepts.
    if (request.hasBody)
        return { kind: 'ignore', status: 400 };
    return { kind: 'callback', query: url.searchParams };
}

/** A repeated parameter is ambiguous, so it fails instead of silently taking the first value. */
function single(query: URLSearchParams, name: string): string | undefined {
    const values = query.getAll(name);
    if (values.length > 1)
        throw invalidRequest(`the authorization callback repeated the '${name}' parameter`);
    return values[0];
}

function readDeclaredFields(query: URLSearchParams, callbackFields: readonly string[]): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const name of callbackFields) {
        const value = single(query, name);
        if (value === undefined)
            continue;
        if (value.length > MAX_CALLBACK_FIELD_LENGTH)
            throw invalidRequest(`the authorization callback field '${name}' exceeded ${MAX_CALLBACK_FIELD_LENGTH} characters`);
        fields[name] = value;
    }
    return fields;
}

/**
 * Reads one callback query. State is checked first and in constant time, so a provider error or
 * code is only believed once the redirect is proven to belong to this attempt.
 */
export function readLoopbackCallback(requiredArgs: { readonly query: URLSearchParams; readonly expectedState: string; readonly callbackFields: readonly string[] }): LoopbackAuthorizationResult {
    const { query } = requiredArgs;
    const state = single(query, 'state') ?? '';
    if (state.length > MAX_AUTHORIZATION_STATE_LENGTH || !secureEquals({ a: state, b: requiredArgs.expectedState }))
        throw invalidState({});
    const error = single(query, 'error');
    if (error !== undefined)
        throw toCallbackError(error);
    const code = single(query, 'code') ?? '';
    if (code === '' || code.length > MAX_CODE_LENGTH)
        throw invalidRequest('the authorization callback carried no usable code');
    return { code, fields: readDeclaredFields(query, requiredArgs.callbackFields) };
}
