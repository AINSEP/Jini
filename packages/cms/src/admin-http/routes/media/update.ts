import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { AdminMediaEnvelope } from "@jini-ai/core/contracts/site/cms-media";

import type { OutwardErrorMessage } from "../../http/outward-error-message.js";
import { updateMediaMetadata, type UpdateMediaMetadataRequired } from "../../../media/media-service.js";
import { parseOptionalSlugField, parseOptionalStringField, parseOptionalTitleField } from "../../../media/metadata-fields.js";
import {
  authorizeMedia, describeMediaAsset, MEDIA_CONFLICT, MEDIA_NOT_FOUND, MEDIA_NOT_LIVE, MEDIA_VALIDATION, mediaIdParam, rejectMediaError,
  type MediaAssetLookups, type MediaRoutePrincipal,
} from "./shared.js";

/** The deps this route reads. */
export interface MediaUpdateRouteDeps extends Pick<UpdateMediaMetadataRequired["deps"], "clock" | "mediaRepo">, MediaAssetLookups {
  workspaceId: string;
  /** Words a classified refusal (trashed, unknown, invalid, slug collision) for the caller (see {@link OutwardErrorMessage}). */
  outwardErrorMessage: OutwardErrorMessage;
}

/**
 * `undefined` (omitted) survives as `undefined`, `null` (explicit clear) survives as `null` rather
 * than coercing through `convert`, and anything else is passed through `convert` — matching
 * `updateMediaMetadata`'s width/height/cssClass undefined/null/value contract (see that input
 * type's doc). Deliberately distinct from `@jini-ai/cms/media`'s string-field parsers: `width`/`height`/
 * `cssClass` accept `null` all the way through to the service layer, which has its own clear
 * semantics for them, whereas `alt`/`caption`/`credit`/`title` are mapped or rejected in `@jini-ai/cms/media`'s field parsers
 * before they ever reach `updateMediaMetadata` (see that module's doc for why).
 *
 * @complexity O(1).
 */
function parseOptionalNullableField<T>({ raw, convert }: { raw: unknown; convert: (value: unknown) => T }, _optional = {}): T | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  return convert(raw);
}

/**
 * Reads the nine metadata fields `updateMediaMetadata` accepts off an untyped request body,
 * applying the field-level parse rules above. A missing body coerces to `{}` so every field
 * reads as omitted rather than throwing on a property access — the pre-extraction route made the
 * same allowance via `req.body?.field`.
 *
 * `slug` (2026-09-07) joins the fixed key list `updateMediaMetadata` reads — this function silently
 * dropping an unrecognized key is exactly the trap that would have made `slug` a no-op PATCH before
 * this line was added (the 2026-09-07 media admin UI report's "the trap" records the
 * confirmed mechanism: a 200 response with every OTHER field's change applied and no error at all).
 *
 * @complexity O(1) — reads ten fixed properties.
 */
function parseMediaMetadataPatch({ rawBody }: { rawBody: unknown }, _optional = {}) {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  return {
    title: parseOptionalTitleField({ raw: body.title }),
    slug: parseOptionalSlugField({ raw: body.slug }),
    alt: parseOptionalStringField({ raw: body.alt, field: "alt" }),
    caption: parseOptionalStringField({ raw: body.caption, field: "caption" }),
    credit: parseOptionalStringField({ raw: body.credit, field: "credit" }),
    // The 2,000-character bound lives in `updateMediaMetadata` (one validator); blank or null clears, omitted leaves it unchanged.
    width: parseOptionalNullableField({ raw: body.width, convert: Number }),
    height: parseOptionalNullableField({ raw: body.height, convert: Number }),
    cssClass: parseOptionalNullableField({ raw: body.cssClass, convert: String }),
    // Format/allowlist validation happens entirely in `updateMediaMetadata`
    // (`@jini-ai/cms/media`'s `resolveHtmlAttributesForUpdate`) — this parser's only job is the same
    // undefined-vs-provided/wrong-JSON-type boundary every other field parser in this file owns.
    htmlAttributes: parseOptionalNullableField({ raw: body.htmlAttributes, convert: String }),
  };
}

/** The route's ladder, in its order: a trashed/tombstoned asset (S8, web-high fix plan 2026-09-24),
 *  unknown 404, field validation 400, slug collision 409. Anything else is the host's 500. */
const MEDIA_UPDATE_ERRORS = [MEDIA_NOT_LIVE, MEDIA_NOT_FOUND, MEDIA_VALIDATION, MEDIA_CONFLICT] as const;

/**
 * PATCH media metadata (title/slug/alt/caption/credit/description/width/height/cssClass — `source.sha256` is
 * write-once and this route's input shape has no field for it, matching
 * `updateMediaMetadata`'s contract). Gated by `media.update` (SPEC-021 REQ-39/OQ-01, ADR-027 §7).
 *
 * The body is read only after authorization (the hand-written route parsed it inside its `try`,
 * after the 403), so a refused caller never learns which of its fields were malformed.
 */
export const mediaUpdateRoute = defineJsonRoute<{ mediaId: string; body: unknown }, AdminMediaEnvelope, MediaUpdateRouteDeps, MediaRoutePrincipal>({
  method: "patch",
  path: "/api/admin/v1/workspaces/:workspaceId/media/:mediaId",
  parse: (raw) => ok({ value: { mediaId: mediaIdParam({ params: raw.params }), body: raw.body } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMedia({ authorize, permission: "media.update" }, { entityId: input.mediaId });
    try {
      const { media } = await updateMediaMetadata({
        deps: { clock: deps.clock, mediaRepo: deps.mediaRepo },
        input: { workspaceId: deps.workspaceId, id: input.mediaId, ...parseMediaMetadataPatch({ rawBody: input.body }) },
      });
      return ok({ value: { media: await describeMediaAsset({ deps, media }) } });
    } catch (err) {
      return rejectMediaError({ err, mappings: MEDIA_UPDATE_ERRORS, outwardErrorMessage: deps.outwardErrorMessage });
    }
  },
});
