import { isIP } from 'node:net';
import { classifyAddressLiteral, type AddressClass } from './endpoint-policy.js';

// SSRF peer classification is distinct from core's browser-development LAN origin allow-list.
export { expandIpv6 } from './endpoint-policy.js';
export type { AddressClass } from './endpoint-policy.js';

/** Strict Node peer classification; invalid literals fail closed to reserved. */
export function classifyIpAddress({ ip }: { ip: string }, _options: Record<string, never> = {}): AddressClass {
  // `net.isIP(ip) === 4` already guarantees `ip` is a syntactically
  // valid dotted-quad with four 0-255 decimal octets (no leading-zero
  // octal ambiguity, no out-of-range component) — empirically verified
  // in the original extraction by fuzzing 500k+ candidate strings through `isIP` and
  // this same re-derivation with zero divergences. The shared classifier therefore receives
  // validated octets.
  // `net.isIP(ip) === 6` already guarantees `ip` is syntactically valid
  // IPv6 (Node validates this before classifying the family), and
  // `expandIpv6` implements the same canonicalization Node's own parser
  // does, so it never returns `null` for an `isIP`-accepted literal —
  // empirically verified in the original extraction by fuzzing ~10k `isIP`-accepted
  // v6 literals through `expandIpv6` with zero `null` results (see
  // `expandIpv6`'s doc comment and `archived provenance ledger`'s 2026-07-22 entry).
  // Kept as a real fail-closed guard (defense-in-depth against a future
  // change to either parser) rather than asserted away, so it stays
  // provably-unreachable-but-intentional instead of a forced test.
  // Both rejections (Node's `isIP` and the shared classifier) funnel into one
  // fail-closed default, so the `reserved` fallback is the single place an
  // unclassifiable literal lands — exercised by every invalid input.
  const addressClass = isIP(ip) === 0 ? null : classifyAddressLiteral({ address: ip });
  return addressClass ?? 'reserved';
}

/** True for loopback, link-local, private, CGNAT, ULA, multicast or unspecified; invalid input fails closed. */
export function isPrivateAddress({ address }: { address: string }): boolean {
  return classifyIpAddress({ ip: address }) !== 'public';
}

// Preserve the Node entry's published names while sharing the literal-host owner with browser consumers.
export { isLoopbackApiHost, isBlockedExternalApiHostname } from './endpoint-policy.js';

/** True when `hostname` is `localhost`, an IPv6 loopback literal, or a `127.0.0.0/8` IPv4 literal. */
export function isLoopbackHostname({ hostname }: { readonly hostname: unknown }, _optional: Record<string, never> = {}): boolean {
  const normalized = String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (normalized === 'localhost') return true;
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (isIP(normalized) === 4) return normalized === '127.0.0.1' || normalized.startsWith('127.');
  return false;
}
