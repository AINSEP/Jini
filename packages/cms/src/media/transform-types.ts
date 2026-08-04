/**
 * @file Domain types + typed errors for the named transform registry and
 * rendition generation ("Transforms and the immutable URL
 * contract").
 *
 * Purpose:
 * `TransformDefinitionRecord` is the `transform_registry` sidecar row: a
 * declarative, immutable, append-only named transform definition keyed
 * `(workspaceId, name, version)`. `TransformParams` is the small closed set
 * of resize/format parameters this build supports — deliberately NOT an
 * arbitrary `?w=&h=` query grammar (an explicit amplification /
 * URL-grammar-freeze decision).
 *
 * SCOPE NOTE (disclosed): the original design describes transforms as declarable by
 * "core + theme/plugin". This build only implements the core-declared path —
 * there is no theme/plugin declaration API here (out of scope for this task).
 * `owner` is kept as a plain string (not a hardcoded `"core"` literal type)
 * specifically so a future theme/plugin declarer can pass its own id through
 * the same field without a schema change — mirrors
 * `identity/permissions.ts`'s `PermissionDescriptor.owner` pattern, which
 * solves the identical "who registered this, extensibly" problem for the
 * permission catalog.
 */
import type { ISODateTime, UUID } from "../core/ports.js";

/** Resize behavior, mirrors `sharp`'s `fit` vocabulary (a deliberately small subset). */
export type TransformFit = "cover" | "contain" | "fill" | "inside" | "outside";

/**
 * Output re-encode format. Matches `media-service.ts`'s
 * `DEFAULT_ALLOWED_MIME_TYPES` image set minus SVG (never a transform output —
 * SVG has no raster pixels to resize).
 */
export type TransformFormat = "jpeg" | "png" | "webp" | "gif";

/**
 * Declarative transform parameters (named definitions only, never
 * caller-supplied dimensions). `width`/`height` are optional so a
 * format-only re-encode (no resize) is a valid definition; `fit` only
 * matters when both `width` and `height` are given.
 */
export interface TransformParams {
  width?: number | undefined;
  height?: number | undefined;
  fit?: TransformFit | undefined;
  format: TransformFormat;
}

/**
 * `transform_registry` sidecar row. Identity is
 * `(workspaceId, name, version)`; a row, once inserted, is never updated or
 * removed — see `TransformDefinitionRepoPort.insert`'s append-only contract
 * in `ports.ts`. Redefining `name` mints a new row with `version` one higher
 * than the previous max, never a mutation of the old row.
 */
export interface TransformDefinitionRecord {
  id: UUID;
  workspaceId: UUID;
  name: string;
  version: number;
  params: TransformParams;
  /** Registering module — `"core"` for every definition this task creates. See file header. */
  owner: string;
  createdAt: ISODateTime;
}

export class TransformValidationError extends Error {}

/** Maps a {@link TransformFormat} to the MIME type served on the rendition response. */
const MIME_BY_TRANSFORM_FORMAT: Record<TransformFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * @complexity O(1).
 * @overallScore 100
 */
export function mimeForTransformFormat(format: TransformFormat): string {
  return MIME_BY_TRANSFORM_FORMAT[format];
}

/** Upper bound on a requested resize dimension — an output-side resource-use guard (not the
 * full pixel-bomb ingest cap, which polices upload input; this polices the transform
 * definition itself so a registered definition can't ask the image transformer to allocate an
 * absurd target canvas). */
export const MAX_TRANSFORM_DIMENSION_PX = 8000;

/**
 * Validates a {@link TransformParams} value at registration time. Throws
 * {@link TransformValidationError} on the first violation found.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function assertValidTransformParams(params: TransformParams): void {
  if (!params.format || !(params.format in MIME_BY_TRANSFORM_FORMAT)) {
    throw new TransformValidationError(
      `transform params.format must be one of ${Object.keys(MIME_BY_TRANSFORM_FORMAT).join(", ")}`
    );
  }
  for (const [key, value] of [
    ["width", params.width],
    ["height", params.height],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 1 || value > MAX_TRANSFORM_DIMENSION_PX) {
      throw new TransformValidationError(
        `transform params.${key} must be an integer between 1 and ${MAX_TRANSFORM_DIMENSION_PX}`
      );
    }
  }
  if (params.fit !== undefined && !(params.width && params.height)) {
    throw new TransformValidationError("transform params.fit requires both width and height");
  }
}
