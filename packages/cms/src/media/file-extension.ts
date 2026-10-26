// An extension derived from the sniffed type cannot contradict the payload's actual bytes.
const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<string, string>> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/avif": "avif", "image/svg+xml": "svg", "video/mp4": "mp4", "video/webm": "webm",
  "audio/wav": "wav", "audio/mpeg": "mp3", "audio/flac": "flac", "audio/mp4": "m4a", "audio/ogg": "ogg",
  "application/pdf": "pdf", "application/octet-stream": "bin",
};

/** Portable extension for a server-validated media type; unknown types stay opaque.
 * Never derive an extension from upload filenames or untrusted MIME suffixes. O(1) time/space.
 */
export function mediaFileExtension({ contentType }: { contentType: string }, _options = {}): string {
  return Object.hasOwn(EXTENSION_BY_CONTENT_TYPE, contentType) ? EXTENSION_BY_CONTENT_TYPE[contentType]! : "bin";
}
