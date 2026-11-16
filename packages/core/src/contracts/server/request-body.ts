/**
 * @file Bounded request-body reading for the `Server` contract: raw bytes and JSON, with the
 * size ceiling and content-encoding refusal every host shares.
 */
import type { ServerApiError } from './api-error.js';
import { err, ok, type Result } from './result.js';

/** Express's `express.json()` default ceiling, kept so moving a route off Express changes no limit. */
export const DEFAULT_JSON_BODY_MAX_BYTES = 100 * 1024;

function tooLarge(maxBytes: number): ServerApiError {
  return ({ code: 'PAYLOAD_TOO_LARGE', message: `The request body is larger than the ${maxBytes} bytes this address accepts. Send less data.` });
}

/**
 * Reads the whole body as bytes, refusing (413, `PAYLOAD_TOO_LARGE`) as soon as it passes
 * `maxBytes` — a declared `content-length` above the limit is refused before reading anything.
 * A request with no body gives zero bytes.
 */
export async function readBodyBytes({ request }: { readonly request: Request }, { maxBytes = DEFAULT_JSON_BODY_MAX_BYTES }: { readonly maxBytes?: number } = {}): Promise<Result<Uint8Array>> {
  const encoding = (request.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
  // Owner decision 2026-11-14: refuse compressed bodies, never unzip. (1) Zip bombs: a small compressed
  // body can inflate to gigabytes and freeze or crash the server before any size limit sees it.
  // (2) Decompression code is a known attack surface; not running it removes that risk. (3) A compressed
  // body hides its real content and size from our checks and logs, which helps smuggle oversized or
  // malicious input, including text aimed at hijacking the AI. No known client sends compressed bodies.
  if (encoding !== 'identity') return err({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'This address does not accept compressed request bodies. Send the body uncompressed (no Content-Encoding).' } });
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return err({ error: tooLarge(maxBytes) });
  if (!request.body) return ok({ value: new Uint8Array(0) });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Stop pulling from the socket at once: an oversized upload must not be buffered to the end.
      await reader.cancel();
      return err({ error: tooLarge(maxBytes) });
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok({ value: bytes });
}

function isJsonContentType(contentType: string | null): boolean {
  const mediaType = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

/**
 * Reads a JSON body the way the Express 4 host's `express.json()` did, so a converted route sees
 * the same value: no body, an empty body or a non-JSON content type give `{}`; only an object or
 * array is accepted (body-parser's strict mode); invalid JSON is a 400 `BAD_REQUEST`; a body over
 * `maxBytes` is a 413 `PAYLOAD_TOO_LARGE`.
 */
export async function readJsonBody({ request }: { readonly request: Request }, { maxBytes = DEFAULT_JSON_BODY_MAX_BYTES }: { readonly maxBytes?: number } = {}): Promise<Result<unknown>> {
  if (!isJsonContentType(request.headers.get('content-type'))) return ok({ value: {} });
  const bytes = await readBodyBytes({ request }, { maxBytes });
  if (!bytes.ok) return bytes;
  const text = new TextDecoder().decode(bytes.value).trim();
  if (text === '') return ok({ value: {} });
  const invalid: ServerApiError = { code: 'BAD_REQUEST', message: 'The request body is not valid JSON. Send a JSON object or array.' };
  if (!text.startsWith('{') && !text.startsWith('[')) return err({ error: invalid });
  try {
    return ok({ value: JSON.parse(text) as unknown });
  } catch {
    return err({ error: invalid });
  }
}
