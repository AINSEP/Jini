import type { HttpClientPort, HttpRequest } from '@jini-ai/core/primitives';
import { FETCH_TIMEOUT_MS } from '@jini-ai/platform/fetch-with-timeout';
import { createHttpClient, createNodeGuardedHttpPorts, guardedFetch } from '@jini-ai/platform/http/guarded';
import type { DnsResolver } from '@jini-ai/platform/http/guarded';

/** The host supplies a policy-enforcing client, never a raw fetch implementation. */
export interface MediaOutboundOptions {
  /** Override caller-facing transport diagnostics without changing policy. */
  readonly outboundMessages?: Partial<typeof defaultMediaOutboundMessages>;
  readonly httpClient?: HttpClientPort;
  /** Explicit local-development capability. Applies only to the default client. */
  readonly allowPrivateNetwork?: boolean;
}

export const defaultMediaOutboundMessages = {
  unsupportedMethod: 'Unsupported media HTTP method',
  unsupportedBody: 'Media HTTP body must be a string or URLSearchParams',
  dispatcherRefused: 'Configure media connection pooling on the guarded HTTP client',
  dnsResolutionFailed: 'DNS resolution failed',
  urlCredentialsBlocked: 'URL credentials blocked',
};

/** Adapt the fetch-shaped vendor wire request without allowing it to override peer pinning.
 * DNS and decoded-body work share the original timeout backstop. Redirects are refused,
 * including for explicitly enabled private-network development clients.
 * @throws Policy refusals, DNS/transport failures, unsupported bodies or methods.
 * @complexity O(h + b) for h headers and b bounded decoded response bytes.
 */
export async function fetchMediaOutbound(
  { url, timeoutMs }: { url: string; timeoutMs: number },
  { init = {}, httpClient, allowPrivateNetwork, dns, outboundMessages }: MediaOutboundOptions & { init?: RequestInit; dns?: DnsResolver } = {},
): Promise<Response> {
  const messages = { ...defaultMediaOutboundMessages, ...outboundMessages };
  if (init.dispatcher !== undefined) throw new TypeError(messages.dispatcherRefused);
  const method = (init.method ?? 'GET').toUpperCase();
  if (!isMediaMethod(method)) throw new TypeError(messages.unsupportedMethod);
  const body = init.body;
  if (body != null && typeof body !== 'string' && !(body instanceof URLSearchParams)) {
    throw new TypeError(messages.unsupportedBody);
  }
  const client = httpClient ?? createHttpClient({
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
  return guardedFetch({ client, url, timeoutMs }, {
    method,
    ...(init.headers === undefined ? {} : { headers: init.headers }),
    ...(body == null ? {} : { body }),
    ...(init.signal == null ? {} : { signal: init.signal }),
    totalDeadlineMs: timeoutMs,
    redirect: 'error',
  });
}

function isMediaMethod(method: string): method is HttpRequest['method'] {
  return method === 'GET' || method === 'HEAD' || method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}
