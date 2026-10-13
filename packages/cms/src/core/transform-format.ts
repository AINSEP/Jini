/** Shared rendition format metadata. Media validation and SEO use this leaf without loading
 * either domain's runtime; media/transform-types.ts preserves its existing public exports.
 */

/**
 * Output re-encode format. Matches `media-service.ts`'s
 * `DEFAULT_ALLOWED_MIME_TYPES` image set minus SVG (never a transform output —
 * SVG has no raster pixels to resize).
 */
export type TransformFormat = "jpeg" | "png" | "webp" | "gif";

/** Maps a {@link TransformFormat} to the MIME type served on the rendition response. */
export const MIME_BY_TRANSFORM_FORMAT: Record<TransformFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * @complexity O(1).
 * @overallScore 100
 */
export function mimeForTransformFormat(requiredArgs: { format: TransformFormat }, optionalArgs: Record<string, never> = {}): string {
  const { format } = requiredArgs;
  return MIME_BY_TRANSFORM_FORMAT[format];
}
