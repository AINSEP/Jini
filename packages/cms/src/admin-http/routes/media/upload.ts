import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminMediaEnvelope } from "@jini-ai/core/contracts/site/cms-media";
import { decodeStrictBase64 } from "@jini-ai/core/contracts/site/strict-base64";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { documentContentType, MAX_DOCUMENT_BYTES } from "../../../media/document-ingress.js";
import { parseOptionalStringField } from "../../../media/metadata-fields.js";
import { resolveUploadContentType } from "../../../media/site/upload-content-type.js";
import { MediaConflictError, MediaValidationError, type MediaKind, type MediaRecord } from "../../../media/types.js";
import type { MediaStoredDescriber } from "./replace.js";
import { authorizeMedia, MEDIA_VALIDATION, mediaActorId, rejectMediaError, type MediaErrorMapping, type MediaRoutePrincipal } from "./shared.js";

/** An upload request's fields after {@link parseUploadRequestFields}. */
export interface UploadRequestFields {
  kind: MediaKind; filename: string; contentType: string; dataBase64: string;
  alt: string | undefined; caption: string | undefined; credit: string | undefined;
}

/** What the host's upload pipeline stores: verified bytes and type plus the request metadata and actor. */
export interface MediaUploadInput {
  kind: MediaKind; bytes: Uint8Array; filename: string; contentType: string;
  alt: string | undefined; caption: string | undefined; credit: string | undefined; createdByPrincipal: string;
}

/** The deps this route reads; every I/O step and the product event are host services. */
export interface MediaUploadRouteDeps {
  workspaceId: string;
  /** The host's upload pipeline (repositories, blob store, document archive reader, byte cap). */
  storeUpload: (required: MediaUploadInput) => Promise<{ media: MediaRecord }>;
  /** Persists the sniffed type of a stored media blob (documents are typed by filename and skip it). */
  recordContentType: (required: { sha256: string; contentType: string }) => Promise<void>;
  /** The host's product event for a stored upload. */
  onUploaded: (required: { actorId: string; kind: MediaKind; contentType: string; byteLength: number }) => void;
  describeStored: MediaStoredDescriber;
  /** Words a classified validation refusal for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
}

const REQUIRED_FIELDS = "filename, contentType, and dataBase64 are required";

/** An omitted `kind` is an ordinary media upload; anything other than `media`/`document` is refused.
 *  @complexity O(1). */
function parseUploadKind({ raw }: { raw: unknown }, _optional: Record<string, never> = {}): MediaKind {
  const kind = raw ?? "media";
  if (kind !== "media" && kind !== "document") throw new MediaValidationError({ message: "invalid media kind" });
  return kind;
}

/** The three required upload fields plus the three optional metadata fields, parsed off an untyped
 *  body in one place, or `null` if a required field is missing or the wrong shape. `dataBase64` must
 *  be a non-empty string — an absent or non-string value is rejected here rather than reaching
 *  `Buffer.from`. `alt`/`caption`/`credit` go through `@jini-ai/cms/media`'s `parseOptionalStringField`, which
 *  throws `MediaValidationError` for a non-string, non-null, non-undefined value. On upload there is
 *  no existing value to preserve, so an explicit `null` here is equivalent to omitting the field (both
 *  end up `""` — see `uploadMedia`'s `input.alt?.trim() ?? ""`), unlike the update route where `null`
 *  clears a possibly-non-empty existing value.
 *  @complexity O(1). */
function parseUploadRequestFields({ rawBody }: { rawBody: unknown }, _optional: Record<string, never> = {}): UploadRequestFields | null {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const kind = parseUploadKind({ raw: body.kind });
  const filename = typeof body.filename === "string" ? body.filename : "";
  const contentType = String(body.contentType ?? "");
  const dataBase64 = body.dataBase64;
  if (!filename || (kind === "media" && !contentType)) return null;
  if (typeof dataBase64 !== "string" || !dataBase64) return null;
  return {
    kind, filename, contentType, dataBase64,
    alt: parseOptionalStringField({ raw: body.alt, field: "alt" }),
    caption: parseOptionalStringField({ raw: body.caption, field: "caption" }),
    credit: parseOptionalStringField({ raw: body.credit, field: "credit" }),
  };
}

/** The parsed body, or the thrown validation failure held until `handle` (the first thing it does), where the host's
 *  `outwardErrorMessage` is in reach: `parse` has no deps. */
type ParsedUpload = { readonly fields: UploadRequestFields } | { readonly parseError: unknown };

/** Both parse failures — a thrown `MediaValidationError` (bad kind or metadata) and a missing field —
 *  are the flat 400, before the session is read; anything else is rethrown for the host's 500.
 *  @complexity O(1). */
function parseUploadOrRefuse({ rawBody }: { rawBody: unknown }, _optional: Record<string, never> = {}): ParsedUpload {
  let fields: UploadRequestFields | null;
  try {
    fields = parseUploadRequestFields({ rawBody });
  } catch (parseError) {
    return { parseError };
  }
  if (!fields) rejectRoute({ status: 400, error: REQUIRED_FIELDS });
  return { fields };
}

/**
 * Decodes the upload's bytes and verifies their content type, throwing `MediaValidationError` for
 * an over-long document payload or invalid base64.
 *
 * @complexity O(n) in the encoded payload length.
 */
function decodeUploadPayload(
  { kind, filename, contentType, dataBase64 }: Pick<UploadRequestFields, "kind" | "filename" | "contentType" | "dataBase64">,
  _optional: Record<string, never> = {},
): { bytes: Uint8Array; contentType: string } {
  // Refuse document base64 inflation before allocation, then let the shared ingress owner
  // check actual bytes. Authorization precedes decoding, archive work, and storage I/O.
  if (kind === "document" && dataBase64.length > 4 * Math.ceil(MAX_DOCUMENT_BYTES / 3)) {
    throw new MediaValidationError({ message: "document exceeds the 50 MiB limit" });
  }
  // `decodeStrictBase64`, not `Buffer.from(x, "base64")`: the latter never throws (it skips
  // characters outside the alphabet instead of refusing them), so a bare try/catch around it can
  // never fire — see that function's own header.
  const bytes = decodeStrictBase64({ value: dataBase64 });
  if (!bytes) throw new MediaValidationError({ message: "dataBase64 is not valid base64" });
  // Trust sniffed bytes rather than the client label. HTML/unknown bytes are rejected;
  // uploadMedia sanitizes accepted SVG before hashing/storage.
  const verified = kind === "document" ? documentContentType({ filename }) : resolveUploadContentType({ bytes, declaredContentType: contentType });
  return { bytes, contentType: verified };
}

/** Decodes and stores the upload, records the sniffed type of a media blob, reports it and describes it.
 *  @complexity O(n) in the payload length, plus fixed-count host calls. */
async function persistUpload(
  { deps, fields, actorId }: { deps: MediaUploadRouteDeps; fields: UploadRequestFields; actorId: string },
  _optional: Record<string, never> = {},
): Promise<AdminMediaEnvelope> {
  const { kind, filename, alt, caption, credit } = fields;
  const { bytes, contentType } = decodeUploadPayload(fields);
  const { media } = await deps.storeUpload({ kind, bytes, filename, contentType, alt, caption, credit, createdByPrincipal: actorId });
  // Only media uses the per-blob sniff cache; document type is its validated filename policy.
  // Record the sniffed type so the admin's type filter agrees with what `original.ts` serves
  // (it never trusts the upload-time string either). Written AFTER `uploadMedia` because the
  // blob row it updates is created there.
  if (kind === "media") await deps.recordContentType({ sha256: media.source.sha256, contentType });
  deps.onUploaded({ actorId, kind, contentType, byteLength: bytes.byteLength });
  return deps.describeStored({ media, contentType, byteLength: bytes.byteLength });
}

/** Slug allocation is a courtesy lookup before save. Concurrent uploads can choose the same free
 *  slug; the durable repo enforces uniqueness with `MediaConflictError` (409). Otherwise a validation
 *  failure is 400 and anything else rethrown for the host's private 500. */
const UPLOAD_ERRORS: readonly MediaErrorMapping[] = [
  { matches: ({ err }, _o = {}) => err instanceof MediaConflictError, status: 409 },
  MEDIA_VALIDATION,
];

/**
 * POST a new media upload (JSON with base64-encoded bytes), gated by `media.upload` on the `media` type
 * with no entity id. The body is checked in `parse`, before the session, so its 400s win; the host
 * mount defers a missing principal to `authorize` for that reason.
 */
export const mediaUploadRoute = defineJsonRoute<ParsedUpload, AdminMediaEnvelope, MediaUploadRouteDeps, MediaRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/media",
  parse: (raw) => ok({ value: parseUploadOrRefuse({ rawBody: raw.body }) }),
  handle: async ({ input, deps, context, authorize }) => {
    if ("parseError" in input) return rejectMediaError({ err: input.parseError, mappings: [MEDIA_VALIDATION], outwardErrorMessage: deps.outwardErrorMessage });
    await authorizeMedia({ authorize, permission: "media.upload" });
    const actorId = mediaActorId({ context });
    try {
      return ok({ value: await persistUpload({ deps, fields: input.fields, actorId }) });
    } catch (err) {
      return rejectMediaError({ err, mappings: UPLOAD_ERRORS, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
}, { successStatus: 201 });
