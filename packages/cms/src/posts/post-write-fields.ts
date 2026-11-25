import type { PostStatus } from "../core/index.js";
import { PostValidationError, type PostRecord, type PostBodyFormat } from "./post.js";
import type { JsonObject } from "@jini-ai/core/primitives";

/** api.spec.md §4 / behavior.spec.md §4: `title` maxLength. Exported so `agent-tools.ts`'s
 * published `inputSchema` can reuse the same bound instead of a second, driftable copy. */
export const MAX_TITLE_LENGTH = 200;

/** Shared status-enum rule (`updatePost` and `createPost`'s explicit-status path both apply it). */
export function isValidPostStatus(status: unknown): status is PostStatus {
  return status === "draft" || status === "published";
}

/** An ISO 8601 date-time WITH an explicit offset (`Z` or `±hh:mm`). Required, not merely parseable:
 *  a bare `2026-10-12T09:00` would be read in the server's own timezone, which is rarely the
 *  author's — the browser editor converts its local picker value to an offset form before sending. */
export const PUBLISH_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Upper bound on a featured-image media id (UUIDs are 36 chars; slugs are resolved to ids first). */
export const MAX_FEATURED_MEDIA_ID_LENGTH = 200;

/**
 * Scheduled publishing (2026-10-05) — validates a caller's go-live time and normalizes it to the
 * ISO UTC form `isLiveAt` string-compares against. Tri-state like every optional update field:
 * `undefined` passes through ("unchanged"), `null`/`""` clears it.
 *
 * @throws {PostValidationError} When the value is not an offset-qualified ISO 8601 date-time.
 * @complexity O(1).
 */
export function normalizePublishAt({ value }: { value: unknown }, _optional: Record<string, never> = {}): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !PUBLISH_AT_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new PostValidationError("publishAt must be an ISO 8601 date-time with a timezone offset (e.g. 2026-10-12T09:00:00-07:00 or 2026-10-12T16:00:00Z), or null");
  }
  return new Date(value).toISOString();
}

/** Featured image (2026-10-05) — same tri-state as {@link normalizePublishAt}. Shape only: whether
 *  the asset exists is checked by the caller that resolved it (the agent tool / media picker).
 *  @throws {PostValidationError} When the value is not a short non-empty string. @complexity O(1). */
export function normalizeFeaturedMediaId({ value }: { value: unknown }, _optional: Record<string, never> = {}): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_FEATURED_MEDIA_ID_LENGTH) {
    throw new PostValidationError(`featuredMediaId must be a media asset id (1-${MAX_FEATURED_MEDIA_ID_LENGTH} characters) or null`);
  }
  return value.trim();
}

/** Validates trimmed display credit without coercing untrusted objects into names.
 * @throws PostValidationError for a non-string credit or more than 200 display characters.
 * @complexity O(n) time/space in the supplied credit's length for trimming.
 */
export function normalizePostAuthor(required: { author: unknown }, _optional: Record<string, never> = {}): string | null {
  const { author } = required;
  if (author === undefined || author === null) return null;
  if (typeof author !== "string") throw new PostValidationError("author must be a string or null");
  const displayName = author.trim();
  if ([...displayName].length > 200) throw new PostValidationError("author must be at most 200 characters");
  return displayName || null;
}

/** Only a real boolean may enable the public byline. */
export function normalizeShowPostAuthor(required: { showAuthor: unknown }, _optional: Record<string, never> = {}): boolean | undefined {
  const { showAuthor } = required;
  if (showAuthor === undefined) return undefined;
  if (typeof showAuthor !== "boolean") throw new PostValidationError("showAuthor must be a boolean");
  return showAuthor;
}

/** The schedule/featured-image keys a record carries — present only when set, so a row that has
 *  neither keeps the exact record shape it had before these fields existed (the same "absent, not
 *  empty" convention `ext` follows). @complexity O(1). */
export function presentScheduleFields(fields: { publishAt?: string | null; featuredMediaId?: string | null }, _optional: Record<string, never> = {}): Pick<PostRecord, "publishAt" | "featuredMediaId"> {
  return {
    ...(fields.publishAt ? { publishAt: fields.publishAt } : {}),
    ...(fields.featuredMediaId ? { featuredMediaId: fields.featuredMediaId } : {}),
  };
}

/**
 * The `kind` -> `bodyFormat` write-chokepoint gate,
 * shared by `resolveCreateFields` and `updatePost`. Deliberately takes NO input: neither
 * `CreatePostInput` nor `UpdatePostInput` has a `bodyFormat`/`bodyHtml` field at all, so there is
 * nothing to read, let alone trust, from a caller — `createPost`/`updatePost` can produce only
 * `(bodyFormat: "doc", bodyHtml: null)`, by construction, not by rejecting a bad value after the
 * fact. AC-1 ("a Post can never carry body_format: 'html'") holds even against a caller that
 * smuggles those properties onto the input object past the type system (a raw JS caller, or one
 * forwarding untyped `req.body`) — this function never looks at `input` in the first place.
 *
 * `bodyFormat: "html"` is a real, valid `PostRecord` shape (a Page written by
 * `PagesHtmlDocumentStore`, `features/pages/html-document-store.sqlite.ts`), but that adapter writes directly to
 * the `posts` row and never calls `createPost`/`updatePost` — see `PostRecord.bodyFormat`'s doc.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export function resolveBodyFields(): { bodyFormat: PostBodyFormat; bodyHtml: string | null } {
  return { bodyFormat: "doc", bodyHtml: null };
}

/**
 * `updatePost`'s body resolution — **preserves** the row's existing format instead of asserting
 * `"doc"` the way {@link resolveBodyFields} does for a create.
 *
 * ## The bug this exists to fix
 *
 * `updatePost` used to spread `resolveBodyFields()` directly, forcing `(bodyFormat: "doc",
 * bodyHtml: null)` onto every update. The reasoning recorded at the call site was sound as far as
 * it went — the *body* of an html Page is written only by `PagesHtmlDocumentStore` — but it did not
 * account for the fact that an html Page's **title, slug and status** have nowhere else to be
 * edited. `pages/update.ts` is the only route that can change them, and it goes through here. The
 * result: saving a title on a bespoke-HTML Page silently reverted it to `doc` format and discarded
 * `body_html` entirely — the whole generated page, gone, with a 200 response and no warning.
 *
 * It was unreachable until a Page could become `"html"` in the first place
 * (`PagesHtmlDocumentStore.ensureHtmlFormat`), which is why it had never fired.
 *
 * ## What it does instead
 *
 * - A `"doc"` row updates exactly as before — `resolveBodyFields()`'s guarantee is unchanged, and a
 *   Post (always `"doc"`, since nothing can make one `"html"`) is untouched by this function's
 *   existence. AC-1 still holds by construction.
 * - An `"html"` row keeps its format and its `body_html`, and ignores `input.bodyJson` — an html
 *   Page has no Tiptap document, and accepting one here is how the two body columns would end up
 *   populated at once. The carried-over `bodyJson` is the placeholder `repo.sqlite.ts`'s `toRecord`
 *   substitutes for the null column; `save()` maps it back to null on the way down, so the pair
 *   stays inverse and the table's CHECK constraint holds.
 *
 * Neither branch reads a caller-supplied `bodyFormat`/`bodyHtml` — `UpdatePostInput` still has no
 * such field, so a caller still cannot convert a row's format through this path. Conversion remains
 * `PagesHtmlDocumentStore.ensureHtmlFormat`'s alone.
 *
 * @complexity O(1).
 */
export function resolveUpdateBodyFields(
  existing: PostRecord,
  inputBodyJson: JsonObject
): { bodyFormat: PostBodyFormat; bodyHtml: string | null; bodyJson: JsonObject } {
  if (existing.bodyFormat === "html") {
    return { bodyFormat: "html", bodyHtml: existing.bodyHtml, bodyJson: existing.bodyJson };
  }
  return { ...resolveBodyFields(), bodyJson: inputBodyJson };
}

/**
 * api.spec.md `title` maxLength bound ({@link MAX_TITLE_LENGTH}), measured on the trimmed title —
 * one check, one message, for both `createPost` and `updatePost`. The update path used to check
 * only that the title was non-empty, so a retitle could store a title create would have refused.
 *
 * @throws PostValidationError `title must be 200 characters or fewer`.
 * @complexity O(1).
 */
export function assertTitleWithinLimit({ trimmedTitle }: { trimmedTitle: string }, _optional: Record<string, never> = {}): void {
  if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    throw new PostValidationError(`title must be ${MAX_TITLE_LENGTH} characters or fewer`);
  }
}

/** Refuses a present, non-boolean flag. @throws {PostValidationError} `<name> must be a boolean`. */
export function assertOptionalBoolean(required: { value: unknown; name: string }): void {
  if (required.value !== undefined && typeof required.value !== "boolean") throw new PostValidationError(`${required.name} must be a boolean`);
}

/** Keep presentation's tri-state contract at both write boundaries. Null resets the choice;
 * empty template and false are explicit choices and must not be coerced away. @complexity O(1). */
export function assertPostPresentationFields(required: { templateChoice?: string | null; overridesThemePage?: boolean | null }, _options = {}): void {
  if (required.templateChoice !== undefined && required.templateChoice !== null && typeof required.templateChoice !== "string") {
    throw new PostValidationError("templateChoice must be a string or null");
  }
  assertOptionalBoolean({ value: required.overridesThemePage ?? undefined, name: "overridesThemePage" });
}

function savedPostPresentation({ post }: { post: PostRecord }, _options: Record<string, never> = {}) {
  return {
    templateChoice: post.templateChoice ?? null,
    author: post.author ?? null,
    showAuthor: post.showAuthor ?? false,
    publishAt: post.publishAt ?? null,
  };
}

/**
 * The content this save path owns, with absent optional values represented as their stored
 * defaults. Null template/override choices remain distinct from explicit empty/false choices.
 * Revision `content_hash` cannot serve this comparison: it hashes the entire snapshot, including
 * the version and timestamp that every candidate save advances.
 * @complexity O(1) time/space — nested JSON is referenced, not copied; the caller compares it.
 */
export function savedPostContent(post: PostRecord) {
  return {
    title: post.title,
    slug: post.slug,
    status: post.status,
    bodyFormat: post.bodyFormat,
    bodyJson: post.bodyFormat === "html" ? null : post.bodyJson,
    bodyHtml: post.bodyFormat === "html" ? post.bodyHtml : null,
    ...savedPostPresentation({ post }),
    featuredMediaId: post.featuredMediaId ?? null,
    overridesThemePage: post.overridesThemePage ?? null,
    ext: post.ext ?? {},
  };
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
