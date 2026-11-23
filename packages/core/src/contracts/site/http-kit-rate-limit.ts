/**
 * @file Fixed-window rate-limit profile and the structural client-IP request shape. Types only.
 *
 * Additive copy of `RateLimitProfile` and `ClientIpSource` from `@jini-ai/http-kit/rate-limit`. The
 * limiter, counter stores and client-IP resolution stay in http-kit, which keeps its identical
 * declarations and exports until the paired cutover.
 */

/** Host-selected window and request budget; no product profiles live here. */
export interface RateLimitProfile {
  readonly windowSeconds: number;
  readonly max: number;
  readonly burst: number;
}

// A minimal structural request avoids importing a framework's full socket/request type and
// lets policy be evaluated with plain objects, without coupling domains to a transport host.
/** Structural request shape; transport/framework trust configuration stays outside. */
export interface ClientIpSource {
  readonly socket: { readonly remoteAddress?: string };
  readonly headers: Record<string, string | string[] | undefined>;
  readonly ip?: string;
}
