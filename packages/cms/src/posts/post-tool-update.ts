import { normalizePostAuthor, normalizeShowPostAuthor } from "@jini-ai/cms/posts/post-write-fields";
import type { isDeepStrictEqual } from "node:util";
import { ToolInputError } from "@jini-ai/core";
import type { JsonObject } from "@jini-ai/core/primitives";
import type { PostStatus, PublicPostKind } from "@jini-ai/cms/core";
import { isPublicPost, PostNotFoundError, type PostRecord, type PublicPostRecord } from "@jini-ai/cms/posts/post";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";
import { optionalNonEmptyString, optionalBodyJson, optionalPostStatus, optionalPublishAt } from "./post-tool-input.js";
import type { PostToolDeps } from "./post-tool-deps.js";

/** content_post_update's validated caller fields; `undefined` means "not sent". */
interface PostUpdatePatch {
  title?: string | undefined;
  slug?: string | undefined;
  bodyJson?: JsonObject | undefined;
  status?: PostStatus | undefined;
  author?: string | null | undefined;
  showAuthor?: boolean | undefined;
  templateChoice?: string | null | undefined;
  publishAt?: string | null | undefined;
}

/**
 * Validates content_post_update's own fields in the tool's documented order (first failure wins);
 * `featuredImage` is resolved separately because it reads the media library.
 * @throws {ToolInputError | PostValidationError} The first invalid field's refusal, unchanged.
 * @complexity O(1).
 */
export function parseUpdatePatch(input: Record<string, unknown>): PostUpdatePatch {
  const title = optionalNonEmptyString({ input, key: "title" });
  const slug = optionalNonEmptyString({ input, key: "slug" });
  const bodyJson = optionalBodyJson({ input, key: "bodyJson" });
  const status = optionalPostStatus(input);
  // Tri-state, forwarded as-is: `updatePost` itself keeps the stored value for `undefined`
  // and clears on `null`, so these need no fill-in from `existing` the way the four above do.
  const author = input.author === undefined ? undefined : normalizePostAuthor({ author: input.author });
  const showAuthor = normalizeShowPostAuthor({ showAuthor: input.showAuthor });
  const templateChoice = input.template;
  if (templateChoice !== undefined && templateChoice !== null && typeof templateChoice !== "string") {
    throw new ToolInputError({ message: "content_post_update: template must be a filename from content_post_preview.availableTemplates, an empty string for no template, or null to reset the choice. Nothing was changed." });
  }
  return { title, slug, bodyJson, status, author, showAuthor, templateChoice, publishAt: optionalPublishAt(input) };
}

/** Refuses an update that sends no field to change. @throws {ToolInputError} Naming every accepted field. */
export function assertPatchNotEmpty(required: { patch: PostUpdatePatch; featuredMediaId: string | null | undefined }): void {
  if (required.featuredMediaId === undefined && Object.values(required.patch).every(value => value === undefined)) {
    throw new ToolInputError({ message: "content_post_update: send at least one of title, slug, bodyJson, status, publishAt, featuredImage, author, showAuthor or template. Nothing was changed." });
  }
}

/** Whether any of the four fill-in fields was omitted, so `existing` supplies it. @complexity O(1). */
export function isPartialPatch(patch: PostUpdatePatch): boolean {
  return patch.title === undefined || patch.slug === undefined || patch.bodyJson === undefined || patch.status === undefined;
}

/** The four fill-in fields: the caller's value, else the stored one. @complexity O(1). */
export function mergeUpdatePatch(required: { patch: PostUpdatePatch; existing: PostRecord }): { title: string; slug: string; bodyJson: JsonObject; status: PostStatus } {
  const { patch, existing } = required;
  return {
    title: patch.title ?? existing.title,
    slug: patch.slug ?? existing.slug,
    bodyJson: patch.bodyJson ?? existing.bodyJson,
    status: patch.status ?? existing.status,
  };
}

/**
 * Reads the post/page content_post_update edits. Omitted kind uses the stored row's kind;
 * templates and missing rows are not-found, as is a non-page for explicit kind "page".
 * @throws {PostNotFoundError} `post '<id>' was not found` / `page '<id>' was not found`.
 * @complexity O(1) — one repo read.
 */
export async function loadUpdateTarget(required: { routeDeps: PostToolDeps; id: string; kind: PostKind | undefined }, _options: Record<string, never> = {}): Promise<PublicPostRecord> {
  const { routeDeps, id, kind } = required;
  const existing = await routeDeps.postRepo.findById({ workspaceId: routeDeps.workspaceId, id });
  if (!isPublicPost(existing)) throw new PostNotFoundError(`post '${id}' was not found`);
  if (kind === "page" && existing.kind !== "page") {
    // Kind mismatch treated identically to not-found — mirrors pages/update.ts exactly
    // (see agent-tools.ts's disclosed asymmetry; kind:"post" carries no such guard,
    // mirroring posts/update.ts's own kind-blind captureInverse).
    throw new PostNotFoundError(`page '${id}' was not found`);
  }
  return existing;
}

/**
 * Refuses a named template the active theme does not offer for this kind; "" and null need no check.
 * @throws {ToolInputError} Listing the valid templates.
 * @complexity O(t) for t templates; one theme read only when a filename is sent.
 */
export async function assertTemplateAvailable(required: { routeDeps: PostToolDeps; templateChoice: string | null | undefined; kind: PublicPostKind }): Promise<void> {
  const { routeDeps, templateChoice, kind } = required;
  if (typeof templateChoice !== "string" || templateChoice === "") return;
  const availableTemplates = await routeDeps.readPostTemplateOptions({ deps: routeDeps, kind });
  if (!availableTemplates.includes(templateChoice)) {
    throw new ToolInputError({ message: `content_post_update: template '${templateChoice}' is not available for this ${kind} in the active theme. Valid templates: ${JSON.stringify(availableTemplates)}. Use one of these filenames, an empty string for no template, or null to reset the choice. Nothing was changed.` });
  }
}

/**
 * S3 (fix-plan-web-high-2026-09-24.md row 6) — `updatePost` ignores `bodyJson` outright
 * on an html-format row (CIC-3: an html Page's body is written only by
 * `PagesHtmlDocumentStore`, never through this chokepoint). Without this guard, a caller
 * sending a changed `bodyJson` got back a 200 with its edit silently dropped. Reject it
 * here instead, before the write — the one place this handler already has `existing` in
 * hand. A caller round-tripping the SAME bodyJson it just read (the metadata-only edit
 * case) is unaffected: `isDeepStrictEqual` makes this opt-in, not a ban on ever sending
 * the field. Compares the MERGED value, not the raw (possibly-omitted) input — see the
 * merge comment in content_post_update's `captureInverse` for why that is what lets a title-only patch succeed.
 * @throws {ToolInputError} `CONTENT_POST_HTML_BODY` with the editing alternatives.
 * @complexity O(n) for n JSON values compared.
 */
export function assertHtmlBodyUnchanged(required: { id: string; existing: PostRecord; bodyJson: JsonObject; isDeepStrictEqual: typeof isDeepStrictEqual; contentPostReadToolId: string }): void {
  const { id, existing, bodyJson } = required;
  if (existing.bodyFormat === "html" && !required.isDeepStrictEqual(bodyJson, existing.bodyJson)) {
    throw new ToolInputError({ message: `CONTENT_POST_HTML_BODY: page '${id}' is a bespoke-HTML page, so bodyJson can't change its body. ` +
        `To edit its title, slug or status, send bodyJson back exactly as ${required.contentPostReadToolId} returned it. ` +
        `To change the body, use pages_write_html or pages_write_region.` });
  }
}

/**
 * The pre-image content_post_update's change set records for undo.
 * `publishAt`/`featuredMediaId` ride in the pre-image as `null` for "none", the same
 * shape `posts/update.ts`'s inverse records, so an undo through `reverters.ts` puts a
 * cleared schedule or image back too. `templateChoice` is recorded only when the call sends one.
 * @complexity O(1).
 */
export function updateInverse(required: { existing: PostRecord; templateChoice: string | null | undefined }) {
  const { existing, templateChoice } = required;
  return {
    title: existing.title,
    slug: existing.slug,
    bodyJson: existing.bodyJson,
    status: existing.status,
    publishAt: existing.publishAt ?? null,
    featuredMediaId: existing.featuredMediaId ?? null,
    author: existing.author ?? null,
    showAuthor: existing.showAuthor ?? false,
    ...(templateChoice !== undefined ? { templateChoice: existing.templateChoice ?? null } : {}),
  };
}
