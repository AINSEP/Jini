/**
 * Browser-safe literal endpoint hostname policy. No Node imports or DNS effects:
 * operator-configured local model servers deliberately keep their loopback
 * exception. Resolved-peer validation and strict IP parsing belong to the Node
 * adapters, whose different trust boundaries must not be collapsed into this.
 * SSRF peer classification is distinct from core's browser-development LAN origin allow-list.
 */
function normalizeBracketedIpv6(hostname: string): string {
  const stripped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  // FQDN trailing-dot form (RFC 1034) resolves identically to the dotless
  // form, so `localhost.` must normalize to `localhost` before the equality
  // check below — and `0.0.0.0.`, `10.0.0.1.`, etc. must normalize before
  // the IPv4 classifier parses them. Strips one or more trailing dots.
  return stripped.toLowerCase().replace(/\.+$/, '');
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const parsed = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : null;
  });
  if (parsed.some((part) => part === null)) return null;
  return [parsed[0]!, parsed[1]!, parsed[2]!, parsed[3]!];
}

/** Expand an IPv6 literal (with `::` compression and/or an embedded dotted
 *  IPv4 tail) into its eight 16-bit groups, or null if it does not parse.
 *  Node's URL parser normalizes mapped literals to hex (`::ffff:127.0.0.1` →
 *  `::ffff:7f00:1`), so a string regex can't reliably spot the mapped range —
 *  we have to canonicalize.
 *
 *  Exported (previously module-private) so its parse-failure guards are
 *  directly unit-testable: the IP classifier and guarded client gate
 *  calls behind `net.isIP(addr) === 6`, and Node's `isIP` already fully
 *  validates IPv6 syntax (including embedded-IPv4-tail octet ranges) before
 *  returning 6 — empirically verified in the original extraction by fuzzing ~10k
 *  `isIP`-accepted v6 literals through this function's guards with zero
 *  hits — so none of these guards are reachable through that path. They stay
 *  as real defense-in-depth (fail closed with `null` rather than trust a
 *  platform primitive never changing behavior), matching the asset cache's
 *  exported-for-direct-testing precedent (`readBodyCapped`'s abort parameter). */
export function expandIpv6({ address: addr }: { address: string }): number[] | null {
  // `String#split` always returns a non-empty array, so index 0 is never
  // `undefined` — the `!` narrows a `noUncheckedIndexedAccess` false
  // positive, not a real fallback path.
  const literal = addr.toLowerCase().split('%')[0]!;
  if (!literal.includes(':')) return null;
  const s = foldIpv4Tail(literal);
  if (s === null) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (p: string): number[] =>
    p === '' ? [] : p.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : Number.NaN));
  // `halves` always has at least one element (split guarantee).
  const left = parse(halves[0]!);
  let groups: number[];
  if (halves.length === 1) {
    groups = left;
  } else {
    // `halves.length === 2` here (the `> 2` case already returned above).
    const right = parse(halves[1]!);
    const fill = 8 - left.length - right.length;
    if (fill < 1) return null;
    groups = [...left, ...new Array(fill).fill(0), ...right];
  }
  if (!validIpv6Groups(groups)) return null;
  return groups;
}

/** Fold a dotted tail while retaining the parser's defense-in-depth octet validation. */
function foldIpv4Tail(s: string): string | null {
  // Fold a trailing dotted IPv4 (`…:1.2.3.4`) into two hex groups.
  const v4 = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4) {
    // `v4[2]` is the regex's second (mandatory, non-optional) capture group
    // of a successful match — always defined.
    const o = v4[2]!.split('.').map((n) => Number(n));
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    // `o` is now a validated 4-element array — indices 0-3 always defined.
    const hi = (((o[0]! << 8) | o[1]!)).toString(16);
    const lo = (((o[2]! << 8) | o[3]!)).toString(16);
    s = `${v4[1]}${hi}:${lo}`;
  }
  return s;
}

function validIpv6Groups(groups: readonly number[]): boolean {
  return groups.length === 8 && groups.every(g => Number.isInteger(g) && g >= 0 && g <= 0xffff);
}

export type AddressClass = 'public' | 'private' | 'loopback' | 'link-local' | 'reserved';

/** Classifies validated IPv4 bytes; shared by native and embedded-v4 literals. */
function classifyIpv4Bytes(bytes: readonly number[]): AddressClass {
  const [a, b] = bytes;
  if (a === 127) return 'loopback';
  // This range includes the cloud metadata address 169.254.169.254.
  if (a === 169 && b === 254) return 'link-local';
  if (a === 0 || a! >= 224) return 'reserved'; // "this" network / unspecified; multicast + reserved
  // The remaining blocked IPv4 ranges include RFC 6598 shared carrier space (100.64.0.0/10):
  // it is not globally routable and belongs with RFC 1918 private ranges for egress decisions.
  if (isPrivateIpv4Bytes(bytes)) return 'private';
  return 'public';
}

function isPrivateIpv4Bytes([a, b]: readonly number[]): boolean {
  if (a === 100) return b! >= 64 && b! <= 127;
  return a === 10 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168);
}

// Each /96 prefix carries IPv4 in the final four bytes. Matching canonical
// bytes also handles expanded IPv6 and WHATWG URL's dotted-to-hex normalization.
const EMBEDDED_IPV4_PREFIXES: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // compatible ::/96 (except native ::/::1)
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255], // mapped ::ffff:0:0/96
  [0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0], // translated ::ffff:0:0:0/96
  [0, 100, 255, 155, 0, 0, 0, 0, 0, 0, 0, 0], // well-known NAT64 64:ff9b::/96
];

function hasEmbeddedIpv4(bytes: readonly number[]): boolean {
  return EMBEDDED_IPV4_PREFIXES.some(prefix => hasPrefix(bytes, prefix));
}

function hasPrefix(bytes: readonly number[], prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

// Teredo 2001::/32 obfuscates its client IPv4, and local-use NAT64 64:ff9b:1::/48 may embed
// IPv4 at any prefix length, so neither can be classified by position: both are refused.
const UNCLASSIFIABLE_TUNNEL_PREFIXES: readonly (readonly number[])[] = [
  [0x20, 0x01, 0, 0], // Teredo 2001::/32
  [0, 0x64, 0xff, 0x9b, 0, 1], // local-use NAT64 64:ff9b:1::/48
];

/** Tunnel prefixes that reach IPv4 without a fixed /96 tail; null means not a tunnel prefix. */
function classifyTunnelIpv6(bytes: readonly number[]): AddressClass | null {
  // 6to4 2002::/16 carries its IPv4 in bytes 2-5; a host with a 6to4 route encapsulates to it.
  if (hasPrefix(bytes, [0x20, 0x02])) return classifyIpv4Bytes(bytes.slice(2, 6));
  if (UNCLASSIFIABLE_TUNNEL_PREFIXES.some(prefix => hasPrefix(bytes, prefix))) return 'reserved';
  return null;
}

/** Classifies 16 IPv6 bytes, independent of compression or dotted/hex tail spelling. */
function classifyIpv6Bytes(bytes: readonly number[]): AddressClass {
  // Native :: and ::1 retain their own meaning before the deprecated compatible-v4 range.
  if (bytes.every(n => n === 0)) return 'reserved'; // :: (unspecified)
  if (bytes.slice(0, 15).every(n => n === 0) && bytes[15] === 1) return 'loopback';
  // IPv4-mapped (::ffff:0:0/96) and deprecated IPv4-compatible (::/96)
  // carry an embedded IPv4: classify its real range so ::ffff:7f00:1 is caught.
  if (hasEmbeddedIpv4(bytes)) return classifyIpv4Bytes(bytes.slice(12));
  const tunnel = classifyTunnelIpv6(bytes);
  if (tunnel) return tunnel;
  if (bytes[0] === 255) return 'reserved'; // multicast ff00::/8
  const first = (bytes[0]! << 8) | bytes[1]!;
  if ((first & 0xffc0) === 0xfe80) return 'link-local'; // fe80::/10 (fe80–febf)
  if ((first & 0xfe00) === 0xfc00) return 'private'; // unique-local fc00::/7
  return 'public';
}

/** Pure literal classifier; null means malformed input or a hostname requiring DNS. */
export function classifyAddressLiteral({ address }: { address: string }, _options: Record<string, never> = {}): AddressClass | null {
  if (!address.includes(':')) {
    const ipv4 = parseIpv4(address);
    return ipv4 ? classifyIpv4Bytes(ipv4) : null;
  }
  const groups = expandIpv6({ address });
  if (!groups) return null;
  // The parser's length/regex checks guarantee complete groups and bytes here;
  // non-null assertions in byte classification narrow index types, not a runtime fallback.
  // Parse once, then all range decisions operate on the same 16 canonical bytes.
  const bytes = groups.flatMap(group => [group >> 8, group & 255]);
  return classifyIpv6Bytes(bytes);
}

/** True for localhost and literal loopback, including embedded IPv4 forms. */
export function isLoopbackApiHost({ hostname }: { hostname: string }): boolean {
  const host = normalizeBracketedIpv6(hostname);
  return host === 'localhost' || classifyAddressLiteral({ address: host }) === 'loopback';
}

/** Private/reserved literal hosts are blocked; configured local servers keep their loopback exception. */
export function isBlockedExternalApiHostname({ hostname }: { hostname: string }): boolean {
  const host = normalizeBracketedIpv6(hostname);
  const addressClass = classifyAddressLiteral({ address: host });
  return addressClass !== null && addressClass !== 'public' && addressClass !== 'loopback';
}
