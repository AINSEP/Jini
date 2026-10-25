/**
 * @module aws-sigv4
 *
 * Minimal AWS Signature V4 signer, implementing the spec'd canonical-request /
 * string-to-sign / signing-key / authorization recipe with only `node:crypto`.
 * No `@aws-sdk/*` dependency is pulled in — a host daemon that only needs to
 * sign a handful of S3-compatible requests stays free of an extra 60+ MB of
 * SDK code on disk.
 *
 * References:
 *   https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
 *   https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 *
 * Caller passes the HTTP method + path + query + headers + body, the region +
 * service (e.g. `'s3'`) + AWS access key + secret key, an optional
 * `sessionToken` (for STS-vended creds), and an optional `now` override so
 * tests can pin deterministic signatures.
 *
 * The signer mutates the supplied headers map by adding `authorization`,
 * `x-amz-date`, `x-amz-content-sha256`, and (when supplied)
 * `x-amz-security-token`. The caller is responsible for setting `host`.
 *
 * Path-style vs virtual-host-style: this signer does not care; the caller
 * chooses by setting `host` + path appropriately.
 */
import { createHash, createHmac } from 'node:crypto';

/** AWS credentials used to derive a SigV4 signature. */
export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** Input to {@link signSigV4}. */
export interface SignSigV4Input {
  method: string;
  /**
   * Canonical path (URI-encoded but with `/` preserved between segments).
   * For S3 object keys, the caller must double-encode RFC-3986-reserved
   * chars beyond the canonical pass.
   */
  path: string;
  /** Already-stringified canonical query (sorted `key=value` join). Pass `''` when the request has no query. */
  query: string;
  /** Mutable lower-case header map. The signer adds the four amz headers and the Authorization header. */
  headers: Record<string, string>;
  /** Raw body bytes; pass an empty Buffer for no-body requests. */
  body: Buffer;
  region: string;
  service: string;
  credentials: SigV4Credentials;
  /** ISO-8601 UTC datetime used for the signature. Defaults to `new Date()`. */
  now?: Date;
}

/** Result of {@link signSigV4} — the same values written into `input.headers`, surfaced directly for convenience. */
export interface SignSigV4Result {
  authorization: string;
  amzDate: string;
  contentSha256: string;
}

/**
 * Signs an HTTP request per the AWS Signature Version 4 recipe, mutating
 * `input.headers` in place and returning the same signature fields.
 *
 * @param input - Method/path/query/headers/body plus region, service, and credentials.
 * @returns The `authorization` header value, the `x-amz-date` used, and the body's SHA-256 hex digest.
 */
export function signSigV4(input: SignSigV4Input): SignSigV4Result {
  const now = input.now ?? new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const contentSha256 = sha256Hex(input.body);

  // Add the required amz headers BEFORE composing the canonical request, since they're part of
  // the signed-headers list.
  input.headers['x-amz-date'] = amzDate;
  input.headers['x-amz-content-sha256'] = contentSha256;
  if (input.credentials.sessionToken) {
    input.headers['x-amz-security-token'] = input.credentials.sessionToken;
  }

  // Canonical headers: lower-case keys + trim values; sort by key. Values are read through the
  // ORIGINAL key: looking them up by the lower-cased key signed a mixed-case header as empty (F1).
  const canonicalEntries = [...new Map(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]))]
    // Keys are unique after lower-casing, so code-unit order never ties (same order as the old .sort()).
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const headerKeys = canonicalEntries.map(([k]) => k);
  const canonicalHeaders = canonicalEntries.map(([k, v]) => `${k}:${trimValue(v)}\n`).join('');
  const signedHeaders = headerKeys.join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    input.query,
    canonicalHeaders,
    signedHeaders,
    contentSha256,
  ].join('\n');

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(Buffer.from(canonicalRequest, 'utf8')),
  ].join('\n');

  // Derive the signing key.
  const kDate = hmac(`AWS4${input.credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');

  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  input.headers['authorization'] = authorization;

  return { authorization, amzDate, contentSha256 };
}

function sha256Hex(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function trimValue(v: string): string {
  return v.trim().replace(/\s+/g, ' ');
}

function formatAmzDate(d: Date): string {
  const iso = d.toISOString().replace(/[-:]/g, '');
  // ISO is YYYYMMDDTHHmmss.sssZ; AWS expects YYYYMMDDTHHMMSSZ.
  return `${iso.slice(0, 15)}Z`;
}

/**
 * URI-encodes a path segment per RFC 3986, with the AWS twist that reserved
 * chars outside the unreserved set (`!'()*`) get `%HH`-encoded even though
 * `encodeURIComponent` leaves them alone.
 *
 * @param seg - A single path segment (no `/`).
 * @returns The RFC-3986/AWS-encoded segment.
 */
export function encodeS3PathSegment(seg: string): string {
  return encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
