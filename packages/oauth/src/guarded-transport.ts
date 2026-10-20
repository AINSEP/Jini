import type { CustomFetch, FetchBody } from 'openid-client';
import { readBoundedOAuthText, type BoundedJsonMessages } from './bounded-json.js';
import { OAuthError } from './errors.js';
import type { OAuthHttpPorts } from './ports.js';
import { assertOAuthResponseNotRedirect } from './transport-response.js';

/** Internal adapter inputs: callers retain their operation's timeout, endpoint label and error copy. */
interface OAuthCustomFetchDeps extends OAuthHttpPorts {
  readonly timeoutMs: number;
  readonly endpointLabel: string;
  readonly responseMessages: Pick<BoundedJsonMessages, 'overflowMessage' | 'overflowOperatorAction'>;
}
interface OAuthCustomFetchOptions {
  /** Omit for the existing 64 KiB cap; device authorization supplies its tighter 16 KiB cap. */
  readonly maxResponseBytes?: number;
}

/** Adapts upstream form/JSON bodies to the host's string-only OAuth HTTP port.
 * @returns A serialized body, or undefined for an absent body (including upstream null).
 * @throws {OAuthError} OAUTH_INVALID_REQUEST for unsupported binary/streaming uploads.
 * @complexity O(n) time and space for a form body of n characters; O(1) for a string.
 */
function serializeOAuthBody(body: FetchBody): string | undefined {
  if (body == null) return undefined;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof body === 'string') return body;
  // The host contract supports form/JSON strings. Never silently discard an unsupported upload.
  throw new OAuthError({
    code: 'OAUTH_INVALID_REQUEST', message: 'unsupported OAuth request body',
    operatorAction: 'Use a form-encoded or JSON string body for this OAuth operation.',
  });
}

/** Creates the internal openid-client (also oauth4webapi-compatible) customFetch hook.
 * Supply this hook on every upstream HTTP operation, including discovery, JWKS and registration.
 * URL policy and connection-time DNS pinning remain in the supplied host ports; no native fetch
 * fallback is used. The port must honor abort signals through the complete response body read.
 * Upstream HTTP errors pass through for protocol processing; transport/guard errors retain identity
 * so each facade operation can preserve its own existing error mapping and operator copy.
 * @param requiredArgs - Guarded HTTP ports and the operation's deadline, label and overflow copy.
 * @param optionalArgs - The operation's response byte cap, defaulting to the shared OAuth cap.
 * @returns A hook with the upstream positional ABI, hidden from the public facade.
 * @throws {OAuthError} For unsafe endpoints, redirects, oversized responses or unsupported uploads.
 * @complexity O(n) time and space in the request form and bounded response body; one HTTP call.
 */
export function createOAuthCustomFetch(
  { fetchFn, guard, timeoutMs, endpointLabel, responseMessages }: OAuthCustomFetchDeps,
  { maxResponseBytes }: OAuthCustomFetchOptions = {},
): CustomFetch {
  // The upstream library owns this positional ABI; it is not a public facade operation.
  return async (url, options) => {
    const endpoint = guard.assertSafeUrl({ raw: url, label: endpointLabel });
    const body = serializeOAuthBody(options.body);
    const deadline = AbortSignal.timeout(timeoutMs);
    // A library/caller cancellation and our operation-specific deadline must both remain effective.
    const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);
    signal.throwIfAborted();
    const response = await fetchFn({ url: endpoint.href }, {
      method: options.method, headers: { ...options.headers }, redirect: 'error', signal,
      ...(body === undefined ? {} : { body }),
    });
    await assertOAuthResponseNotRedirect({ response });
    // Bound the stream before upstream's response.json() can buffer it without a size limit.
    // Buffering also keeps the deadline active through body consumption, not just the headers.
    const text = await readBoundedOAuthText(response, responseMessages, maxResponseBytes);
    return new Response(response.body === null ? null : text, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  };
}
