import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { buildImportFilename, MediaImportValidationError, type FetchedImage } from "../../../media/import/fetch-image.js";
import { parseOptionalStringField } from "../../../media/metadata-fields.js";
import { MediaValidationError, type MediaRecord } from "../../../media/types.js";
import { authorizeMediaOrForbid, principalOf, type MediaRoutePrincipal } from "./shared.js";

/** The upload a URL import hands to the host's upload pipeline (its repos, blob store and size policy bound in). */
export interface MediaImportUpload {
  workspaceId: string;
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  alt: string | undefined;
  caption: string | undefined;
  credit: string | undefined;
  createdByPrincipal: string;
}

/**
 * The deps this route reads. `fetchImage` must be the host's dedicated media-import egress client
 * (SSRF-guarded, its own cap and redirect policy), never a credentialed-request client.
 * `egressRefusalMessage` recognises the host's egress refusal, reports its full diagnosis to the
 * operator, and returns only the caller-safe sentence (or `undefined` for any other failure).
 */
export interface MediaImportUrlRouteDeps {
  workspaceId: string;
  fetchImage: (required: { url: string }) => Promise<FetchedImage>;
  uploadMedia: (required: MediaImportUpload) => Promise<{ media: MediaRecord }>;
  mediaContentTypeStore: { set: (required: { workspaceId: string; sha256: string; contentType: string }) => Promise<unknown> };
  egressRefusalMessage: (required: { error: unknown }) => string | undefined;
  /** Words a classified validation failure for the caller (see {@link OutwardErrorMessage}); the egress refusal keeps its own caller-safe sentence. */
  outwardErrorMessage: OutwardErrorMessage;
  toMediaResponse: (required: { media: MediaRecord; contentType: string; byteSize: number }) => Promise<object>;
}

/** The validated request body: a trimmed URL plus the optional display metadata. */
type ImportInput = { url: string; filename: string | undefined; alt: string | undefined; caption: string | undefined; credit: string | undefined };

/** @complexity O(1). */
function parseImportInput(required: { body: unknown }, _optional: Record<string, never> = {}): ImportInput {
  const { body } = required;
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

/**
 * POST import a media file from a URL — an admin adapter over the same guarded fetch and upload
 * pipeline as the assistant's import tool. Permission checks precede all outbound I/O, and the body
 * is validated only after authorization, so an unauthorized caller sees 403 before any 400 about
 * its body; rejected bytes never reach the upload. A denied `media.upload` answers this route's own
 * body (`not authorized for media.upload`, with the port's permission/reason details), as it always has.
 *
 * @complexity O(n) in bounded downloaded bytes, plus fixed-count repository calls.
 */
export const mediaImportUrlRoute = defineJsonRoute<{ body: unknown }, { media: object }, MediaImportUrlRouteDeps, MediaRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/media/import-url",
  parse: (raw) => ok({ value: { body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeMediaOrForbid({
      authorize, permission: "media.upload",
      forbidden: ({ details }) => ({ error: "not authorized for media.upload", code: "FORBIDDEN", details }),
    });
    const principal = principalOf({ context });
    try {
      const request = parseImportInput({ body: input.body });
      const fetched = await deps.fetchImage({ url: request.url });
      const { media } = await deps.uploadMedia({
        workspaceId: deps.workspaceId, bytes: fetched.bytes, contentType: fetched.contentType,
        filename: buildImportFilename({ url: fetched.url, contentType: fetched.contentType }, request.filename === undefined ? {} : { override: request.filename }),
        alt: request.alt, caption: request.caption, credit: request.credit, createdByPrincipal: principal.id,
      });
      // As with the assistant import and human upload, a failure here must not report success:
      // the next rendition needs the persisted sniffed type to serve this blob correctly.
      await deps.mediaContentTypeStore.set({ workspaceId: deps.workspaceId, sha256: media.source.sha256, contentType: fetched.contentType });
      return ok({ value: { media: await deps.toMediaResponse({ media, contentType: fetched.contentType, byteSize: fetched.bytes.byteLength }) } });
    } catch (err) {
      return rejectImportFailure({ err, deps });
    }
  },
}, { successStatus: 201 });

/** An egress refusal answers only its caller-safe sentence (the full DNS diagnosis stays in the
 *  operator log, matching the assistant tool's refusal contract); a request/byte validation failure
 *  is the caller's fault and answers the host's `outwardErrorMessage` copy (400); anything else is rethrown for the host's
 *  error port to answer as a private 500.
 *  @complexity O(1) plus the injected egress classifier. */
function rejectImportFailure({ err, deps }: { err: unknown; deps: MediaImportUrlRouteDeps }, _optional: Record<string, never> = {}): never {
  const callerSafe = deps.egressRefusalMessage({ error: err });
  if (callerSafe !== undefined) rejectRoute({ status: 400, error: callerSafe });
  if (err instanceof MediaImportValidationError || err instanceof MediaValidationError) rejectRoute({ status: 400, error: deps.outwardErrorMessage({ error: err }) });
  throw err;
}
