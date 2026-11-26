import type { JsonObject } from "@jini-ai/core/primitives";
import { extractEntryRefs, extractHtmlEntryRefs, type EntryRefRow } from "../widgets/entry-refs-extractor.js";
import type { PostRecord } from "@jini-ai/cms/posts/post";
import type { PageHtmlInverse } from "@jini-ai/core/contracts/site/page-html-store";



/**
 * @file The exact pre-write body a recorded assistant HTML change restores (P1-T2.T).
 *
 * Kept as the stored row's own bytes, never a normalized or rendered copy: an Undo that restores
 * something nobody ever saved is not an Undo. A doc Page's first full HTML write records the doc
 * body and format captured BEFORE `ensureHtmlFormat` nulls `body_json`, because after that the
 * doc exists nowhere else the reverter is allowed to read (the `pages_read_html` doc fallback is
 * rendered HTML, not the body).
 */


/** The change-set entity type every assistant HTML write records under. */
export const PAGE_HTML_ENTITY_TYPE = "page-html";

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The inverse for `row` as it stands right now, or null for a row with no restorable body.
 * @complexity O(1).
 */
export function pageHtmlInverseOf({ row }: { row: Pick<PostRecord, "bodyFormat" | "bodyHtml" | "bodyJson"> }, _optional = {}): PageHtmlInverse | null {
  if (row.bodyFormat === "html") return typeof row.bodyHtml === "string" ? { format: "html", html: row.bodyHtml } : null;
  return isJsonObject(row.bodyJson) ? { format: "doc", bodyJson: row.bodyJson } : null;
}

/**
 * Validates a stored inverse payload. The payload is data from the change-set table, so its shape
 * is checked rather than trusted; anything else is null and the reverter refuses it.
 * @complexity O(1).
 */
export function parsePageHtmlInverse({ payload }: { payload: unknown }, _optional = {}): PageHtmlInverse | null {
  if (!isJsonObject(payload)) return null;
  if (payload.format === "html" && typeof payload.html === "string") return { format: "html", html: payload.html };
  if (payload.format === "doc" && isJsonObject(payload.bodyJson)) return { format: "doc", bodyJson: payload.bodyJson };
  return null;
}

/**
 * The `entry_refs` rows the restored body implies, using the same extractor each format's own
 * write path uses, so a restore leaves the reference index as that format's write would.
 * @complexity O(n) in the body's size.
 */
export function restoredEntryRefs({ inverse, workspaceId, postId, report }: { inverse: PageHtmlInverse; workspaceId: string; postId: string; report: NonNullable<Parameters<typeof extractHtmlEntryRefs>[1]>["report"] }, _optional = {}): readonly EntryRefRow[] {
  if (inverse.format === "html") return extractHtmlEntryRefs({ workspaceId, sourceEntryId: postId, html: inverse.html }, { report });
  return extractEntryRefs({ workspaceId, sourceEntryId: postId, sourceEntryType: "page", bodyJson: inverse.bodyJson, fieldsExt: {} });
}
