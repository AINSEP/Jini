/**
 * @file The structured error taxonomy for `@jini-ai/oauth`.
 *
 * The load-bearing field is {@link OAuthError.retryable}, and it is `false` for all but two codes.
 * Callers keep the error-code vocabulary exhaustive: adding a code is a deliberate
 * contract change. `retryAfterSeconds` is the device-poll interval in seconds.
 * That retry asymmetry is the whole point of this file:
 *
 * - An authorization-code exchange is NOT safely repeatable. The `code` is single-use and the first
 *   response may have been lost *after* the provider already redeemed it, so a blind retry can
 *   burn a code that actually succeeded and leave the operator staring at a failure for a
 *   connection that exists. Every code-exchange failure is therefore terminal here, and the retry
 *   decision is handed back to the human, who can re-authorize with one click.
 * - Device-grant polling is the one place where retrying is not just safe but REQUIRED by the spec
 *   (RFC 8628 §3.5): `authorization_pending` and `slow_down` mean "keep polling". Those two, and
 *   only those two, carry `retryable: true`.
 *
 * The second load-bearing field is {@link OAuthError.operatorAction}. These errors reach two
 * audiences that cannot act on the same text: an admin looking at a form, and a language model
 * deciding whether to call a tool again. `operatorAction` is the sentence written for the human;
 * `message` is what a model sees, and for the terminal codes it says *do not retry* in words,
 * because a model that reads "authorization expired" without that instruction will loop.
 * Unrecognized provider error codes are terminal `OAUTH_PROVIDER_REJECTED`: an unknown
 * error is not evidence that retrying a non-idempotent exchange is safe.
 *
 * Provider response bodies are NEVER carried in `message`. A token endpoint's error body can echo
 * request detail, and these strings reach a browser and a model. The provider's own RFC 6749 §5.2
 * error *code* is kept in {@link OAuthError.providerErrorCode} for logs, because that field is a
 * closed vocabulary rather than free text.
 */
/** Typed failure vocabulary. Only the two device-polling states are retryable; descriptions from remote providers are never used as error text. */
export type OAuthErrorCode = "OAUTH_PROVIDER_UNREACHABLE" | "OAUTH_PROVIDER_REJECTED" | "OAUTH_INVALID_STATE" | "OAUTH_INVALID_GRANT" | "OAUTH_AUTHORIZATION_PENDING" | "OAUTH_SLOW_DOWN" | "OAUTH_ACCESS_DENIED" | "OAUTH_EXPIRED_TOKEN" | "OAUTH_UNSUPPORTED_GRANT" | "OAUTH_MALFORMED_RESPONSE" | "OAUTH_RESOURCE_MISMATCH" | "OAUTH_UNSAFE_ENDPOINT" | "OAUTH_INVALID_REQUEST" | "OAUTH_AUTHORIZATION_CANCELLED" | "OAUTH_AUTHORIZATION_EXPIRED";
const RETRYABLE_CODES: ReadonlySet<OAuthErrorCode> = new Set<OAuthErrorCode>([
    "OAUTH_AUTHORIZATION_PENDING",
    "OAUTH_SLOW_DOWN",
]);
export interface OAuthErrorOptions {
    readonly providerErrorCode?: string;
    readonly retryAfterSeconds?: number;
    readonly cause?: unknown;
}
export class OAuthError extends Error {
    readonly code: OAuthErrorCode;
    readonly retryable: boolean;
    readonly operatorAction: string;
    readonly providerErrorCode: string | undefined;
    readonly retryAfterSeconds: number | undefined;
    constructor({ code, message, operatorAction }: {
        readonly code: OAuthErrorCode;
        readonly message: string;
        readonly operatorAction: string;
    }, options: OAuthErrorOptions = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = "OAuthError";
        this.code = code;
        this.retryable = RETRYABLE_CODES.has(code);
        this.operatorAction = operatorAction;
        this.providerErrorCode = options.providerErrorCode;
        this.retryAfterSeconds = options.retryAfterSeconds;
    }
}
export function isOAuthError(input: {
    readonly value: unknown;
}): input is {
    readonly value: OAuthError;
} {
    return input.value instanceof OAuthError;
}
export function mapProviderErrorCode({ providerErrorCode }: {
    readonly providerErrorCode: string;
}): OAuthErrorCode {
    switch (providerErrorCode) {
        case "authorization_pending":
            return "OAUTH_AUTHORIZATION_PENDING";
        case "slow_down":
            return "OAUTH_SLOW_DOWN";
        case "access_denied":
            return "OAUTH_ACCESS_DENIED";
        case "expired_token":
            return "OAUTH_EXPIRED_TOKEN";
        case "invalid_grant":
            return "OAUTH_INVALID_GRANT";
        case "unsupported_grant_type":
            return "OAUTH_UNSUPPORTED_GRANT";
        default:
            return "OAUTH_PROVIDER_REJECTED";
    }
}

/** Facade compatibility only: error fields win even on HTTP 200/5xx. Upstream still owns
 * OAuth error decoding and validation. Projection keeps opaque identity data out of OAuth-only
 * processing; it never establishes identity trust. Public failures use a protocol-code allowlist;
 * unknown values become plain text and `invalid_provider_error` in the endpoint projections.
 * The normalization below only bounds decoder input; identifier syntax is not a trust boundary.
 * Native Response owns JSON parsing.
 */
export async function adaptOAuthResponse({ response }: { readonly response: Response }, {
    successStatus, project,
}: { readonly successStatus?: number; readonly project?: (body: Record<string, unknown>) => void } = {}): Promise<Response> {
    const body = await response.json() as Record<string, unknown> | null;
    if (body !== null && typeof body === 'object') project?.(body);
    normalizeProviderError({ body });
    return Response.json(body, { status: oauthResponseStatus({ body, response }, successStatus === undefined ? {} : { successStatus }) });
}

/** Bound protocol identifiers before upstream decoding; never retain arbitrary provider text. */
function normalizeProviderError({ body }: { body: Record<string, unknown> | null }): void {
    if (typeof body?.error === 'string'
        && (body.error.length === 0 || body.error.length > 64 || /[^a-z0-9_]/i.test(body.error)))
        body.error = 'invalid_provider_error';
}
function oauthResponseStatus({ body, response }: { body: Record<string, unknown> | null; response: Response },
    { successStatus }: { successStatus?: number } = {}): number {
    if (typeof body?.error === 'string') return 400;
    return response.ok ? successStatus ?? response.status : response.status;
}
