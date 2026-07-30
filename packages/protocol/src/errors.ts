import type { JsonValue } from './common.js';

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
  code: ApiErrorCode,
  message: string,
  init: Omit<ApiError, 'code' | 'message'> = {},
): ApiError {
  return { code, message, ...init };
}

export function createApiErrorResponse(error: ApiError): ApiErrorResponse {
  return { error };
}
