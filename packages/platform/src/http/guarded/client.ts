// Policy refusals use EgressRefusedError; DNS, connection and transport failures retain their
// own errors because they are operational failures, not decisions that a different URL fixes.
import { isPrivateAddress, expandIpv6 } from "../../net/address.js";
import { FetchTimeoutError } from "../../fetch-with-timeout.js";
import { isIP } from "node:net";

import { EgressRefusedError } from "./errors.js";
import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { DnsResolver, EgressPolicy, GuardedHttpRequired, HttpTransportAdapter } from "./ports.js";
import type { HttpRequest, HttpResponse, RequestRedirect } from "@jini-ai/core/primitives";
import type { PinnedPeer } from "./types.js";

export type AddressClass = "public" | "private" | "loopback" | "link-local" | "reserved";
/** Uses the canonical net address validator; labels preserve the guarded refusal contract. */
export function classifyAddress({ ip }: { ip: string }): AddressClass {
  if (!isPrivateAddress({ address: ip })) return classifyUnblockedSpelling({ ip });
  const family = isIP(ip);
  if (family === 6) return classifyIpv6Groups({ groups: expandIpv6({ address: ip })! });
  if (family === 4) return classifyIpv4({ ip });
  return "reserved";
}

function classifyUnblockedSpelling({ ip }: { ip: string }): AddressClass {
  return ip.toLowerCase().startsWith("::0.") ? "reserved" : "public";
}

function classifyIpv6Groups({ groups: g }: { groups: readonly number[] }): AddressClass {
  if (g.slice(0, 5).every(n => n === 0) && g[5] === 0xffff) {
    return classifyAddress({ ip: [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255].join(".") });
  }
  if (g.slice(0, 7).every(n => n === 0) && g[7] === 1) return "loopback";
  if ((g[0]! & 0xffc0) === 0xfe80) return "link-local";
  if ((g[0]! & 0xfe00) === 0xfc00) return "private";
  return "reserved";
}

// Only called for an IPv4 literal the canonical validator already blocked.
function classifyIpv4({ ip }: { ip: string }): AddressClass {
  const [a,b] = ip.split(".").map(Number);
  if (a === 127) return "loopback";
  // This range includes the cloud metadata address 169.254.169.254.
  if (a === 169 && b === 254) return "link-local";
  if (a === 0 || a! >= 224) return "reserved";
  // The remaining blocked IPv4 ranges include RFC 6598 shared carrier space (100.64.0.0/10):
  // it is not globally routable and belongs with RFC 1918 private ranges for egress decisions.
  return "private";
}
const CROSS_ORIGIN_HEADERS = new Set(["accept", "accept-language", "user-agent"]);

// HTTP header names are case-insensitive; preserve the caller's explicit User-Agent in any casing.
function hasUserAgentHeader(headers: Readonly<Record<string, string>>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === "user-agent");
}

function withDefaultUserAgent(headers: Readonly<Record<string, string>>, userAgent: string): Record<string, string> {
  if (hasUserAgentHeader(headers)) return { ...headers };
  return { ...headers, "User-Agent": userAgent };
}

function isCrossOrigin(a: URL, b: URL): boolean {
  return a.protocol !== b.protocol || a.hostname !== b.hostname || a.port !== b.port;
}

function assertAllowedTarget(url: URL, policy: EgressPolicy): void {
  if (!policy.allowedSchemes.includes(url.protocol.replace(":", ""))) {
    const message = `scheme '${url.protocol}' is not in the allowed egress schemes`;
    throw new EgressRefusedError({ message }, { callerSafeMessage: message });
  }
  if (url.username || url.password) {
    const message = "credentials embedded in the target URL are not allowed";
    throw new EgressRefusedError({ message }, { callerSafeMessage: message });
  }
}

// WHATWG URL.hostname brackets IPv6 literals; IP classification, DNS and allowlists use bare IPs.
function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return hostname.slice(1, -1);
  return hostname;
}

// IP literals resolve to themselves and must not depend on a DNS lookup.
async function resolveHostAddresses(hostname: string, dns: DnsResolver): Promise<string[]> {
  const literal = stripIpv6Brackets(hostname);
  if (isIP(literal) !== 0) return [literal];
  return [...await dns.resolve({ hostname })];
}

// Keep the resolved IP in internal diagnostics only; the caller-safe refusal must not disclose it.
function assertNoPrivateAddress(hostname: string, addresses: readonly string[]): void {
  for (const address of addresses) {
    const addressClass = classifyAddress({ ip: address });
    if (addressClass !== "public") {
      throw new EgressRefusedError({ message: `egress to '${hostname}' (${address}) rejected: resolved address is ${addressClass}` }, {
        callerSafeMessage: `egress to '${hostname}' rejected: resolved address is ${addressClass}`,
      });
    }
  }
}

async function resolvePinnedPeer(url: URL, policy: EgressPolicy, dns: DnsResolver): Promise<PinnedPeer> {
  assertAllowedTarget(url, policy);

  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;

  const hostname = stripIpv6Brackets(url.hostname);
  const isDevAllowlisted = policy.devHostAllowlist.includes(hostname);

  const addresses = await resolveHostAddresses(url.hostname, dns);
  if (addresses.length === 0) {
    throw new Error(`could not resolve any address for host '${url.hostname}'`);
  }

  if (policy.denyPrivateAddresses && !isDevAllowlisted) {
    assertNoPrivateAddress(url.hostname, addresses);
  }

  return {
    ip: addresses[0]!,
    port,
    authority: url.host,

    // RFC 6066 section 3: SNI names a hostname, never an IP literal of either family.
    tlsServerName: isIP(hostname) === 0 ? url.hostname : undefined,
  };
}

function withCrossOriginHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!CROSS_ORIGIN_HEADERS.has(key.toLowerCase())) continue;
    next[key] = value;
  }
  return next;
}

function capBody(bodyText: string, maxBytes: number): string {
  const buffer = Buffer.from(bodyText, "utf8");
  if (buffer.byteLength <= maxBytes) return bodyText;
  return buffer.subarray(0, maxBytes).toString("utf8");
}

// Cap text and raw bytes independently: invalid UTF-8 bytes become three-byte U+FFFD characters,
// so a complete binary body can have a decoded text representation that crosses the cap.
// The byte-specific flag prevents falsely treating that complete file as corrupt; the coarse
// bodyTruncated flag remains the OR for callers that consume text.
function capResponse(response: HttpResponse, maxBytes: number): HttpResponse {
  const bodyText = capBody(response.bodyText, maxBytes);
  const bytes = response.bodyBytes;
  const bytesOverCap = bytes !== undefined && bytes.byteLength > maxBytes;

  // A producer's coarse flag names no shape and counts against both unless its byte flag says
  // otherwise; assuming complete bytes from an unspecified truncation signal risks corruption.
  const producerTruncated = response.bodyTruncated === true;
  const bytesTruncated = bytesOverCap || (response.bodyBytesTruncated ?? producerTruncated);
  return {
    ...response,
    bodyText,
    ...(bytes !== undefined
      ? { bodyBytes: bytesOverCap ? bytes.subarray(0, maxBytes) : bytes, bodyBytesTruncated: bytesTruncated }
      : {}),
    bodyTruncated: bodyText !== response.bodyText || bytesOverCap || producerTruncated,
  };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Per-client collaborators and the per-call redirect mode, fixed for every hop of one send. */
interface HopContext { transport: HttpTransportAdapter; policy: EgressPolicy; dns: DnsResolver; redirect: RequestRedirect }

async function sendWithPolicy({ hop, request, redirectsFollowed }: { hop: HopContext; request: HttpRequest; redirectsFollowed: number }): Promise<HttpResponse> {
  const url = new URL(request.url);
  const response = await sendOneHop({ hop, request, url });
  const nextRequest = followableRedirect({ hop, request, url, response, redirectsFollowed });
  if (!nextRequest) return response;
  return sendWithPolicy({ hop, request: nextRequest, redirectsFollowed: redirectsFollowed + 1 });
}

// One effective cap serves both the transport hint and the post-read truncation.
function boundRequest({ request, policy }: { request: HttpRequest; policy: EgressPolicy }): HttpRequest {
  // The policy timeout is a ceiling: callers may choose a shorter idle budget, never a longer one.
  // Keep the legacy alias synchronized for host transport adapters. Activity resets
  // Node's socket timer; a large progressing body must not spend a wall-clock budget.
  const idleTimeoutMs = Math.min(request.idleTimeoutMs ?? request.timeoutMs!, policy.connectTimeoutMs);
  return {
    ...request,
    idleTimeoutMs,
    timeoutMs: idleTimeoutMs,
    maxResponseBytes: Math.min(request.maxResponseBytes ?? Infinity, policy.maxResponseBytes, policy.maxDecompressedBytes),
  };
}

async function sendOneHop({ hop, request, url }: { hop: HopContext; request: HttpRequest; url: URL }): Promise<HttpResponse> {
  request.signal?.throwIfAborted();
  const peer = await resolveBeforeDeadline(resolvePinnedPeer(url, hop.policy, hop.dns), request.signal);
  request.signal?.throwIfAborted();

  const boundedRequest = boundRequest({ request, policy: hop.policy });
  const response = await resolveBeforeDeadline(hop.transport.requestPinned({ request: boundedRequest, peer }), request.signal);

  // Record the normalized URL actually resolved and pinned, not the caller's original spelling.
  // A followed redirect returns the deeper hop's response, including that hop's finalUrl.
  const cappedResponse: HttpResponse = { ...capResponse(response, boundedRequest.maxResponseBytes!), finalUrl: url.href };

  // A refused redirect is a policy decision like a refused address, so it carries the same type.
  // The text names no Location target, which may be private, so both messages can share it.
  if (hop.redirect === "error" && REDIRECT_STATUSES.has(cappedResponse.status)) {
    const message = "redirect response refused by the request's redirect policy";
    throw new EgressRefusedError({ message }, { callerSafeMessage: message });
  }
  return cappedResponse;
}

/** The next hop's request when this response is a redirect the policy follows, else undefined. */
function followableRedirect(
  { hop, request, url, response, redirectsFollowed }: { hop: HopContext; request: HttpRequest; url: URL; response: HttpResponse; redirectsFollowed: number },
): HttpRequest | undefined {
  // Follow GET only even when the policy allows redirects: 307/308 preserve method and body,
  // so following a mutating request would replay a write and leak its body to an unchosen target.
  // With follow policy, a non-GET redirect stays a raw response rather than a target refusal.
  const canFollowRedirect =
    hop.redirect === "follow" && request.method === "GET" && REDIRECT_STATUSES.has(response.status) && redirectsFollowed < hop.policy.maxRedirects;
  if (!canFollowRedirect) return undefined;

  const location = response.headers.location ?? response.headers.Location;
  if (!location) return undefined;

  const nextUrl = new URL(location, url);
  // Cross-origin hops must not inherit authorization or cookies entrusted to the original origin.
  // Custom headers can carry credentials too; forward only the explicit noncredential allowlist.
  const nextHeaders = isCrossOrigin(url, nextUrl)
    ? withCrossOriginHeaders(request.headers)
    : request.headers;
  return { ...request, url: nextUrl.toString(), headers: nextHeaders };
}

function isPositiveSafeInteger(value: number | undefined): boolean {
  return Number.isSafeInteger(value) && value! > 0;
}

function assertValidPolicy(policy: EgressPolicy): void {
  for (const value of [policy.connectTimeoutMs, policy.maxResponseBytes, policy.maxDecompressedBytes]) {
    if (!isPositiveSafeInteger(value)) throw new TypeError("policy time and byte limits must be positive safe integers");
  }
  if (!Number.isSafeInteger(policy.maxRedirects) || policy.maxRedirects < 0) throw new TypeError("maxRedirects must be a nonnegative safe integer");
}

function assertValidRequestLimits(request: HttpRequest): void {
  if (!isPositiveSafeInteger(request.idleTimeoutMs ?? request.timeoutMs)) {
    const timeoutName = request.idleTimeoutMs === undefined ? "timeoutMs" : "idleTimeoutMs";
    throw new TypeError(`${timeoutName} must be a positive safe integer`);
  }
  if (request.totalDeadlineMs !== undefined && !isPositiveSafeInteger(request.totalDeadlineMs)) throw new TypeError("totalDeadlineMs must be a positive safe integer");
  if (request.maxResponseBytes !== undefined && !isPositiveSafeInteger(request.maxResponseBytes)) throw new TypeError("maxResponseBytes must be a positive safe integer");
}

function combineSignals(caller: AbortSignal | undefined, deadline: AbortSignal | undefined): AbortSignal | undefined {
  return caller && deadline ? AbortSignal.any([caller, deadline]) : caller ?? deadline;
}

/** Builds an adapter-friendly outbound port. Every hop is resolved, checked, and pinned before I/O.
 * Socket idle time is bounded on every hop. An optional totalDeadlineMs includes DNS,
 * redirect hops and decoded body reads; it is never inferred from the idle budget.
 */
export function createHttpClient(required: GuardedHttpRequired): HttpClientPort {
  const { transport, policy, dns, clock, userAgent } = required;
  if (!userAgent.trim()) throw new TypeError("userAgent is required");
  assertValidPolicy(policy);
  return { async send({ request }, { redirect = "follow" } = {}): Promise<HttpResponse> {
    assertValidRequestLimits(request);
    const deadline = request.totalDeadlineMs === undefined ? undefined : clock.timeoutSignal({ timeoutMs: request.totalDeadlineMs });
    const signal = combineSignals(request.signal, deadline);
    try {
      const guardedRequest = { ...request, ...(signal === undefined ? {} : { signal }), headers: withDefaultUserAgent(request.headers, userAgent) };
      return await sendWithPolicy({ hop: { transport, policy, dns, redirect }, request: guardedRequest, redirectsFollowed: 0 });
    } catch (error) {
      if (deadline?.aborted && !request.signal?.aborted) throw new FetchTimeoutError(request.url, request.totalDeadlineMs!);
      throw error;
    }
  } };
}

async function resolveBeforeDeadline<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { if (abort) signal.removeEventListener("abort", abort); }
}
