/** Explicit Node adapter entry. Hosts construct this once and inject it into media services. */
import type { HttpClientPort } from '@jini-ai/core/primitives';
import { FETCH_TIMEOUT_MS } from '@jini-ai/platform/fetch-with-timeout';
import { createHttpClient, createNodeGuardedHttpPorts } from '@jini-ai/platform/http/guarded';
import type { DnsResolver } from '@jini-ai/platform/http/guarded';

export interface NodeMediaHttpClientOptions {
  readonly allowPrivateNetwork?: boolean;
  readonly dns?: DnsResolver;
}

/** The default policy client: public http(s) peers only unless the caller explicitly opts into
 * private-network development, never following redirects.
 * @returns A DNS-pinned, bounded client; policy and transport failures reject send.
 */
export function createNodeMediaHttpClient(
  _required: Record<string, never>,
  { allowPrivateNetwork, dns }: NodeMediaHttpClientOptions = {},
): HttpClientPort {
  return createHttpClient({
    ...createNodeGuardedHttpPorts({}),
    ...(dns === undefined ? {} : { dns }),
    userAgent: 'media-provider',
    policy: {
      allowedSchemes: ['http', 'https'],
      denyPrivateAddresses: allowPrivateNetwork !== true,
      devHostAllowlist: [],
      maxRedirects: 0,
      connectTimeoutMs: FETCH_TIMEOUT_MS.GENERATE,
      // Media can contain video; bound buffering at 96 MiB. Hosts may inject a stricter policy.
      maxResponseBytes: 96 * 1024 * 1024,
      maxDecompressedBytes: 96 * 1024 * 1024,
    },
  });
}

