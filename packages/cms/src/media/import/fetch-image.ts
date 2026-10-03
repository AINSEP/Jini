/** Binary URL import; the outbound adapter owns per-hop SSRF controls, while this module enforces caller MIME/byte policy and preserves source provenance. */
// URL/byte rules are separate from tool permissions and persistence so a fake HTTP port or a byte
// array can exercise them directly. Composition supplies the guarded client; never construct an
// unguarded one here. It must check/pin DNS peers and recheck every redirect to prevent SSRF/rebinding.
import type { FetchImageRequired, FetchImageOptional, ValidateImageBytesRequired } from "./ports.js";

// Request/fetched-content refusal is distinct from an upload validator's already-in-hand byte checks.
export class MediaImportValidationError extends Error {
  constructor({ message }: { message: string }) { super(message); }
}

// An extension derived from the sniffed type cannot contradict the payload's actual bytes.
const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export interface FetchedImage {
  readonly bytes: Uint8Array;
  // Remote Content-Type is attacker-controlled metadata; accepted types come from the byte sniffer.
  readonly contentType: string;

  // Follow the bytes: recording the requested URL once mislabeled CDN redirects with a source that
  // served no bytes. Provenance and default filenames both need the last reported valid hop.
  readonly url: URL;
}

// Early scheme/embedded-credential rejection gives callers actionable errors; it supplements,
// rather than replaces, the outbound guard's independent connect-time controls.
export function parseImportUrl({ raw }: { raw: string }): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MediaImportValidationError({ message: `'url' must be an absolute URL including the scheme (for example 'https://example.com/image.png') — got '${raw}'.` });
  }
  if (url.protocol !== "https:") {
    throw new MediaImportValidationError({ message: `'url' must use https — got '${url.protocol.replace(":", "")}'. Only https URLs can be imported.` });
  }
  if (url.username || url.password) {
    throw new MediaImportValidationError({ message: "'url' must not embed credentials (user:password@host)." });
  }
  return url;
}

// Bound/sanitize path punctuation, controls, and traversal-like names. This labels an upload, not
// its filesystem location: content-addressed storage must not derive a path from this display name.
export function buildImportFilename({ url, contentType }: { url: URL; contentType: string }, { override }: { override?: string } = {}): string {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] ?? "bin";
  const rawName = override ?? decodeLastPathSegment(url);
  const slug = rawName
    .replace(/\.[a-zA-Z0-9]{1,5}$/, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return `${slug || "imported-image"}.${extension}`;
}

// A malformed escape should not fail an otherwise valid import; the name sanitizer handles it.
function decodeLastPathSegment(url: URL): string {
  const segment = url.pathname.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// Distinguish expired signed URLs (often 403/404) from a broken upstream host, so callers request a
// fresh link instead of repeating a doomed fetch. Keep recovery wording separate from network I/O.
function buildStatusError(url: URL, status: number): MediaImportValidationError {
  const hint =
    status === 403 || status === 404
      ? " Signed or time-limited image URLs expire quickly — ask for a fresh URL rather than retrying this one."
      : "";
  return new MediaImportValidationError({ message: `fetching '${url.href}' returned HTTP ${status}, not an image.${hint}` });
}

// Check clipping BEFORE magic bytes: a truncated image can still sniff as PNG but is a corrupt file,
// not a smaller image. Never create a successful media row from a silently partial payload.
// The sniffer and allowlist decide type; remote headers/local filename extensions cannot authorize
// HTML, PDFs, or unsanitized SVG masquerading as images.
export function validateImageBytes({ source, bytes, bytesTruncated, maxBytes, allowedContentTypes, sniffer }: ValidateImageBytesRequired): string {
  assertMaxBytes(maxBytes);
  // Keep URL error labels for remote imports while letting local root-relative paths label refusals.
  const isRemote = source instanceof URL;
  const label = isRemote ? source.href : source;
  if (bytesTruncated || bytes.byteLength > maxBytes) {
    throw new MediaImportValidationError({ message: isRemote
        ? `the image at '${label}' exceeds the ${maxBytes}-byte import limit. Nothing was saved — a partially downloaded image would be a corrupt file, not a smaller one.`
        : `file '${label}' exceeds the ${maxBytes}-byte import limit. Nothing was saved.` });
  }
  if (bytes.byteLength === 0) {
    throw new MediaImportValidationError({ message: isRemote
      ? `'${label}' returned an empty response body — there is nothing to import.`
      : `file '${label}' is empty — there is nothing to import.` });
  }
  const contentType = sniffer.sniff({ bytes });
  if (!allowedContentTypes.has(contentType)) {
    throw new MediaImportValidationError({ message: `'${label}' is not an importable file: its actual bytes are '${contentType}'. ` +
        `Only ${[...allowedContentTypes].join(", ")} can be imported (${isRemote ? 'the served Content-Type header' : 'the file extension'} is deliberately ignored — the bytes decide).` });
  }
  return contentType;
}

export async function fetchImage(required: FetchImageRequired, { timeoutMs = 20_000 }: FetchImageOptional = {}): Promise<FetchedImage> {
  const url = parseImportUrl({ raw: required.url });
  assertMaxBytes(required.maxBytes);

  const response = await required.outboundGuard.send({
    httpClient: required.httpClient,
    request: {
      method: "GET",
      url: url.href,
      headers: { Accept: [...required.allowedContentTypes].join(", ") },
      timeoutMs,
      maxResponseBytes: required.maxBytes,
    },
  });
  if (response.status < 200 || response.status >= 300) {
    throw buildStatusError(url, response.status);
  }
  // Lossy UTF-8 decoding cannot reconstruct binary media. Fail loudly for clients missing raw bytes
  // rather than store a mangled image and call it success; transport failures retain their own type.
  const bytes = response.bodyBytes;
  if (bytes === undefined) {
    throw new MediaImportValidationError({ message: `the HTTP client returned no raw bytes for '${url.href}' — refusing to reconstruct image data from its lossy text decoding.` });
  }
  // A byte-specific verdict wins over truncation of the lossy text representation.
  // The coarse flag ORs byte and text truncation: honoring it when a precise byte verdict exists
  // once rejected complete images whose unused UTF-8 decode alone exceeded the cap. A legacy client
  // with no precise verdict must still fail safe on the coarse flag.
  const bytesTruncated = response.bodyBytesTruncated ?? response.bodyTruncated === true;
  const contentType = validateImageBytes({ ...required, source: url, bytes, bytesTruncated });
  return { bytes, contentType, url: resolveSourceUrl(url, response.finalUrl) };
}

// An older adapter may omit finalUrl; a malformed report can come from a hand-written port. Keep
// the requested URL as a less precise label instead of rejecting good bytes or blanking provenance.
function resolveSourceUrl(requested: URL, reported: string | undefined): URL {
  if (reported === undefined) return requested;
  try {
    return new URL(reported);
  } catch {
    return requested;
  }
}
function assertMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new MediaImportValidationError({ message: "maxBytes must be a positive safe integer" });
}
