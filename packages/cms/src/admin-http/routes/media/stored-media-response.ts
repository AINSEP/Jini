import type { MediaRecord } from "../../../media/types.js";
import type { AdminMediaEnvelope } from "@jini-ai/core/contracts/site/cms-media";
import { toAdminMediaResponse } from "../../http/media.js";
import type { MediaListLookup } from "./list.js";

/**
 * The `{ media }` body upload and replace both return for the asset they just stored, under the
 * content type they verified from its bytes.
 *
 * An accepted SVG is sanitized before storage, so the uploaded byte length is not what was stored:
 * its size is read back from the blob store (null when the store cannot tell). Every other type is
 * stored byte-for-byte, so the uploaded length is exact and needs no extra read.
 *
 * @complexity O(1) — one public-URL lookup, plus one blob size lookup for SVG.
 */
export async function toStoredMediaResponse(
  { media, contentType, byteLength, resolvePublicUrls, resolveByteSizes }: { media: MediaRecord; contentType: string; byteLength: number; resolvePublicUrls: MediaListLookup<string | null>; resolveByteSizes: MediaListLookup<number> },
  _optional = {},
): Promise<AdminMediaEnvelope> {
  const publicUrl = (await resolvePublicUrls({ media: [media] })).get(media.id) ?? null;
  const byteSize = contentType === "image/svg+xml"
    ? (await resolveByteSizes({ media: [media] })).get(media.source.sha256) ?? null
    : byteLength;
  return { media: toAdminMediaResponse({ media, contentType, publicUrl, byteSize }) };
}
