import { DEFAULT_POST_LIST_LIMIT, MAX_POST_LIST_LIMIT } from "@jini-ai/cms/posts/post-read";
import { ToolInputError } from "@jini-ai/core";
import type { PostStatus } from "@jini-ai/cms/core";
import { extractPlainTextFromHtml } from "../seo/html-plain-text.js";
import { type PostRecord } from "@jini-ai/cms/posts/post";
import { POST_LIST_FIELDS } from "@jini-ai/cms/posts/post-tool-schemas";
import { extractPostPlainText } from "@jini-ai/cms/posts/search";
import { resolvePublicUrl, resolveAdminUrl, scheduleView, type PostToolViewWithPublicUrl } from "@jini-ai/cms/posts/post-tool-views";
import type { PostToolDeps } from "./post-tool-deps.js";

/**
 * Clamps `content_post_list`'s optional `limit` into `[1, MAX_POST_LIST_LIMIT]`, flooring
 * fractions, defaulting to `DEFAULT_POST_LIST_LIMIT` when omitted — mirrors `search.ts`'s own
 * `clampLimit` for `content_post_search` (clamp rather than reject: an out-of-range `limit` is not
 * a shape problem worth a round trip to fix).
 *
 * @complexity O(1).
 */
export function clampPostListLimit({ limit }: { limit: number | undefined }, _optional: Record<string, never> = {}): number {
  if (limit === undefined) return DEFAULT_POST_LIST_LIMIT;
  return Math.min(Math.max(Math.floor(limit), 1), MAX_POST_LIST_LIMIT);
}

/**
 * Plain-text characters one `content_post_list` call returns across all its rows.
 * The listing used to return every row's full TipTap `bodyJson`: a real "summarize my 6 posts" turn
 * got 67.7 KB back through the MCP bridge, over Claude Code's MCP output cap, so the CLI saved it to
 * a file and the model spent extra rounds reading it back. Now each row carries a plain-text
 * `excerpt` instead, and the budget is split evenly across the rows returned: a small inventory
 * gets whole bodies (no follow-up reads), a default 50-row page gets 600 characters each. Never
 * less than {@link POST_LIST_MIN_EXCERPT_CHARS} per row. `includeBody: true`, or a read by id,
 * returns the full body.
 */
export const POST_LIST_TEXT_BUDGET = 30_000;

/** The per-row excerpt floor, however many rows a listing returns. */
export const POST_LIST_MIN_EXCERPT_CHARS = 300;

/** A listing row without `bodyJson`: see {@link POST_LIST_TEXT_BUDGET}. */
type PostListRow = Omit<PostToolViewWithPublicUrl, "bodyJson"> & { excerpt: string; bodyChars: number };

type PostListField = (typeof POST_LIST_FIELDS)[number];

/**
 * Reads optional projection keys from tool input; omitted keys retain the legacy row shape.
 * @param input - Listing input with an optional fields array or comma-separated string.
 * @returns Supported keys, or undefined when projection was not requested.
 * @throws {ToolInputError} If fields contains unsupported names or has the wrong shape.
 * @complexity O(f) in requested fields; the allowed vocabulary has a fixed size.
 */
export function optionalPostListFields({ input }: { input: Record<string, unknown> }, _options = {}): PostListField[] | undefined {
  const fields = typeof input.fields === "string" ? input.fields.split(",").map(field => field.trim()) : input.fields;
  if (fields === undefined) return undefined;
  if (!Array.isArray(fields) || !fields.every((field) => POST_LIST_FIELDS.includes(field))) {
    throw new ToolInputError({ message: `content_post_list: fields must be an array or comma-separated string of supported field names. Supported names: ${POST_LIST_FIELDS.join(", ")}. Example: {"kind":"page","fields":["title","slug"]}.` });
  }
  return fields as PostListField[];
}

/**
 * Matches a loaded post against optional status and a normalized title/slug substring.
 * @param post - A live record already scoped to the requested workspace and kind.
 * @param filters - Optional status and lower-case query; omitted criteria match all records.
 * @returns Whether the record satisfies both supplied criteria.
 * @complexity O(t + s) time and space in title/slug lengths when query is present; no I/O.
 */
export function matchesPostListFilters(post: PostRecord, filters: { query?: string | undefined; status?: PostStatus | undefined }): boolean {
  if (filters.status !== undefined && post.status !== filters.status) return false;
  if (filters.query === undefined) return true;
  return post.title.toLowerCase().includes(filters.query) || post.slug.toLowerCase().includes(filters.query);
}

/**
 * Copies only selected listing keys, always retaining id; never mutates the source row.
 * @param required.row - The compact row to project.
 * @param required.fields - Validated keys (duplicates are harmless).
 * @returns An id-bearing row with no unrequested keys.
 * @complexity O(f) time and space in selected fields.
 */
export function projectPostListRow({ row, fields }: { row: PostListRow; fields: PostListField[] }, _optional: Record<string, never> = {}): Partial<PostListRow> & { id: string } {
  return { id: row.id, ...Object.fromEntries(fields.map((field) => [field, row[field]])) };
}

/**
 * Cuts `text` to at most `maxChars` characters, on a word boundary when one is near the end, and
 * appends "…" when anything was cut, so a cut excerpt never reads as the whole body.
 * @complexity O(n) in the text length.
 */
function toExcerpt({ text, maxChars }: { text: string; maxChars: number }, _optional: Record<string, never> = {}): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars);
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace > maxChars * 0.8 ? head.slice(0, lastSpace) : head;
  return `${cut.trimEnd()}…`;
}

/** Per-row excerpt length for a listing of `rowCount` rows: see {@link POST_LIST_TEXT_BUDGET}. */
export function excerptCharsFor({ rowCount }: { rowCount: number }, _optional: Record<string, never> = {}): number {
  return Math.max(POST_LIST_MIN_EXCERPT_CHARS, Math.floor(POST_LIST_TEXT_BUDGET / Math.max(1, rowCount)));
}

/** The compact listing row: {@link toPostToolViewWithPublicUrl} minus `bodyJson`, plus a plain-text
 *  `excerpt` and the full plain-text length as `bodyChars`. An `"html"`-format Page's text comes from
 *  `bodyHtml` — its `bodyJson` is only the empty placeholder (`repo.rows.ts`'s `toRecord`). */
export function toPostListRow({ routeDeps, post, excerptChars }: { routeDeps: PostToolDeps; post: PostRecord; excerptChars: number }, _optional: Record<string, never> = {}): PostListRow {
  const text =
    post.bodyFormat === "html"
      ? extractPlainTextFromHtml({ html: post.bodyHtml ?? "" }).replace(/\s+/g, " ").trim()
      : extractPostPlainText({ bodyJson: post.bodyJson });
  return {
    id: post.id,
    kind: post.kind,
    title: post.title,
    slug: post.slug,
    status: post.status,
    updatedAt: post.updatedAt,
    version: post.version,
    publicUrl: resolvePublicUrl({ deps: routeDeps.postToolViewDeps({ routeDeps }), post }),
    adminUrl: resolveAdminUrl({ post }),
    excerpt: toExcerpt({ text, maxChars: excerptChars }),
    bodyChars: text.length,
    author: post.author ?? null,
    showAuthor: post.showAuthor ?? false,
    ...scheduleView({ post }),
  };
}
