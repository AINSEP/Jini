import type { Clock, HttpRequest, HttpResponse, HttpClientPort } from "@jini-ai/core/primitives";
import type { PinnedPeer } from "./types.js";
export type { PinnedPeer } from "./types.js";
/** Resolver returns every peer address; a mixed public/private answer is refused as a whole. */
export interface DnsResolver { resolve(required: { hostname: string }): Promise<readonly string[]>; }
/** Supplies time and deadline cancellation without a global timer dependency in the guard. */
export type GuardedClock = Clock & { timeoutSignal(required: { timeoutMs: number }): AbortSignal };
/** Transport must dial the supplied IP, preserve authority/SNI, bound decoded bytes,
 * enforce idleTimeoutMs per socket, and honor request.signal through body completion. */
// Re-resolving the original hostname would undo peer vetting and reopen a DNS-rebinding race.
// The buffered response is bounded by byte/decompression caps; it is not a streaming response contract.
export interface PinnedHttpTransport { requestPinned(required: { request: HttpRequest; peer: PinnedPeer }): Promise<HttpResponse>; }
export type HttpTransportAdapter = PinnedHttpTransport;
/** Policy must cover IPv4 and IPv6, mapped-address/hostname normalization, URL credentials and
 * redirects. Re-verify each redirected peer and strip sensitive headers across origins. */
export interface EgressPolicy {
  readonly allowedSchemes: readonly string[];
  readonly denyPrivateAddresses: boolean;

  /** Explicit development capability; IPv6 literals use their bracket-free hostname (e.g. fd00::1). */
  readonly devHostAllowlist: readonly string[];
  readonly maxRedirects: number;
  /** Historical name: ceiling on each socket's idle timeout, not total transfer time. */
  readonly connectTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxDecompressedBytes: number;

  /** Reserved descriptor, not an implemented pacing mechanism. Untrusted fan-out requires a host
   * concurrency/budget limiter; omission is appropriate only for trusted low-fan-out callers. */
  readonly rateLimit?: { readonly maxConcurrent: number; readonly maxPerMinute: number };
}

export type GuardedHttpRequired = { transport: PinnedHttpTransport; policy: EgressPolicy; dns: DnsResolver; clock: GuardedClock; userAgent: string };
