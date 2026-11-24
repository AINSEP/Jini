import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminMediaDto } from "@jini-ai/core/contracts/site/cms-media";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { buildImportFilename, MediaImportValidationError, type FetchedImage } from "../../../media/import/fetch-image.js";
import { parseOptionalStringField } from "../../../media/metadata-fields.js";
import { MediaValidationError, type MediaRecord } from "../../../media/types.js";
import { toAdminMediaResponse } from "../../http/media.js";
import { authorizeMedia, mediaActorId, type MediaRoutePrincipal } from "./shared.js";

/** Quick wins A: an admin adapter over the same guarded fetch and upload pipeline as the tool. */

/** The upload the host persists: the fetched bytes, their sniffed type, the derived filename and metadata. */
export interface MediaImportUrlUpload {
  bytes: Uint8Array; contentType: string; filename: string;
  alt: string | undefined; caption: string | undefined; credit: string | undefined; createdByPrincipal: string;
}

/** The deps this route reads; every I/O step is a host service. */
export interface MediaImportUrlRouteDeps {
  workspaceId: string;
  /** The host's guarded fetch: its dedicated media-import egress client, never the credentialed one
   *  (which has a smaller cap and a different redirect policy). */
  fetchImage: (required: { url: string }) => Promise<FetchedImage>;
  /** The host's upload pipeline (repositories, blob store, byte cap) for the fetched bytes. */
  uploadMedia: (required: MediaImportUrlUpload) => Promise<{ media: MediaRecord }>;
  /** Persists the sniffed type of the stored blob. */
  recordContentType: (required: { sha256: string; contentType: string }) => Promise<void>;
  /** The asset's public URL; `null` when it has none. */
  resolvePublicUrl: (required: { media: MediaRecord }) => Promise<string | null>;
  /** When `error` is the host transport's egress refusal: its caller-safe text (the host logs the full,
   *  private diagnosis itself). `undefined` for any other error. */
  egressRefusalMessage: (required: { error: unknown }) => string | undefined;
}

interface ImportInput { url: string; filename: string | undefined; alt: string | undefined; caption: string | undefined; credit: string | undefined }

/** The body checks, run only after authorization (a denied caller learns nothing about its body).
 * @complexity O(1). */
function parseImportInput({ body }: { body: unknown }, _optional: Record<string, never> = {}): ImportInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MediaImportValidationError({ message: "url is required" });
  }
  const input = body as Record<string, unknown>;
  if (typeof input.url !== "string" || !input.url.trim()) {
    throw new MediaImportValidationError({ message: "url is required" });
  }
  return {
    url: input.url.trim(),
    filename: parseOptionalStringField({ raw: input.filename, field: "filename" }),
    alt: parseOptionalStringField({ raw: input.alt, field: "alt" }),
    caption: parseOptionalStringField({ raw: input.caption, field: "caption" }),
    credit: parseOptionalStringField({ raw: input.credit, field: "credit" }),
  };
}

/** Validate, fetch, upload, record the type, describe. Rejected bytes never reach the upload.
 * @complexity O(n) in bounded downloaded bytes, plus fixed-count host calls. */
async function importFromUrl(
  { deps, body, actorId }: { deps: MediaImportUrlRouteDeps; body: unknown; actorId: string },
  _optional: Record<string, never> = {},
): Promise<{ media: AdminMediaDto }> {
  const input = parseImportInput({ body });
  const fetched = await deps.fetchImage({ url: input.url });
  const { media } = await deps.uploadMedia({
    bytes: fetched.bytes, contentType: fetched.contentType,
    filename: buildImportFilename({ url: fetched.url, contentType: fetched.contentType }, input.filename === undefined ? {} : { override: input.filename }),
    alt: input.alt, caption: input.caption, credit: input.credit, createdByPrincipal: actorId,
  });
  // As with the assistant import and human upload, a failure here must not report success:
  // the next rendition needs the persisted sniffed type to serve this blob correctly.
  await deps.recordContentType({ sha256: media.source.sha256, contentType: fetched.contentType });
  const publicUrl = await deps.resolvePublicUrl({ media });
  return { media: toAdminMediaResponse({ media, contentType: fetched.contentType, publicUrl, byteSize: fetched.bytes.byteLength }) };
}

/** The refusal ladder: the egress refusal's caller-safe text, then the two validation errors' own
 *  messages (400); anything else is rethrown for the host's redacted 500.
 * @complexity O(1). */
function rejectImportError({ deps, error }: { deps: MediaImportUrlRouteDeps; error: unknown }, _optional: Record<string, never> = {}): never {
  // Full DNS diagnosis is operator-log-only, matching the assistant tool's refusal contract.
  const callerSafeMessage = deps.egressRefusalMessage({ error });
  if (callerSafeMessage !== undefined) rejectRoute({ status: 400, error: callerSafeMessage });
  if (error instanceof MediaImportValidationError || error instanceof MediaValidationError) rejectRoute({ status: 400, error: error.message });
  throw error;
}

/**
 * Import one image or video from a URL into the media library. Permission checks precede all
 * outbound I/O; the body is checked after them, so `parse` only carries it through. The 403 body
 * (`not authorized for media.upload` with `details`) is the host mount's `forbidden` reply.
 */
export const mediaImportUrlRoute = defineJsonRoute<{ body: unknown }, { media: AdminMediaDto }, MediaImportUrlRouteDeps, MediaRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/media/import-url",
  parse: (raw) => ok({ value: { body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeMedia({ authorize, permission: "media.upload" });
    const actorId = mediaActorId({ context });
    try {
      return ok({ value: await importFromUrl({ deps, body: input.body, actorId }) });
    } catch (error) {
      return rejectImportError({ deps, error });
    }
  },
}, { successStatus: 201 });
