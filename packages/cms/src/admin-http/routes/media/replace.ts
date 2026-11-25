import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminMediaEnvelope } from "@jini-ai/core/contracts/site/cms-media";
import { decodeStrictBase64 } from "@jini-ai/core/contracts/site/strict-base64";
import { describeUploadOverLimit } from "@jini-ai/core/text";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { DEFAULT_ALLOWED_MIME_TYPES } from "../../../media/media-service.js";
import type { MediaRepoPort } from "../../../media/ports.js";
import { resolveUploadCap, type UploadCaps } from "../../../media/upload-cap.js";
import { resolveUploadContentType } from "../../../media/site/upload-content-type.js";
import { MediaUploadSizeError, MediaValidationError, type MediaRecord } from "../../../media/types.js";
import { authorizeMedia, MEDIA_UPLOAD_SIZE, MEDIA_VALIDATION, mediaActorId, mediaIdParam, rejectMediaError, type MediaRoutePrincipal } from "./shared.js";

/** The `{ media }` body for an asset just stored under the type verified from its bytes (host: public URL, stored size). */
export type MediaStoredDescriber = (required: { media: MediaRecord; contentType: string; byteLength: number }) => Promise<AdminMediaEnvelope>;

/** The replacement the host's file switch receives: verified bytes and type, the actor and the upload provenance. */
export interface MediaReplacement {
  media: MediaRecord; bytes: Uint8Array; contentType: string; principalId: string; provenance: { kind: "upload"; path: string };
}

/** The deps this route reads. The repo's two optional capabilities are probed, not called: without them
 *  the host cannot switch a file transactionally (503). */
export interface MediaReplaceRouteDeps {
  workspaceId: string;
  mediaRepo: Pick<MediaRepoPort, "findById"> & { replaceFileIfVersion?: unknown; saveRenditionIfSource?: unknown };
  /** The host's upload byte cap (owner policy), also bound into `replaceFile`. */
  maxUploadBytes: number;
  /** The host's larger cap for `video/*` files, when it has one (see `media/upload-cap.ts`). */
  maxVideoUploadBytes?: number | undefined;
  /** The host's file switch; `null` when the asset's version moved meanwhile. */
  replaceFile: (required: MediaReplacement) => Promise<MediaRecord | null>;
  describeStored: MediaStoredDescriber;
  /** Words a classified validation refusal for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
}

/** The declared content type and base64 payload, refused unless the filename, type and payload are
 *  all non-empty strings. @complexity O(1). */
function readReplacementFields({ body }: { body: unknown }, _optional: Record<string, never> = {}): { filename: string; contentType: string; dataBase64: string } {
  const values = (body ?? {}) as Record<string, unknown>;
  const { filename, contentType, dataBase64 } = values;
  const validFilename = typeof filename === "string" && Boolean(filename.trim());
  const validContentType = typeof contentType === "string" && Boolean(contentType);
  if (!validFilename || !validContentType || typeof dataBase64 !== "string" || !dataBase64) {
    throw new MediaValidationError({ message: "filename, contentType, and dataBase64 are required" });
  }
  return { filename, contentType, dataBase64 };
}

/** Decodes and verifies the replacement bytes: strict base64, within the host upload cap, and an
 *  allowed type as sniffed from the bytes (not the declared label). A non-empty strict-base64
 *  payload always decodes to at least one byte, and `replaceMediaFile` refuses empty bytes too.
 *  @complexity O(n) in the payload length. */
function parseReplacement({ body, caps }: { body: unknown; caps: UploadCaps }, _optional: Record<string, never> = {}) {
  const { filename, contentType, dataBase64 } = readReplacementFields({ body });
  const bytes = decodeStrictBase64({ value: dataBase64 });
  if (!bytes) throw new MediaValidationError({ message: "dataBase64 is not valid base64" });
  const verified = resolveUploadContentType({ bytes, declaredContentType: contentType });
  if (!DEFAULT_ALLOWED_MIME_TYPES.has(verified)) {
    throw new MediaValidationError({ message: `content type '${verified}' is not allowed for upload` });
  }
  // The cap depends on the SNIFFED type (a mislabeled file cannot borrow the video cap), so it is checked after the sniff.
  const maxUploadBytes = resolveUploadCap({ contentType: verified }, caps);
  if (bytes.byteLength > maxUploadBytes) {
    // Plain words naming both sizes, the same sentence upload, the Library and the chat composer use.
    throw new MediaUploadSizeError({ message: describeUploadOverLimit({ fileBytes: bytes.byteLength, limitBytes: maxUploadBytes }), fileBytes: bytes.byteLength, limitBytes: maxUploadBytes });
  }
  return { bytes, contentType: verified, provenance: { kind: "upload" as const, path: filename } };
}

/** Loads the asset to replace, or refuses: 404 when it does not exist, 409 when it is trashed, 503 when
 *  the repository cannot switch a file transactionally. Runs before the body is decoded.
 *  @complexity O(1) — one indexed lookup. */
async function findReplaceableMedia({ deps, id }: { deps: MediaReplaceRouteDeps; id: string }, _optional: Record<string, never> = {}): Promise<MediaRecord> {
  const media = await deps.mediaRepo.findById({ workspaceId: deps.workspaceId, id });
  if (!media) rejectRoute({ status: 404, error: `media '${id}' was not found` });
  if (media.status !== "active") rejectRoute({ status: 409, error: "trashed media cannot be replaced", code: "ENTITY_IN_TRASH" });
  if (typeof deps.mediaRepo.replaceFileIfVersion !== "function" || typeof deps.mediaRepo.saveRenditionIfSource !== "function") {
    rejectRoute({ status: 503, error: "media file replacement is unavailable", code: "MEDIA_REPLACE_UNAVAILABLE" });
  }
  return media;
}

/** Verify, switch, describe; a moved version is the 409 conflict. @complexity O(n) in the payload length. */
async function replaceFromBody(
  { deps, media, body, principalId }: { deps: MediaReplaceRouteDeps; media: MediaRecord; body: unknown; principalId: string },
  _optional: Record<string, never> = {},
): Promise<AdminMediaEnvelope> {
  const upload = parseReplacement({ body, caps: { maxUploadBytes: deps.maxUploadBytes, maxVideoUploadBytes: deps.maxVideoUploadBytes } });
  const saved = await deps.replaceFile({ media, ...upload, principalId });
  if (!saved) rejectRoute({ status: 409, error: "media changed while replacing its file", code: "MEDIA_REPLACE_CONFLICT" });
  return deps.describeStored({ media: saved, contentType: upload.contentType, byteLength: upload.bytes.byteLength });
}

/** Same JSON upload protocol and per-entity permission as the host's media metadata route.
 * Source replacement is explicit; PATCH metadata still cannot change a source hash. */
export const mediaReplaceRoute = defineJsonRoute<{ mediaId: string; body: unknown }, AdminMediaEnvelope, MediaReplaceRouteDeps, MediaRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/media/:mediaId/replace",
  parse: (raw) => ok({ value: { mediaId: mediaIdParam({ params: raw.params }), body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeMedia({ authorize, permission: "media.update" }, { entityId: input.mediaId });
    const principalId = mediaActorId({ context });
    const media = await findReplaceableMedia({ deps, id: input.mediaId });
    try {
      return ok({ value: await replaceFromBody({ deps, media, body: input.body, principalId }) });
    } catch (err) {
      return rejectMediaError({ err, mappings: [MEDIA_UPLOAD_SIZE, MEDIA_VALIDATION], outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
});
