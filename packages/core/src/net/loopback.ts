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
