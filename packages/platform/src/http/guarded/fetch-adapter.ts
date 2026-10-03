import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { HttpRequest, RequestRedirect } from "@jini-ai/core/primitives";

export interface GuardedFetchOptions {
  method?: HttpRequest["method"];
  headers?: ConstructorParameters<typeof Headers>[0];
  body?: string | URLSearchParams;
  signal?: AbortSignal;
  redirect?: RequestRedirect;
  /** Override the legacy timeoutMs socket idle budget. */
  idleTimeoutMs?: number;
  /** Optional deadline over DNS, redirects and the complete decoded body. */
  totalDeadlineMs?: number;
}

/** Projects guarded, complete decoded bytes into a Response for SDK/OAuth adapters.
 * Defaults to redirect refusal. Hosts adapt their SDK's positional fetch signature to this object API.
 * Strings and form bodies are supported; streaming uploads need a different transport contract.
 */
export async function guardedFetch(
  { client, url, timeoutMs }: { client: HttpClientPort; url: string; timeoutMs: number },
  { method = "GET", headers = {}, body, signal, redirect = "error", idleTimeoutMs, totalDeadlineMs }: GuardedFetchOptions = {},
): Promise<Response> {
  const response = await client.send({ request: {
    method, url, timeoutMs, headers: Object.fromEntries(new Headers(headers).entries()),
    ...(body === undefined ? {} : { body: String(body) }),
    ...(signal === undefined ? {} : { signal }),
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
    ...(totalDeadlineMs === undefined ? {} : { totalDeadlineMs }),
  } }, { redirect });
  const truncated = response.bodyBytes === undefined
    ? response.bodyTruncated : response.bodyBytesTruncated ?? response.bodyTruncated;
  if (truncated) throw new Error("guarded response was truncated by the byte policy");
  const resultHeaders = new Headers(response.headers);
  resultHeaders.delete("content-encoding");
  resultHeaders.delete("content-length");
  if (response.setCookies !== undefined) {
    resultHeaders.delete("set-cookie");
    for (const cookie of response.setCookies) resultHeaders.append("set-cookie", cookie);
  }
  const bytes = response.bodyBytes === undefined ? response.bodyText : Buffer.from(response.bodyBytes);
  // Fetch prohibits bodies for HEAD and these statuses, even when a transport supplies an empty buffer.
  const bodyless = method === "HEAD" || [204, 205, 304].includes(response.status);
  return new Response(bodyless ? null : bytes, { status: response.status, headers: resultHeaders });
}
