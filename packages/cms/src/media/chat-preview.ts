import { orFallback } from "@jini-ai/core/errors/idioms";
import type { EncodedImage, ImageCodecPort } from "./image-codec.js";

/** Long edge of the chat preview. Small on purpose: the model sees the block too, so it is a
 *  glance (a few KB), not a second copy; the full file is one click away through `href`. */
const MEDIA_CHAT_PREVIEW_MAX_EDGE_PX = 320;

/**
 * Adds a small WebP preview to a media-producing tool's result so the admin chat shows the saved
 * picture inline, titled and linked to its file — the same `{content: [text, image]}` envelope
 * `media_view_image` returns, so every agent CLI and BYOK path already carries it. The text block
 * is the unchanged `{ media }` JSON. Best effort: no codec, a video or SVG, or any encode error
 * returns the plain result; the media write itself already succeeded.
 * In a batch (`@jini-ai/core` batch wrapper) each item's JSON drops its image, and the batch result
 * carries up to four of the previews beside its JSON summary.
 * @complexity O(pixels) time/space for one decode and one small encode.
 */
export async function withChatPreview<T extends { media: { title: string; publicUrl: string | null } }>(
  { routeDeps, bytes, contentType, result }: { routeDeps: { imageCodec?: ImageCodecPort | undefined }; bytes: Uint8Array; contentType: string; result: T },
  _optional: Record<string, never> = {},
) {
  // Raster only, like media_view_image: these are the unsanitized source bytes, so an SVG never
  // reaches the rasterizer here, and a video has no still to show.
  const { imageCodec } = routeDeps;
  if (!imageCodec || !contentType.startsWith("image/") || contentType === "image/svg+xml") return result;
  const preview = await orFallback<EncodedImage | null>({
    work: () => imageCodec.encode({ source: bytes, autoOrient: true, format: "webp", quality: 70,
      resize: { width: MEDIA_CHAT_PREVIEW_MAX_EDGE_PX, height: MEDIA_CHAT_PREVIEW_MAX_EDGE_PX, fit: "inside", withoutEnlargement: true } }),
    fallback: null,
    step: "encode media chat preview",
  });
  if (!preview) return result;
  const { title, publicUrl } = result.media;
  return { content: [
      { type: "text" as const, text: JSON.stringify(result) },
      { type: "image" as const, mimeType: "image/webp", data: Buffer.from(preview.bytes).toString("base64"), title, ...(publicUrl ? { href: publicUrl } : {}) },
  ] };
}
