/** The host's authenticated admin request — it owns the base URL, authentication, retries, error
 *  decoding and failure publishing, so an admin API client only names paths, methods and bodies. */
export type AdminRequestFn = <T>(required: { path: string }, optional?: { init?: RequestInit }) => Promise<T>;

/** What an authenticated request may carry beyond its path, method and body: an abort signal,
 *  extra headers, and a hook that reads the raw successful `Response` (for an `ETag`). */
export interface AdminAuthenticatedRequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  onOk?: (required: { response: Response }, optional?: Record<string, never>) => void;
}

/** The host's authenticated request for calls that need a body object, headers or the raw response. */
export type AdminAuthenticatedRequestFn = <T>(
  required: { path: string; method: string; body?: unknown },
  optional?: AdminAuthenticatedRequestOptions,
) => Promise<T>;
