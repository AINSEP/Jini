import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import type { PinnedPeer } from "./types.js";
import type { HttpTransportAdapter } from "./ports.js";

/**
 * Dial only the policy-vetted IP, never re-resolve the URL hostname: otherwise DNS rebinding
 * could change the destination between validation and connection. Preserve the original Host
 * authority and hostname TLS SNI for virtual hosting and certificate validation.
 * This raw transport belongs behind the guarded client, which validates each redirect hop.
 * Responses are buffered; the absolute ceiling bounds memory even without a caller byte limit.
 */
/** Last-resort decoded-byte bound independent of any caller's response policy. */
const ABSOLUTE_MAX_BYTES = 100 * 1024 * 1024;

export class FetchHttpTransportAdapter implements HttpTransportAdapter {
  constructor(_required: Record<string, never>) {}
  async requestPinned({ request: req, peer }: { request: HttpRequest; peer: PinnedPeer }): Promise<HttpResponse> {
    const url = new URL(req.url);
    const isHttps = url.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const idleTimeoutMs = req.idleTimeoutMs ?? req.timeoutMs!;

    const options: RequestOptions = {
      method: req.method,
      host: peer.ip,
      port: peer.port,
      path: `${url.pathname}${url.search}`,
      headers: { ...req.headers, host: peer.authority },
      // Node's timeout is per-socket inactivity, including the response body. Do not
      // replace it with a timer over total transfer time: active large bodies can be slow.
      timeout: idleTimeoutMs,
      ...(req.signal ? { signal: req.signal } : {}),

      // RFC 6066 forbids IP-literal SNI. Omit the option entirely when no hostname is supplied.
      ...(isHttps && peer.tlsServerName ? { servername: peer.tlsServerName } : {}),
    };

    return new Promise<HttpResponse>((resolve, reject) => {
      const clientRequest = requestFn(options, (res) => {

        // HEAD can advertise GET's compression but has no body to decompress.
        const decoded = req.method === "HEAD" ? res : decodeBody(res.headers["content-encoding"], res);
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        let settled = false;
        const finish = (truncated: boolean) => {
          if (settled) return;
          settled = true;
          // Concatenate once: text is a lossy UTF-8 view, while binary consumers retain the same
          // undecoded bytes. Buffer is a Uint8Array, so returning it needs no second byte copy.
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            headers: flattenHeaders(res.headers),
            setCookies: res.headers["set-cookie"] ?? [],
            bodyText: body.toString("utf8"), bodyBytes: body,
            ...(truncated ? { bodyTruncated: true, bodyBytesTruncated: true } : {}),
          });
        };
        const cap = req.maxResponseBytes === undefined ? ABSOLUTE_MAX_BYTES : Math.min(req.maxResponseBytes, ABSOLUTE_MAX_BYTES);
        decoded.on("data", (chunk: Buffer) => {
          if (settled) return;
          const remaining = cap - totalBytes;
          if (chunk.length > remaining) {
            if (req.maxResponseBytes === undefined) {
              clientRequest.destroy(new Error("response exceeded the absolute size ceiling"));
              return;
            }
            chunks.push(chunk.subarray(0, remaining));
            finish(true);

            decoded.destroy?.();
            res.destroy();
            clientRequest.destroy();
            return;
          }
          totalBytes += chunk.length;
          chunks.push(chunk);
        });
        decoded.on("end", () => finish(false));
        decoded.on("error", reject);
      });

      clientRequest.on("timeout", () => {
        clientRequest.destroy(new Error(`request timed out after ${idleTimeoutMs}ms`));
      });
      clientRequest.on("error", reject);

      if (req.body !== undefined) clientRequest.write(req.body);
      clientRequest.end();
    });
  }
}

function decodeBody(
  contentEncoding: string | undefined,
  stream: NodeJS.ReadableStream
): NodeJS.ReadableStream & { destroy?: () => void } {
  switch (contentEncoding) {
    case "gzip":
      return stream.pipe(createGunzip());
    case "deflate":
      return stream.pipe(createInflate());
    case "br":
      return stream.pipe(createBrotliDecompress());
    default:
      return stream;
  }
}

function flattenHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    flat[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return flat;
}
