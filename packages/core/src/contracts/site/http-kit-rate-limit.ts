/**
 * @file Rate-limit data shapes a host hands to `@jini-ai/http-kit/rate-limit`: the window/budget
 * profile and the structural request a client address is resolved from. Counting, stores and the
 * trust policy stay in http-kit; these types sit in core so callers can declare profiles and
 * request sources without depending on the http-kit package.
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
