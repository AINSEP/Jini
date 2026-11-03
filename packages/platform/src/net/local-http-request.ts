import { X509Certificate } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isLoopbackHostname } from './address.js';

/** Bounded private local-control request, with the same pinned-leaf TLS policy as local probes.
 * Never follows redirects, resolves DNS, logs payloads, or permits remote credentials.
 * @returns Status, content type and bounded response bytes. Transport/size/deadline errors reject.
 * @complexity O(response bytes), bounded to maxBytes (1 MiB) and timeoutMs (5s) by default.
 */
export function requestLoopbackHttp({ url, method, headers = {}, body }: {
  url: string; method: string; headers?: Readonly<Record<string, string>>; body?: string;
}, { certificate, timeoutMs = 5000, maxBytes = 1024 * 1024 }: {
  certificate?: string | Buffer | undefined; timeoutMs?: number; maxBytes?: number;
} = {}): Promise<{ status: number; body: Buffer; contentType: string | undefined }> {
  const target = new URL(url);
  if (!isLoopbackHostname({ hostname: target.hostname }) || !['http:', 'https:'].includes(target.protocol)) {
    return Promise.reject(new Error('Expected loopback HTTP URL'));
  }
  const trust = certificate === undefined ? {} : { ca: new X509Certificate(certificate).toString(), allowPartialTrustChain: true };
  return new Promise((resolve, reject) => {
    const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(target, { method, headers, agent: false, signal: AbortSignal.timeout(timeoutMs),
      hostname: '127.0.0.1', servername: 'localhost', rejectUnauthorized: true, ...trust,
    }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { res.destroy(new Error('Local response too large')); return; }
        chunks.push(chunk);
      });
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode ?? 502, body: Buffer.concat(chunks), contentType: res.headers['content-type'] }));
    });
    req.once('error', reject);
    req.end(body);
  });
}
