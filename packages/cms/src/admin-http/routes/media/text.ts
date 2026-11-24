import { defineJsonRoute, ok, type JsonRouteSpec } from "@jini-ai/core/contracts/server";

import { DocumentTextExtractionError } from "../../../media/document-text.js";
import { MediaValidationError } from "../../../media/types.js";
import { authorizeMedia, MEDIA_NOT_FOUND, MEDIA_VALIDATION, mediaIdParam, rejectMediaError, type MediaErrorMapping, type MediaRoutePrincipal } from "./shared.js";

/** The host's document-text reader (the shared 64 KiB UTF-8 paging owner, bound to its storage and extractors). */
export type MediaTextReader = (required: { workspaceId: string; id: string; offset: number }) => Promise<unknown>;

/** The deps this route reads: the workspace and the host's bound reader. */
export interface MediaTextRouteDeps {
  workspaceId: string;
  readText: MediaTextReader;
}

/** A refused extraction keeps its own code; a missing document is the flat 404, a refused read the flat 400. */
const TEXT_READ_ERRORS: readonly MediaErrorMapping[] = [
  { matches: ({ err }, _o = {}) => err instanceof DocumentTextExtractionError, status: 400, code: "own" },
  MEDIA_NOT_FOUND,
  MEDIA_VALIDATION,
];

/** An omitted offset pages from byte 0; anything but a run of decimal digits is refused before any read.
 *  @complexity O(n) in the offset's length. */
function parseTextOffset({ rawOffset }: { rawOffset: unknown }, _optional: Record<string, never> = {}): number {
  if (rawOffset === undefined) return 0;
  if (typeof rawOffset !== "string" || !/^\d+$/u.test(rawOffset)) throw new MediaValidationError({ message: "offset must be a non-negative byte offset" });
  return Number(rawOffset);
}

/**
 * Private source reads share Library tools' 64 KiB UTF-8 paging policy. Authorize before bytes: the
 * check names the asset (`media.read` on `media` + its id), then the offset is checked, then the host
 * reader pages. The denial body (`media.read is required`, no `details`) is the host mount's `forbidden`
 * reply; every answer, refusals included, carries {@link MEDIA_TEXT_RESPONSE_HEADERS}.
 */
const textSpec = defineJsonRoute<{ mediaId: string; rawOffset: unknown }, unknown, MediaTextRouteDeps, MediaRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/media/:mediaId/text",
  parse: (raw) => ok({ value: { mediaId: mediaIdParam({ params: raw.params }), rawOffset: raw.query.offset } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeMedia({ authorize, permission: "media.read" }, { entityId: input.mediaId });
    try {
      const offset = parseTextOffset({ rawOffset: input.rawOffset });
      return ok({ value: await deps.readText({ workspaceId: deps.workspaceId, id: input.mediaId, offset }) });
    } catch (err) {
      return rejectMediaError({ err, mappings: TEXT_READ_ERRORS });
    }
  },
});

/** Private source text is never cached or content-sniffed, whatever the answer (the 404/403/500 too). */
export const MEDIA_TEXT_RESPONSE_HEADERS: Readonly<Record<string, string>> = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** The text spec plus its static response headers (an http-kit opt-in core's spec type does not name). */
export type MediaTextRouteSpec = JsonRouteSpec<{ mediaId: string; rawOffset: unknown }, unknown, MediaTextRouteDeps, MediaRoutePrincipal> & {
  responseHeaders: Readonly<Record<string, string>>;
};

export const mediaTextRoute: MediaTextRouteSpec = { ...textSpec, responseHeaders: MEDIA_TEXT_RESPONSE_HEADERS };
