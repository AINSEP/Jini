/**
 * The host-named tools the model-facing post/page schema copy points at. The schemas move with the
 * posts owner; the tool names are the host's, so they arrive on the args object rather than being
 * baked into the copy.
 */
export interface PostSchemaToolNames {
  /** The read tool for one media asset (`content_read.media_asset` in Tovu). */
  readonly mediaRead: string;
  readonly mediaUpload: string;
  readonly mediaGenerate: string;
  readonly mediaImportFromUrl: string;
  /** Inserts a widget embed placement into a post body. */
  readonly widgetInsertEmbed: string;
  /** Creates a post/page; its result carries the id. */
  readonly postCreate: string;
  /** The read tool for a post/page (its listing mode takes no id). */
  readonly postRead: string;
}

export const POST_KIND_SCHEMA = {
  type: "string",
  aliases: ["type"],
  enum: ["post", "page"],
  description:
    "'post' for a blog-style entry (surfaces on the admin Posts list), 'page' for a standalone document " +
    "(About, Contact, ... — surfaces on the admin Pages list). Same underlying record, same editor — this " +
    "is fixed at creation and cannot be changed afterward.",
} as const;

/**
 * Scheduled publishing (2026-10-05). The pattern is the one `normalizePublishAt` (`post.ts`)
 * enforces, restated as text because the domain's own regex is not exported; an offset is required
 * so "9am" is never silently read in the server's timezone.
 */
export const PUBLISH_AT_SCHEMA = {
  type: ["string", "null"],
  description:
    "When the post/page goes live, as an ISO 8601 date-time WITH a timezone offset, e.g. '2026-10-12T09:00:00-07:00' or " +
    "'2026-10-12T16:00:00Z' (a time without an offset is rejected). Takes effect only together with status 'published': a " +
    "published post whose publishAt is in the future is SCHEDULED: hidden from the public site, feeds, sitemap and search " +
    "until that time, then live with no further action. A draft keeps its publishAt but stays hidden until published. A past " +
    "time means live at once. null (or omitted) means no schedule: live as soon as it is published. Stored in UTC.",
} as const;

/** Featured image (2026-10-05) — resolved by `featured-image.ts`. */
export function featuredImageSchema({ tools }: { tools: PostSchemaToolNames }, _options: Record<string, never> = {}) {
  return {
    type: ["string", "null"],
    description:
      `The post/page's featured image: the id or slug of an EXISTING image in the media library (from ${tools.mediaRead}, ` +
      `${tools.mediaUpload}, ${tools.mediaGenerate} or ${tools.mediaImportFromUrl}). Stored as the asset's id. Themes show it as the post's ` +
      "lead image and it becomes the og:image/twitter:image social preview unless the SEO settings override it. For a cover-only " +
      "request, set featuredImage and do not also insert that image into bodyJson unless the user explicitly asks for it in the body; " +
      "the theme already renders the cover above the body, so inserting it there too shows the same photo twice. Rejected if no " +
      "asset has that id or slug, if the asset is in Trash, or if it is a video or other non-image. null removes it.",
  } as const;
}

/** Supported compact listing keys, shared with the handler's projection validator. */
export const POST_LIST_FIELDS = [
  "id", "kind", "title", "slug", "status", "updatedAt", "version", "publicUrl", "adminUrl", "excerpt", "bodyChars",
  "publishAt", "featuredMediaId", "scheduled", "author", "showAuthor",
] as const;

export function postIdSchema({ tools }: { tools: PostSchemaToolNames }, _options: Record<string, never> = {}) {
  return {
    type: "string",
    minLength: 1,
    description: `The post/page's id, as returned by ${tools.postCreate}, or by ${tools.postRead} called WITHOUT an id (its listing mode).`,
  } as const;
}

export const TIPTAP_TEXT_BODY_EXAMPLE = '{"bodyJson":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"temp"}]}]}}';
