import { X509Certificate } from 'node:crypto';
import { get as httpGet, type IncomingMessage } from 'node:http';
import { get as httpsGet } from 'node:https';
import { isLoopbackHostname } from './address.js';

/**
 * Probe a loopback service once, accepting only HTTP 200 without following redirects.
 * @param required Absolute HTTP(S) URL. Non-loopback targets are refused before connecting.
 * @param options Optional expected leaf PEM, TLS server name and request deadline (default 1500ms).
 * @returns False for transport, TLS, timeout or non-200 failures; true for an authenticated 200.
 * @throws For malformed URLs, certificate PEM or invalid timeout values (configuration errors).
 * @complexity O(c) time/space for c certificate bytes; one bounded network request.
 */
export function probeLoopbackHttp(
  { url }: { url: string },
  { certificate, servername, timeoutMs = 1500 }: { certificate?: string | Buffer | undefined; servername?: string | undefined; timeoutMs?: number } = {},
): Promise<boolean> {
  const target = new URL(url);
  if (!isLoopbackHostname({ hostname: target.hostname })) return Promise.resolve(false);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return Promise.resolve(false);
  const hostname = target.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  // Only the configured leaf is a trust anchor, never an issuer bundled after it.
  // Partial-chain trust permits mkcert leaves without installing their CA into this Node process.
  const trust = certificate === undefined ? {} : { ca: new X509Certificate(certificate).toString(), allowPartialTrustChain: true };
  const options = {
    agent: false as const, signal: AbortSignal.timeout(timeoutMs), rejectUnauthorized: true,
    // Do not let a hosts-file/DNS override turn the localhost exception into remote trust.
    hostname: hostname.replace(/^localhost$/, '127.0.0.1'),
    servername: servername ?? (hostname === 'localhost' ? 'localhost' : undefined),
    ...trust,
  };
  return new Promise(resolve => {
    const receive = (response: IncomingMessage) => { response.resume(); resolve(response.statusCode === 200); };
    const get = target.protocol === 'https:' ? httpsGet : httpGet;
    get(target, options, receive).once('error', () => resolve(false));
  });
}
