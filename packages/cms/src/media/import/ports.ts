/** Binary requests use the kernel HTTP seam, compatible with the guarded platform client. */
import type { HttpRequest, HttpResponse, HttpClientPort } from "@jini-ai/core/primitives";
/**
 * The only outbound execution path. The adapter must enforce DNS/IP validation, peer pinning,
 * redirect checks and byte/time ceilings for every hop. Bind a platform guarded client's send:
 * `{ send: ({ request }) => guardedClient.send({ request }) }`.
 * A URL preflight alone does not satisfy this port's contract.
 */
export interface OutboundGuardPort {
  send(required: { request: HttpRequest; httpClient: HttpClientPort }): Promise<HttpResponse>;
}
export interface ContentSnifferPort { sniff(required: { bytes: Uint8Array }): string; }
export interface ImageImportPolicy {
  maxBytes: number;
  allowedContentTypes: ReadonlySet<string>;
  sniffer: ContentSnifferPort;
}
export interface ValidateImageBytesRequired extends ImageImportPolicy {
  source: URL | string;
  bytes: Uint8Array;
  bytesTruncated: boolean;
}
export interface FetchImageRequired extends ImageImportPolicy {
  url: string;
  httpClient: HttpClientPort;
  outboundGuard: OutboundGuardPort;
}
export interface FetchImageOptional { timeoutMs?: number; }
