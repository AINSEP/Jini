/**
 * Error helpers: build an `ApiError` from required `code`/`message` fields
 * and optional error metadata, including for a host application's hand-mounted routes.
 * Sending uses the single `sendApiError` implementation in `response.ts`.
 */
import type { ApiError, ApiErrorCode, ApiErrorResponse } from '@jini-ai/protocol';

/** Builds an `ApiError` from required code/message and optional metadata. */
export function createCompatApiError({ code, message }: { readonly code: ApiErrorCode; readonly message: string }, init: Omit<ApiError, 'code' | 'message'> = {}
): ApiError {
  return { code, message, ...init };
}

/** Wraps `createCompatApiError`'s result in the standard `{ error }` envelope. */
export function createCompatApiErrorResponse({ code, message }: { readonly code: ApiErrorCode; readonly message: string }, init: Omit<ApiError, 'code' | 'message'> = {}
): ApiErrorResponse {
  return { error: createCompatApiError({ code, message }, init) };
}
