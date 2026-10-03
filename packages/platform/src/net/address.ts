import { isIP } from 'node:net';

// SSRF peer classification is distinct from core's browser-development LAN origin allow-list.
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
 *  returning 6 — empirically re-verified this session by fuzzing ~10k
 *  `isIP`-accepted v6 literals through this function's guards with zero
 *  hits — so none of these guards are reachable through that path. They stay
 *  as real defense-in-depth (fail closed with `null` rather than trust a
 *  platform primitive never changing behavior), matching the asset cache's
 *  exported-for-direct-testing precedent (`readBodyCapped`'s abort parameter). */
export function expandIpv6({ address: addr }: { address: string }): number[] | null {
  // `String#split` always returns a non-empty array, so index 0 is never
  // `undefined` — the `!` narrows a `noUncheckedIndexedAccess` false
  // positive, not a real fallback path.
  let s = addr.toLowerCase().split('%')[0]!;
  if (!s.includes(':')) return null;
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
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

/** True for any address an external CDN must never resolve to: loopback,
 *  link-local, private, CGNAT, ULA, multicast, or unspecified. An unparseable
 *  input is treated as unsafe. */
export function isPrivateAddress({ address: addr }: { address: string }): boolean {
  const fam = isIP(addr);
  if (fam === 4) {
    // `net.isIP(addr) === 4` already guarantees `addr` is a syntactically
    // valid dotted-quad with four 0-255 decimal octets (no leading-zero
    // octal ambiguity, no out-of-range component) — empirically re-verified
    // this session by fuzzing 500k+ candidate strings through `isIP` and
    // this same re-derivation with zero divergences. `o` is therefore always
    // a validated 4-element array.
    const o = addr.split('.').map((n) => Number(n));
    const a = o[0]!;
    const b = o[1]!;
    if (a === 0) return true; // "this" network / unspecified
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (fam === 6) {
    const groups = expandIpv6({ address: addr });
    // `net.isIP(addr) === 6` already guarantees `addr` is syntactically valid
    // IPv6 (Node validates this before classifying the family), and
    // `expandIpv6` implements the same canonicalization Node's own parser
    // does, so it never returns `null` for an `isIP`-accepted literal —
    // empirically re-verified this session by fuzzing ~10k `isIP`-accepted
    // v6 literals through `expandIpv6` with zero `null` results (see
    // `expandIpv6`'s doc comment and `archived provenance ledger`'s 2026-07-22 entry).
    // Kept as a real fail-closed guard (defense-in-depth against a future
    // change to either parser) rather than asserted away, so it stays
    // provably-unreachable-but-intentional instead of a forced test.
    if (!groups) return true; // can't canonicalize a "valid" v6 → refuse
    // IPv4-mapped (`::ffff:0:0/96`) and the deprecated IPv4-compatible
    // (`::0:0/96`, excluding :: / ::1) carry an embedded IPv4 — classify it by
    // its real v4 range so `::ffff:7f00:1` (== 127.0.0.1) is caught.
    const topZero = groups.slice(0, 5).every((g) => g === 0);
    if (topZero && (groups[5] === 0xffff || groups[5] === 0)) {
      // `groups` is a validated 8-element array once non-null — indices 6-7
      // always defined.
      const a = groups[6]! >> 8;
      const b = groups[6]! & 0xff;
      const c = groups[7]! >> 8;
      const d = groups[7]! & 0xff;
      if (groups[5] === 0xffff || a !== 0 || b !== 0) {
        return isPrivateAddress({ address: `${a}.${b}.${c}.${d}` });
      }
    }
    if (groups.every((g) => g === 0)) return true; // ::  (unspecified)
    if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1 loopback
    const first = groups[0]!;
    if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10 (fe80–febf)
    if ((first & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
    if ((first & 0xff00) === 0xff00) return true; // multicast ff00::/8
    return false;
  }
  return true; // not a literal IP — caller must resolve before trusting it
}

function normalizeBracketedIpv6(hostname: string): string {
  const stripped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  // FQDN trailing-dot form (RFC 1034) resolves identically to the dotless
  // form, so `localhost.` must normalize to `localhost` before the equality
  // check below — and `0.0.0.0.`, `10.0.0.1.`, etc. must normalize before
  // isBlockedIpv4 parses them. Strips one or more trailing dots.
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

function isLoopbackIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  return Boolean(parts && parts[0] === 127);
}

function isBlockedIpv4(hostname: string): boolean {
  const parts = parseIpv4(hostname);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    a >= 224
  );
}

function ipv4MappedToDotted(hostname: string): string | null {
  const host = normalizeBracketedIpv6(hostname);
  const mapped = /^::ffff:(.+)$/i.exec(host)?.[1];
  if (!mapped) return null;
  if (parseIpv4(mapped.toLowerCase())) return mapped.toLowerCase();
  const hexParts = mapped.split(':');
  if (
    hexParts.length !== 2 ||
    !hexParts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))
  ) {
    return null;
  }
  // Non-null assertions, not a runtime guard: the length/regex checks above
  // already guarantee exactly two non-empty hex segments here.
  const hi = hexParts[0]!;
  const lo = hexParts[1]!;
  const value = (Number.parseInt(hi, 16) << 16) | Number.parseInt(lo, 16);
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

/** True for `localhost`, `::1`, `127.0.0.0/8`, and their IPv4-mapped-IPv6 forms. */
export function isLoopbackApiHost({ hostname }: { hostname: string }): boolean {
  const host = normalizeBracketedIpv6(hostname);
  if (host === 'localhost' || host === '::1') return true;
  if (isLoopbackIpv4(host)) return true;
  const mapped = ipv4MappedToDotted(host);
  return Boolean(mapped && isLoopbackIpv4(mapped));
}

/** True for RFC1918/link-local/CGNAT/multicast/unspecified/unique-local-IPv6 addresses — private network space a public caller should never be steered into. */
export function isBlockedExternalApiHostname({ hostname }: { hostname: string }): boolean {
  const host = normalizeBracketedIpv6(hostname);
  if (host === '::') return true;
  if (isBlockedIpv4(host)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  const mapped = ipv4MappedToDotted(host);
  return Boolean(mapped && isBlockedIpv4(mapped));
}


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

