import type { CustomFetch, FetchBody } from 'openid-client';
import { readBoundedOAuthText, type BoundedJsonMessages } from './bounded-json.js';
import { OAuthError } from './errors.js';
import type { OAuthHttpPorts } from './ports.js';
import { assertOAuthResponseNotRedirect } from './endpoint-safety.js';

interface OAuthCustomFetchDeps extends OAuthHttpPorts {
  readonly timeoutMs: number;
  readonly endpointLabel: string;
  readonly responseMessages: Pick<BoundedJsonMessages, 'overflowMessage' | 'overflowOperatorAction'>;
}
interface OAuthCustomFetchOptions {
  /** Omit for the existing 64 KiB cap; device authorization supplies its tighter 16 KiB cap. */
  readonly maxResponseBytes?: number;
  readonly unreachable?: { readonly message: string; readonly operatorAction: string; readonly preserveCause?: false };
}

function serializeOAuthBody(body: FetchBody): string | undefined {
  if (body == null) return undefined;
  if (body instanceof URLSearchParams || typeof body === 'string') return body.toString();
  // The host contract supports form/JSON strings. Never silently discard an unsupported upload.
  throw new OAuthError({
    code: 'OAUTH_INVALID_REQUEST', message: 'unsupported OAuth request body',
    operatorAction: 'Use a form-encoded or JSON string body for this OAuth operation.',
  });
}

/** Every upstream HTTP call uses the host guard, DNS-pinned port and bounded body reader.
 * Keep the original transport failure: openid-client wraps it, and upstream protocol errors
 * can carry credentials in their causes. Each operation owns its hook and error mapping.
 */
export function createOAuthCustomFetch({ fetchFn, guard, timeoutMs, endpointLabel, responseMessages }: OAuthCustomFetchDeps,
  { maxResponseBytes, unreachable }: OAuthCustomFetchOptions = {}): CustomFetch & { failure?: { readonly error: unknown }; status?: number } {
  const fetch: CustomFetch & { failure?: { readonly error: unknown }; status?: number } = async (url, options) => {
    delete fetch.failure;
    delete fetch.status;
    try {
      const endpoint = guard.assertSafeUrl({ raw: url, label: endpointLabel });
      const body = serializeOAuthBody(options.body);
      const deadline = AbortSignal.timeout(timeoutMs);
      // A library/caller cancellation and our operation-specific deadline must both remain effective.
      const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);
      signal.throwIfAborted();
      const response = await fetchFn({ url: endpoint.href }, {
        method: options.method, headers: { ...options.headers }, redirect: 'error', signal,
        ...(body === undefined ? {} : { body }),
      }).catch(error => {
        if (!unreachable || error instanceof OAuthError) throw error;
        throw new OAuthError({ code: 'OAUTH_PROVIDER_UNREACHABLE', ...unreachable }, unreachable.preserveCause === false ? {} : { cause: error });
      });
      fetch.status = response.status;
      await assertOAuthResponseNotRedirect({ response });
      // Bound the body before upstream JSON buffering, keeping the deadline active through consumption.
      const text = await readBoundedOAuthText(response, responseMessages, maxResponseBytes);
      return new Response(response.body === null ? null : text, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } catch (error) {
      const failure = unreachable?.preserveCause === false && !(error instanceof OAuthError)
        ? new OAuthError({ code: 'OAUTH_PROVIDER_UNREACHABLE', ...unreachable }) : error;
      fetch.failure = { error: failure };
      throw failure;
    }
  };
  return fetch;
}
