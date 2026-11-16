/**
 * Node's own strict dotted-quad IPv4 pattern (lib/internal/net.js). Core carries no Node imports,
 * so this regex stands in for the runtime's own IPv4 check; a parity test in platform proves they agree.
 */
const STRICT_IPV4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;

/** True when `hostname` is `localhost`, an IPv6 loopback literal, or a `127.0.0.0/8` IPv4 literal. */
export function isLoopbackHostname({ hostname }: { readonly hostname: unknown }, _optional: Record<string, never> = {}): boolean {
  const normalized = String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (normalized === 'localhost') return true;
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (STRICT_IPV4.test(normalized)) return normalized === '127.0.0.1' || normalized.startsWith('127.');
  return false;
}

/**
 * True when `address` (typically `req.socket.remoteAddress`) is a loopback peer, unwrapping an IPv4-mapped
 * IPv6 prefix first. IPv4 is judged by the same strict dotted-quad pattern `isLoopbackHostname` uses, which
 * rejects leading-zero octets and trailing text exactly as the runtime's own IPv4 check does.
 */
export function isLoopbackPeerAddress({ address }: { readonly address: unknown }, _optional: Record<string, never> = {}): boolean {
  if (typeof address !== 'string') return false;
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) return false;
  if (normalized.startsWith('::ffff:')) return isLoopbackPeerAddress({ address: normalized.slice('::ffff:'.length) });
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (STRICT_IPV4.test(normalized)) return normalized === '127.0.0.1' || normalized.startsWith('127.');
  return false;
}
