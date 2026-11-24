/**
 * @file Structural contracts for a host's session-aware admin HTTP client (`createAdminHttp` in
 * `@jini-ai/admin/shell/lib/admin-http/request`).
 *
 * Types only. They live in core so a host can name its error type and per-call options without
 * importing the admin package's implementation. `AdminApiError` (this folder) already satisfies
 * `AdminHttpError`; a host may pass it, or its own legacy class, as the error type parameter.
 * The route-group `AdminTransport` in `@jini-ai/admin/core` is a different, simpler contract.
 */

/** The fields every error the client throws must carry. The client never constructs one itself. */
export interface AdminHttpError extends Error {
  readonly status: number;
  readonly code?: string | undefined;
  readonly body?: Record<string, unknown> | undefined;
}

/** The host's live "is the server back yet?" object, used for the single restart retry. */
export interface AdminHttpReconnect {
  markReachable(): void;
  waitUntilReachable(): Promise<boolean>;
}

/**
 * Per-call options. `B` narrows the local API prefixes a host allows, so admin cookies are never
 * sent to an arbitrary URL; `F` is the host's failure-notice entry vocabulary.
 */
export interface AdminHttpOptions<E extends AdminHttpError, B extends string, F extends string> {
  basePath?: B;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  keepalive?: boolean;
  onOk?: (required: { response: Response }, optional?: Record<string, never>) => void;
  retryWrites?: boolean;
  /** Transcript/inventory readers reject malformed successful JSON instead of accepting `{}`. */
  requireJson?: boolean;
  failureEntry?: F;
  /** Preserve an adapter's status-bearing error contract after session invalidation is checked. */
  errorFactory?: (required: { response: Response; error: E }, optional?: Record<string, never>) => E;
}
