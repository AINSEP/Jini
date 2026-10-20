/** Typed failure vocabulary. Only the two device-polling states are retryable; descriptions from remote providers are never used as error text. */
export type OAuthErrorCode = "OAUTH_PROVIDER_UNREACHABLE" | "OAUTH_PROVIDER_REJECTED" | "OAUTH_INVALID_STATE" | "OAUTH_INVALID_GRANT" | "OAUTH_AUTHORIZATION_PENDING" | "OAUTH_SLOW_DOWN" | "OAUTH_ACCESS_DENIED" | "OAUTH_EXPIRED_TOKEN" | "OAUTH_UNSUPPORTED_GRANT" | "OAUTH_MALFORMED_RESPONSE" | "OAUTH_UNSAFE_ENDPOINT" | "OAUTH_INVALID_REQUEST" | "OAUTH_AUTHORIZATION_CANCELLED" | "OAUTH_AUTHORIZATION_EXPIRED";
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
 * processing; it never establishes identity trust. Provider codes are bounded protocol identifiers
 * before upstream decoding so facade messages and metadata cannot echo arbitrary provider text.
 * Native Response owns JSON parsing.
 */
export async function adaptOAuthResponse({ response }: { readonly response: Response }, {
    successStatus, project,
}: { readonly successStatus?: number; readonly project?: (body: Record<string, unknown>) => void } = {}): Promise<Response> {
    const body = await response.json() as Record<string, unknown> | null;
    if (body !== null && typeof body === 'object') project?.(body);
    if (typeof body?.error === 'string'
        && (body.error.length === 0 || body.error.length > 64 || /[^a-z0-9_]/i.test(body.error)))
        body.error = 'invalid_provider_error';
    return Response.json(body, { status: typeof body?.error === 'string' ? 400
        : response.ok ? successStatus ?? response.status : response.status });
}
