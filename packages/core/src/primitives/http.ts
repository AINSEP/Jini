

/** One shared contract keeps binary, mail and webhook consumers behind the same egress guard.
 * A guarded request requires a socket idle budget; total elapsed time is opt-in. */
export type HttpRequest = {

  /** HEAD supports certificate/header diagnostics without downloading the page body. */
  method: "POST" | "GET" | "HEAD" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers: Readonly<Record<string, string>>;

  /** Preserve the signed bytes: re-serialization between signing and sending changes the signature. */
  body?: string;

  /** Whole-operation deadline, including DNS, redirects and body reads. Off by default.
   * Retry/backoff belongs to the caller; its deadline can cover the whole retry operation. */
  totalDeadlineMs?: number;

  /** Bound the whole operation, including DNS and body reads, beyond the per-attempt timeout. */
  signal?: AbortSignal;

  /** Caller byte ceilings are bounded by the client policy, never a way to widen its cap. */
  maxResponseBytes?: number;
} & (
  | { idleTimeoutMs: number; /** Legacy alias for the socket idle budget. */ timeoutMs?: number }
  | { /** Legacy alias for the socket idle budget. */ timeoutMs: number; idleTimeoutMs?: number }
);

export interface HttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;

  /** Bounded by the egress cap: a producer must not expose an unlimited text body through this port. */
  bodyText: string;

  /** Keep individual lines: Expires contains commas, so comma-splitting loses cookie boundaries. */
  setCookies?: readonly string[];

  /** UTF-8 decoding replaces invalid sequences and corrupts binary payloads. Expose the decompressed
   * transport bytes here so binary consumers need not bypass DNS checks, peer pinning or redirects.
   * Optional for older adapters/doubles; absence does not imply an empty payload. */
  bodyBytes?: Uint8Array;

  /** Coarse OR of text/byte clipping. A clipped image is corrupt, not merely smaller. Lossy UTF-8
   * can expand invalid bytes into three-byte replacement characters and clip text even when all
   * bytes fit, so binary consumers must use bodyBytesTruncated. Absence is an unknown verdict. */
  bodyTruncated?: boolean;

  /** Byte-specific completeness. A producer's unshaped truncation must count against both shapes
   * rather than silently declaring bytes complete. Absent when no byte payload was supplied. */
  bodyBytesTruncated?: boolean;

  /** Provenance must name the guarded hop that supplied these bytes, not the requested URL or an
   * unfollowed Location. Every followed hop is re-vetted. Older producers may omit this field,
   * in which case consumers fall back to the request URL rather than inventing a blank source. */
  finalUrl?: string;
}

export type RequestRedirect = "follow" | "error" | "manual";
/** Consumers receive the policy-enforcing client; the raw transport is a composition seam.
 * Keeping construction at the host boundary prevents consumers from bypassing egress checks. */
export interface HttpClientPort { send(required: { request: HttpRequest }, optional?: { redirect?: RequestRedirect }): Promise<HttpResponse>; }
