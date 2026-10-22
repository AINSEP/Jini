import type { HttpClientPort, HttpRequest, HttpResponse, RequestRedirect } from "@jini-ai/core/primitives";

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
  { method = "GET", headers = {}, redirect = "error", ...rest }: GuardedFetchOptions = {},
): Promise<Response> {
  const response = await client.send({ request: toHttpRequest({ method, url, timeoutMs, headers }, rest) }, { redirect });
  if (isTruncated(response)) throw new Error("guarded response was truncated by the byte policy");
  // Fetch prohibits bodies for HEAD and these statuses, even when a transport supplies an empty buffer.
  const bodyless = method === "HEAD" || [204, 205, 304].includes(response.status);
  return new Response(bodyless ? null : responseBody(response), { status: response.status, headers: responseHeaders(response) });
}

function toHttpRequest(
  { method, url, timeoutMs, headers }: { method: HttpRequest["method"]; url: string; timeoutMs: number; headers: NonNullable<GuardedFetchOptions["headers"]> },
  { body, signal, idleTimeoutMs, totalDeadlineMs }: Pick<GuardedFetchOptions, "body" | "signal" | "idleTimeoutMs" | "totalDeadlineMs">,
): HttpRequest {
  return {
    method, url, timeoutMs, headers: Object.fromEntries(new Headers(headers).entries()),
    ...(body === undefined ? {} : { body: String(body) }),
    ...(signal === undefined ? {} : { signal }),
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
    ...(totalDeadlineMs === undefined ? {} : { totalDeadlineMs }),
  };
}

// With bytes present, the byte-specific flag decides; the coarse flag only fills in when it is absent.
function isTruncated(response: HttpResponse): boolean | undefined {
  return response.bodyBytes === undefined
    ? response.bodyTruncated : response.bodyBytesTruncated ?? response.bodyTruncated;
}

function responseHeaders(response: HttpResponse): Headers {
  const resultHeaders = new Headers(response.headers);
  resultHeaders.delete("content-encoding");
  resultHeaders.delete("content-length");
  if (response.setCookies !== undefined) {
    resultHeaders.delete("set-cookie");
    for (const cookie of response.setCookies) resultHeaders.append("set-cookie", cookie);
  }
  return resultHeaders;
}

function responseBody(response: HttpResponse): string | Buffer {
  return response.bodyBytes === undefined ? response.bodyText : Buffer.from(response.bodyBytes);
}
