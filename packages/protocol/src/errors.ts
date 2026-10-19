import type { JsonValue } from './json.js';

/**
 * Cross-product error codes meaningful to any @jini-ai/* consumer. Kept small and
 * closed to genuinely generic HTTP/tool-boundary failures. Packs and products
 * define their own codes on top; `ApiErrorCode` stays an open string type
 * (not a closed union) so a pack's own codes type-check without a kernel edit.
 */
export const GENERIC_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'TOOL_TOKEN_MISSING',
  'TOOL_TOKEN_INVALID',
  'TOOL_TOKEN_EXPIRED',
  'TOOL_ENDPOINT_DENIED',
  'TOOL_OPERATION_DENIED',
  'TOOL_NOT_AVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type GenericErrorCode = (typeof GENERIC_ERROR_CODES)[number];

export type ApiErrorCode = GenericErrorCode | (string & {});

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: JsonValue;
  retryable?: boolean;
  requestId?: string;
}

export interface ApiErrorResponse {
  error: ApiError;
}

export type ApiValidationIssue = {
  /** Dot/bracket path, JSON pointer, or form field name that failed validation. */
  path: string;
  message: string;
  code?: string;
};

export type ApiValidationErrorDetails = {
  kind: 'validation';
  issues: ApiValidationIssue[];
};

export type LegacyErrorResponse =
  | { error: string }
  | { code: string; error: string };

export type CompatibleErrorResponse = ApiErrorResponse | LegacyErrorResponse;

/** Transport-neutral error payload carried on a run's `error` event. */
export interface RunErrorPayload {
  message: string;
  error?: ApiError;
}

export function createApiError(
  { code, message }: Pick<ApiError, 'code' | 'message'>,
  optionalArgs: Omit<ApiError, 'code' | 'message'> = {},
): ApiError {
  return { code, message, ...optionalArgs };
}

export function createApiErrorResponse({ error }: { error: ApiError }): ApiErrorResponse {
  return { error };
}

/** Client-side view of either generation of the JSON error envelope. */
export interface DecodedApiError {
  message: string;
  code?: string;
  details?: unknown;
  retryable?: boolean;
  requestId?: string;
}

/** Decode legacy string errors and canonical nested errors without stringifying arbitrary objects.
 * @param requiredArgs - Untrusted parsed response body.
 * @param optionalArgs - Caller-owned fallback copy (for example one containing the HTTP status).
 * @returns Safe message and optional wire metadata; malformed bodies use the fallback.
 * @complexity O(1) time and space; details are retained without copying.
 */
export function decodeApiError(
  { body }: { body: unknown },
  { fallbackMessage = 'request failed' }: { fallbackMessage?: string } = {},
): DecodedApiError {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { message: fallbackMessage };
  const record = body as Record<string, unknown>;
  const nested = record.error;
  const error = nested !== null && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown> : record;
  // Share/import routes use a flat code/message envelope; keep legacy string-error precedence.
  const message = error === record ? (typeof record.error === 'string' ? record.error : record.message) : error.message;
  return {
    message: typeof message === 'string' ? message : fallbackMessage,
    ...(typeof error.code === 'string' ? { code: error.code } : {}),
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
    ...(typeof error.requestId === 'string' ? { requestId: error.requestId } : {}),
  };
}
