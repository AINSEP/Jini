/**
 * @file The JSON error shape every Jini route answers with, the status each error code maps to,
 * and the standard validation failure.
 */
import type { JsonValue } from '../../primitives/json.js';

/**
 * The wire error shape. Restated structurally because core has no dependencies, so it cannot
 * import the protocol package's `ApiError`; the two are mutually assignable.
 */
export interface ServerApiError {
  code: string;
  message: string;
  details?: JsonValue;
  retryable?: boolean;
  requestId?: string;
}

/** The `{ error }` envelope a failed route answers with. */
export interface ServerApiErrorResponse { error: ServerApiError }

/** Wraps an error in the standard `{ error }` envelope. */
export const apiErrorBody = ({ error }: { readonly error: ServerApiError }, _optional: Record<string, never> = {}): ServerApiErrorResponse => ({ error });

/**
 * @internal
 * Default HTTP status per generic error code. Codes not listed here fall back to 500 in
 * `statusForError` — deliberately conservative, since an unmapped code (including any
 * product-specific code a consuming pack defines) is more likely a new server-side failure mode
 * than a client error.
 */
const ERROR_STATUS_BY_CODE: Partial<Record<string, number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  UPSTREAM_UNAVAILABLE: 502,
  SERVICE_UNAVAILABLE: 503,
  NOT_CONFIGURED: 503,
  TOOL_TOKEN_MISSING: 401,
  TOOL_TOKEN_INVALID: 401,
  TOOL_TOKEN_EXPIRED: 401,
  TOOL_ENDPOINT_DENIED: 403,
  TOOL_OPERATION_DENIED: 403,
  TOOL_NOT_AVAILABLE: 503,
  TOOL_EXECUTION_FAILED: 422,
  REMOTE_TOOL_BRIDGE_NOT_CONFIGURED: 503,
  REMOTE_TOOL_BRIDGE_TOKEN_REQUIRED: 401,
  OAUTH_FLOW_IN_PROGRESS: 409,
};

/** Resolves the HTTP status to send for an `ApiError`, defaulting to 500 for unmapped codes. */
export function statusForError({ error }: { readonly error: ServerApiError }, _optional: Record<string, never> = {}): number {
  return ERROR_STATUS_BY_CODE[error.code] ?? 500;
}

/** Issue shape attached to a validation failure so clients can render per-field errors. */
export interface ServerValidationIssue { readonly path: string; readonly message: string }

/**
 * Builds a `BAD_REQUEST` error for a failed parse. When `issues` is non-empty, attaches
 * them as structured validation details so clients can render per-field errors.
 */
export function validationError({ message }: { readonly message: string }, { issues = [] }: { readonly issues?: readonly ServerValidationIssue[] | undefined } = {}): ServerApiError {
  if (issues.length === 0) return { code: 'BAD_REQUEST', message };
  return { code: 'BAD_REQUEST', message, details: { kind: 'validation', issues } as unknown as JsonValue };
}
