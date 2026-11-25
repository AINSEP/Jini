/**
 * Why: a host may allow far larger video uploads than everything else (Tovu: 500 MB video, 50 MiB
 * otherwise, owner decision 2026-11-24). The cap depends on the file's type, so every path that
 * enforces it (upload, replace, assistant tool, admin replace route) asks this one function instead of
 * repeating the `video/` test — a path that kept reading the general number would silently cut videos at it.
 */

/** The two byte caps a host injects; `maxVideoUploadBytes` omitted means video follows the general cap. */
export interface UploadCaps {
  maxUploadBytes: number;
  maxVideoUploadBytes?: number | undefined;
}

/** The cap that applies to a file of this content type.
 * @complexity O(1). @example resolveUploadCap({ contentType: "video/mp4" }, { maxUploadBytes: 50, maxVideoUploadBytes: 500 }) // 500 */
export function resolveUploadCap({ contentType }: { contentType: string }, caps: UploadCaps): number {
  const isVideo = contentType.toLowerCase().startsWith("video/");
  return isVideo ? caps.maxVideoUploadBytes ?? caps.maxUploadBytes : caps.maxUploadBytes;
}
