import { describe, expect, it } from 'vitest';
import { isLoopbackApiHost, isBlockedExternalApiHostname } from '../address.js';
// Vector tables are copied from ui's endpoint-policy tests; no cross-package source import.
/** Endpoints no tab may accept, each with the reason it is dangerous rather than merely odd. */
const BLOCKED = [
  ['http://169.254.169.254/latest/meta-data/', 'cloud metadata service'],
  ['http://169.254.169.254./', 'metadata service, RFC 1034 trailing dot'],
  ['http://10.0.0.5/v1', 'RFC1918 10/8'],
  ['http://192.168.1.1/v1', 'RFC1918 192.168/16'],
  ['http://172.16.0.1/v1', 'RFC1918 172.16/12'],
  ['http://100.64.0.1/v1', 'CGNAT'],
  ['http://0.0.0.0/v1', 'unspecified'],
  ['http://[::]/v1', 'IPv6 unspecified'],
  ['http://[fd00::1]/v1', 'IPv6 unique-local'],
  ['http://[fe80::1]/v1', 'IPv6 link-local'],
  ['http://[::ffff:10.0.0.5]/v1', 'IPv4-mapped IPv6 RFC1918'],
  ['http://[::ffff:a00:5]/v1', 'IPv4-mapped IPv6 RFC1918, hex form'],
  ['http://224.0.0.1/v1', 'multicast'],
] as const;

/** Endpoints that must keep working — loopback is a first-class config (local model servers). */
const ALLOWED = [
  'https://api.openai.com/v1',
  'https://example.com',
  'http://localhost:11434/v1',
  'http://localhost./v1',
  'http://127.0.0.1:11434/v1',
  'http://[::1]:11434/v1',
  'http://[::ffff:127.0.0.1]/v1',
] as const;


const TRIMMABLE = [0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c, 0xa0, 0xfeff, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000, 0x2028, 0x2029];
function accepts(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && (isLoopbackApiHost({ hostname: url.hostname }) || !isBlockedExternalApiHostname({ hostname: url.hostname }));
  } catch { return false; }
}
describe('copied browser endpoint-policy vectors', () => {
  // PARITY: provider loopback remains allowed, private host literals remain blocked.
  it.each(BLOCKED)('rejects %s (%s)', raw => expect(accepts(raw)).toBe(false));
  // PARITY: public endpoints and loopback provider URLs remain valid.
  it.each(ALLOWED)('accepts %s', raw => expect(accepts(raw)).toBe(true));
  // PARITY: every trim character is tested in each padding position, including NBSP/BOM.
  it('retains the vectors under the whitespace cross-product', () => {
    for (const code of TRIMMABLE) {
      const padding = String.fromCodePoint(code);
      for (const [raw, expected] of [...BLOCKED.map(([raw]) => [raw, false] as const), ...ALLOWED.map(raw => [raw, true] as const)]) {
        for (const padded of [padding + raw, raw + padding, padding + raw + padding]) expect(accepts(padded), JSON.stringify(padded)).toBe(expected);
      }
    }
  });
  // PARITY: no DNS inference or arbitrary substring matching is added to the hostname policy.
  it.each(['123e4567-e89b-12d3-a456-426614174000', 'a'.repeat(40), 'claude-sonnet-4-5-20250929', '/absolute/path', 'ERR-12345678901234567890'])('does not classify opaque identifier %s as an IP', hostname => {
    expect(isBlockedExternalApiHostname({ hostname })).toBe(false);
    expect(isLoopbackApiHost({ hostname })).toBe(false);
  });
});
