import type { HttpClientPort, HttpRequest } from '@jini-ai/core/primitives';
import { guardedFetch } from '@jini-ai/platform/http/guarded';

/** The host supplies a policy-enforcing client, never a raw fetch implementation. */
export interface MediaOutboundOptions {
  /** Override caller-facing transport diagnostics without changing policy. */
  readonly outboundMessages?: Partial<typeof defaultMediaOutboundMessages>;
  /** Required for network I/O. Pure context/request builders may omit it. */
  readonly httpClient?: HttpClientPort;
  /** @deprecated Configure allowPrivateNetwork on the explicit Node client adapter instead. */
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
  { init = {}, httpClient, outboundMessages }: MediaOutboundOptions & { httpClient: HttpClientPort; init?: RequestInit },
): Promise<Response> {
  const messages = { ...defaultMediaOutboundMessages, ...outboundMessages };
  // Every wire refusal happens before any I/O starts.
  const { method, body } = validateMediaWireRequest({ init, messages });
  const client = requireMediaHttpClient({ httpClient });
  return guardedFetch({ client, url, timeoutMs }, {
    method,
    ...(init.headers === undefined ? {} : { headers: init.headers }),
    ...(body == null ? {} : { body }),
    ...(init.signal == null ? {} : { signal: init.signal }),
    totalDeadlineMs: timeoutMs,
    redirect: 'error',
  });
}

/** Refuse, in this order: a raw dispatcher, a method outside the guarded client's set, a non-text body.
 * @throws TypeError carrying the matching (possibly host-overridden) message.
 */
function validateMediaWireRequest(
  { init, messages }: { init: RequestInit; messages: typeof defaultMediaOutboundMessages },
): { method: HttpRequest['method']; body: string | URLSearchParams | null | undefined } {
  if (init.dispatcher !== undefined) throw new TypeError(messages.dispatcherRefused);
  const method = (init.method ?? 'GET').toUpperCase();
  if (!isMediaMethod(method)) throw new TypeError(messages.unsupportedMethod);
  const body = init.body;
  if (body != null && typeof body !== 'string' && !(body instanceof URLSearchParams)) {
    throw new TypeError(messages.unsupportedBody);
  }
  return { method, body };
}

/** Resolve the trusted client on legacy context carriers without constructing a fallback.
 * @throws TypeError before I/O if a standalone renderer/runtime has no injected client.
 */
export function requireMediaHttpClient({ httpClient }: Pick<MediaOutboundOptions, 'httpClient'>): HttpClientPort {
  if (!httpClient) throw new TypeError('Media outbound requires an injected guarded HttpClientPort');
  return httpClient;
}

function isMediaMethod(method: string): method is HttpRequest['method'] {
  return method === 'GET' || method === 'HEAD' || method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}
