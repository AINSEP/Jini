/** Shared rendition format metadata. Media validation and SEO use this leaf without loading
 * either domain's runtime; media/transform-types.ts preserves its existing public exports.
 */

import type { TransformFormat } from "@jini-ai/core/contracts/site/cms-media";

// `TransformFormat` is owned by the neutral core media contract (shared with host share/export
// policy); this leaf keeps its runtime MIME map and re-exports the type for existing importers.
export type { TransformFormat };

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
