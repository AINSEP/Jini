/** Typed failure vocabulary. Only the two device-polling states are retryable; descriptions from remote providers are never used as error text. */
export type OAuthErrorCode = "OAUTH_PROVIDER_UNREACHABLE" | "OAUTH_PROVIDER_REJECTED" | "OAUTH_INVALID_STATE" | "OAUTH_INVALID_GRANT" | "OAUTH_AUTHORIZATION_PENDING" | "OAUTH_SLOW_DOWN" | "OAUTH_ACCESS_DENIED" | "OAUTH_EXPIRED_TOKEN" | "OAUTH_UNSUPPORTED_GRANT" | "OAUTH_MALFORMED_RESPONSE" | "OAUTH_UNSAFE_ENDPOINT" | "OAUTH_INVALID_REQUEST";
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
