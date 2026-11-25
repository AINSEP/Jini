import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
export const CONTENT_POST_DELETE_TOOL_ID = "content_post_delete";
import { DEFAULT_POST_LIST_LIMIT, MAX_POST_LIST_LIMIT } from "./post-read.js";
import { MAX_SLUG_LENGTH, SLUG_FORMAT_PATTERN } from "./slug.js";
import { MAX_TITLE_LENGTH } from "./post-write-fields.js";
import { SLUG_OR_ROOT_PATTERN } from "./post-slugs.js";
import { DEFAULT_POST_SEARCH_LIMIT, MAX_POST_SEARCH_LIMIT } from "./search.js";
import { POST_KIND_SCHEMA, PUBLISH_AT_SCHEMA, POST_LIST_FIELDS, TIPTAP_TEXT_BODY_EXAMPLE } from "./post-tool-schemas.js";

/**
 * @file The Posts + Pages agent-tool catalog — this domain's instance of the per-domain
 * `agent-tools.ts` convention every other wired domain (`Jini packages/cms/src/entries/agent-tools.ts`,
 * `widgets/agent-tools.ts`, `forms/agent-tools.ts`, ...) already uses.
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes. Every
 * entry maps 1:1 onto a real exported function of `features/post/post.ts` (`createPost`,
 * `updatePost`, `listAdminPosts`, `listAdminPages`, `getAdminPostById`) — this catalog never names
 * an operation the domain cannot perform.
 *
 * ONE domain, not two catalogs. `features/post/post.ts`'s own `PostKind` doc is explicit: "Same
 * record shape, same repo, same editor — `kind` only changes which admin list surfaces a row and
 * how it's created." Posts and Pages are the SAME backend (`server/routes/admin/posts/*` and
 * `server/routes/admin/pages/*` both call straight into `createPost`/`updatePost`/`getAdminPostById`/
 * `listAdminPosts`/`listAdminPages`, no other library involved) — so this catalog is one cohesive
 * set of `content_post_*` tools taking an explicit `kind` parameter, not a `post_*` catalog plus a
 * separate `page_*` one.
 *
 * Naming, disclosed to avoid the collision this project has hit before (ADR-049 Decision 4's own
 * `backup_create_restore_point` precedent, and `Jini packages/cms/src/entries/agent-tools.ts`'s own naming
 * disclosure): prefixed `content_post_*` — checked against every existing catalog's ids
 * (`grep -rn 'name: "[a-z_]*"' src/**\/agent-tools.ts`) before choosing it. It is deliberately NOT
 * `entry_*`/`post_*`/`page_*` (any of which could be misread as reaching `features/entries`, a
 * wholly unrelated backend with no relationship to this module at all — no shared table, no shared
 * write chokepoint, no shared permission, per `entries/agent-tools.ts`'s own file header), and NOT
 * `collections_*` (already `collections_entry_*` for Entries and `collections_content_type_*` for
 * Content Types — a genuinely different domain each).
 *
 * HISTORY — this file previously recorded "There is NO delete tool", on the accurate observation
 * that `PostRepoPort` exposed exactly four methods (`findById`/`findBySlug`/`list`/`save`) with no
 * delete method anywhere in the domain to wrap. That is no longer true and the absence is no longer
 * deliberate: `post.ts` now exports `deletePost`, `PostRepoPort` now carries `softDelete`, both
 * adapters implement it, and `apps/website/src/server/inbound/admin-http/routes/posts/delete.ts` + `.../pages/delete.ts` are the
 * human-facing routes `content_post_delete` mirrors. The note is kept rather than erased because a
 * reader who remembers the old claim needs to see that it was retired on purpose.
 *
 * Deliberate absences (the point of a catalog, not an oversight):
 * - There is NO separate publish/unpublish tool. Unlike `Jini packages/cms/src/entries/write-service.ts`
 *   (`publishEntry`/`unpublishEntry` as their own functions), `post.ts` has exactly one write path
 *   for status changes: `updatePost`'s `status` field, validated by `classifyStatusTransition`.
 *   `content_post_update` IS how an agent publishes or unpublishes a post/page — there is no second,
 *   narrower tool to add, because the domain itself has no narrower function.
 * - `content_post_update` NOW accepts a partial patch (S7, fix-plan-tool-design-2026-09-24.md): only
 *   `id` is required (`kind` now derives from the stored row when omitted), and
 *   `title`/`slug`/`bodyJson`/`status` are each independently optional,
 *   matching `collections_entry_update`/`forms_update_definition`'s shape. `updatePost` (`post.ts`)
 *   itself still has NO partial-update capability — it still reads `input.title.trim()`/`input.slug.
 *   trim()`/`isJsonObject(input.bodyJson)`/`isValidPostStatus(input.status)` unconditionally, so this
 *   tool's handler fills every field the caller omitted from the stored row (inside the same
 *   `captureInverse` read `posts/update.ts`/`pages/update.ts` never needed a partial-patch version
 *   of, because their save button always sends the full record) before calling it. A caller sending
 *   `{id, kind}` alone — nothing to change — is rejected before the domain call, same as before this
 *   slice's caller-input-was-the-problem discipline for every other missing/malformed field.
 * - `content_post_get`'s and `content_post_update`'s `kind`-mismatch behavior is intentionally
 *   ASYMMETRIC between `kind:"post"` and `kind:"page"`, and that asymmetry is inherited, not
 *   invented. `posts/get-by-id.ts` and `posts/update.ts` (legacy, kind-blind routes — confirmed by
 *   reading both) never check whether the row they found is actually a `"post"`; `pages/get-by-id.ts`
 *   and `pages/update.ts` (the newer routes) both guard explicitly and 404 a kind mismatch
 *   "indistinguishable from not-found" (their own doc comments' words). This catalog's handlers
 *   mirror each real route's actual behavior for the `kind` the caller asked for — `kind:"post"`
 *   inherits the legacy laxity, `kind:"page"` inherits the guard — rather than picking one behavior
 *   and silently applying it to both, which would invent a capability (or a restriction) neither
 *   real route has.
 *
 * `content_post_search` is the one entry here that does NOT mirror an existing admin screen, and
 * that is deliberate rather than an oversight in the "mirror the routes" discipline the rest of this
 * catalog follows. The mirroring rule exists so a catalog never advertises a capability the product
 * does not have; it is not a rule that an agent may only do what a human can already click. There is
 * no admin search screen yet, but there IS a real capability underneath (`features/post/search.ts`
 * plus a durable FTS5 index, migration 0022), and the alternative for a model that needs to find
 * something was an unfiltered `content_post_list` returning full `bodyJson` for every row. On a site
 * with real content that was a corpus dump. Listing now supports optional kind, substring filters
 * and compact rows; `content_post_search` still exists so the "find the page about X,
 * then navigate to it with `page.navigate`" flow costs one bounded, ranked result set instead.
 *
 * What IS included, and why it is safe: `content_post_create`/`content_post_update` are wired
 * through `core/commands`'s `executeCommand` — the SAME command gateway `posts/create.ts`,
 * `posts/update.ts`, `pages/create.ts`, and `pages/update.ts` all route through, gated on the
 * identical `content.write` permission. `createPost`/`updatePost` themselves have no `authorize()`
 * call of their own (confirmed by reading `post.ts` in full), so `executeCommand`'s gate is the ONLY
 * enforcement point for either — not a second evaluator alongside a self-enforcing domain function
 * (ADR-021 §2), because no such self-enforcement exists here to duplicate.
 *
 * `bodyJson`'s published schema (see `TIPTAP_DOC_SCHEMA` below) describes the TipTap/ProseMirror
 * document vocabulary this codebase's own renderer (`apps/website/src/server/inbound/public-http/http/site/render/content-html.ts`'s `renderDocNode`)
 * actually interprets: `doc`/`paragraph` (attrs.textAlign)/`heading` (attrs.level/textAlign)/`text`
 * (with `bold`/`italic`/`code`/`strike`/`underline`/`subscript`/`superscript`/`textStyle`/`highlight`/
 * `link` marks)/`bulletList`/`orderedList`/`listItem`/`taskList`/`taskItem`/`blockquote`/`codeBlock`
 * (attrs.language)/`horizontalRule`/`table`/`tableRow`/`tableCell`/`tableHeader`/`media`/`youtube`/
 * `mention`/`hardBreak`/`widgetEmbed`. This is documentation for the model, not a runtime validator: `post.ts`'s
 * own `isJsonObject` check is the only real gate `createPost`/`updatePost` apply to `bodyJson`
 * (disclosed directly in that file's `createPost` doc comment — "this codebase has no deeper TipTap
 * schema validation anywhere else... so none is invented here"), and this catalog does not invent one
 * either. What it DOES add is a structural map of the vocabulary a model needs to author a real,
 * renderable document through this tool instead of guessing an opaque blob shape — every node/mark
 * type named here is one `renderDocNode` actually switches on, so a model that follows this schema
 * produces content the renderer will not silently drop into its `default:` (children-only,
 * formatting-losing) fallback.
 *
 * 2026-09-11: `image`/`youtube`/`mention`/`table`+`tableRow`+`tableCell`+`tableHeader`/`taskList`+
 * `taskItem`/`hardBreak` added — `renderDocNode` always had a correct case for each, but this schema
 * named none of them, so a model reading only this description had no way to learn it could author an
 * image inside a post at all (the incident that surfaced the gap: asked to embed an already-uploaded
 * image, the assistant told the owner it "cannot" go in a post body). Same-session follow-up, later
 * the same day: `image` was retired from THIS SCHEMA (not from the renderer — `render.ts` keeps
 * `DOC_NODE_HANDLERS.image`/`renderDocImage` live for undo/import back-compat with pre-existing
 * content) — superseded by the generic `media` node (byte-identical REF shape, plus real video
 * dispatch `image` never had) — so a model authoring NEW content no longer sees `image` as an
 * option at all. See `TIPTAP_DOC_SCHEMA`'s own doc comment for the full per-node detail, the
 * `image`->`media` schema retirement, and the two node types (`title`, `video`) deliberately still
 * absent.
 *
 * Same-day follow-up pass, once the node gap suggested the drift might not be limited to node types:
 * `TIPTAP_MARK_SCHEMA` had the identical defect on marks (documented 4 of `MARK_RENDERERS`'s 10 keys
 * — see that const's own 2026-09-11 doc comment for the investigation, which also confirms there is
 * no reverse case, an editor-producible mark the renderer silently drops), and two already-included
 * node types were missing attrs the renderer reads (`paragraph`/`heading`'s `attrs.textAlign`,
 * `codeBlock`'s `attrs.language`) because their `additionalProperties: false` objects never listed
 * those keys at all. A drift guard now lives in `agent-tools.tiptap-node-vocabulary.test.ts`: it reads
 * `render.ts`'s own `DOC_NODE_HANDLERS`/`MARK_RENDERERS` keys directly (both exported 2026-09-11 for
 * exactly this) and fails when one has no corresponding schema entry and no explicitly named opt-out,
 * so the next node or mark type added to the renderer cannot silently go undocumented here again.
 *
 * How it relates to the project:
 * `features/post/tool-registrations.ts` maps these entries into `@jini-ai/core` `ToolRegistration`s.
 *
 * Architectural role:
 * `features/post` domain declaration. Imports only the constants `post.ts` already enforces
 * (`MAX_TITLE_LENGTH`/`MAX_SLUG_LENGTH`/`SLUG_FORMAT_PATTERN`), so the published JSON Schema cannot
 * drift from what the domain function actually validates.
 */

/**
 * This domain's copy of the shared union (see `Jini packages/core/src/agent-tools.ts`'s own
 * `AgentToolSideEffect` for why `deletes-durable-state` is a distinct member and not a flavor of
 * `mutates-durable-state`).
 */
export type AgentToolSideEffect =
  | "none"
  | "mutates-durable-state"
  | "deletes-durable-state"
  | "mints-token";

/**
 * JSON Schema for this tool's `input`, published to the model via `ToolDescriptor.inputSchema`
 * (`Jini packages/core/src/registration-kit.ts`'s `buildDomainRegistrations`, which refuses to wire any
 * tool lacking one).
 */
export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

/**
 * The Posts + Pages domain's fixed agent-tool catalog: 3 reads (`content_post_search`/
 * `content_post_list`/`content_post_get`) plus the 3 writes `post.ts` actually exposes
 * (`content_post_create`/`content_post_update`/`content_post_delete`) — see this file's header for
 * the 2 remaining deliberate absences (no separate publish/unpublish, no partial update), the
 * retired no-delete-tool note, and the disclosed `kind`-guard asymmetry every one of
 * `content_post_get`/`content_post_update`/`content_post_delete` shares.
 *
 * NO `content_post_duplicate` here (2026-09-07 dispatch, then the owner's follow-up redesign,
 * `ADS-memory/reports/2026-09-07-page-tool-gap.md`/`-page-duplicate-tool.md`): a bespoke tool per
 * resource was rejected in favor of ONE cross-resource `content_duplicate` tool
 * (`features/content-duplication/agent-tools.ts`), generic over `resource`. This domain's own
 * `"post"`/`"page"` copy capability now lives at `tool-registrations.ts`'s
 * `duplicatePostOrPage`/`contributePostDuplicateHandlers`, wired into `content_duplicate` through
 * `assistant/duplicate-resource-registry.ts` rather than published as its own catalog entry here.
 *
 * Ordered read-first and destructive-last, matching `widgets/agent-tools.ts`'s/
 * `Jini packages/user-management/src/server/agent-tools.ts`'s convention: a model needs a `postId` before it can update or delete
 * one, and `content_post_search`/`content_post_list` (or `content_post_create`'s own result) is how
 * it learns one. `content_post_search` leads because it is the one a model should reach for first —
 * see its own entry for why.
 */
export function createPostAgentToolCatalog(required: {
  editGuidance: string;
  featuredImageSchema: Readonly<Record<string, unknown>> & { readonly description: string };
  postIdSchema: Readonly<Record<string, unknown>>;
  tiptapDocSchema: Readonly<Record<string, unknown>> & { readonly description: string };
  copy: { contentPostRead: string; navigate: string; menuRead: string; updateMenuTree: string; fetchPublishedPage: string; postPreview: string; trashRestoreItem: string };
}, _optional = {}): AgentToolDefinition[] {
  return [postSearchDefinition(required), postListDefinition(required), postGetDefinition(required), postCreateDefinition(required), postUpdateDefinition(required), postDeleteDefinition(required)];
}

function postSearchDefinition(required: Parameters<typeof createPostAgentToolCatalog>[0], _optional = {}): AgentToolDefinition {
  const { copy } = required;
  return {
    name: "content_post_search",
    description:
      "Finds posts and pages by relevance to a search query — the RIGHT WAY to locate content when you do not already " +
      "know its id or exact slug (for example, to answer 'where is the page about pricing?' and then navigate there with " +
      "" + copy.navigate + "). Searches titles, slugs, and the body text of every post and page in the workspace, ranked best " +
      "match first. Drafts are included; trashed items are never returned. " +
      "Returns SUMMARIES ONLY — id, kind, title, slug, status, updatedAt, a short body snippet, and a relevance score. " +
      "It deliberately does NOT return bodyJson: call " + copy.contentPostRead + " WITH the id once you have picked a result. " +
      "PREFER THIS OVER " + copy.contentPostRead + "'s listing mode for finding things — listing has no query and returns every row " +
      "of one kind (each with a plain-text excerpt), which gets long on a site with real content. Use that listing mode only when you " +
      "genuinely need the complete inventory of one kind. " +
      "Scores are relative within one result set (higher is better) and are not comparable across different queries; " +
      "an empty result means no post or page contains any of your terms, so try fewer or more general words.",
    sideEffects: "none",
    authorization: { permission: "content.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          minLength: 1,
          description:
            "Words to search for. Plain words only — this is not a query language, and punctuation/operators are " +
            "stripped rather than interpreted. Terms are OR'd, so a result matching only one of several words can " +
            "still rank; more specific queries simply rank better than broader ones. Rejected only if it contains " +
            "no letter or digit at all.",
        },
        kind: {
          ...POST_KIND_SCHEMA,
          description: `${POST_KIND_SCHEMA.description} Omit to search posts AND pages together.`,
        },
        status: {
          type: "string",
          enum: ["draft", "published"],
          description: "Omit to search drafts and published entries together. Set to 'published' to search only what is live on the public site.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_POST_SEARCH_LIMIT, clamp: true,
          description: `Maximum results to return. Defaults to ${DEFAULT_POST_SEARCH_LIMIT}; values above ${MAX_POST_SEARCH_LIMIT} are clamped to ${MAX_POST_SEARCH_LIMIT} rather than rejected.`,
        },
      },
    },
  };
}

function postListDefinition(required: Parameters<typeof createPostAgentToolCatalog>[0], _optional = {}): AgentToolDefinition {
  const { copy } = required;
  return {
    name: "content_post_list",
    description:
      "Lists posts or pages in the workspace (id, kind, title, slug, status, updatedAt, version, publicUrl, adminUrl, excerpt, " +
      "bodyChars, author and showAuthor, plus publishAt/featuredMediaId/scheduled only on rows that have them) — drafts included. scheduled:true marks a " +
      "published row still waiting for its publishAt (publicUrl is null until then). excerpt is the body's plain text: whole for a short list, cut shorter the more rows " +
      "are returned (at least 300 characters, ending in '…' when cut); " +
      "bodyChars is the full plain-text length. Pass includeBody:true to get every row's full bodyJson instead of excerpt/" +
      "bodyChars, or read one post WITH its id for its bodyJson. publicUrl is the row's resolved public path (e.g. '/about'), ready to pass straight to " + copy.fetchPublishedPage + " — " +
      "or null for a draft/unpublished row, since it has no live link yet. " +
      "Omit kind to list posts AND pages together with one global limit, or supply kind to use the admin Posts/Pages lens. " +
      "Optional query (alias: search; case-insensitive title or slug substring) and status filters run in this tool over the " +
      "already-loaded list, not in the admin route; no date filter is available. Pass fields to return only selected keys " +
      "plus id (always included); fields takes precedence over includeBody. " +
      `Capped at ${DEFAULT_POST_LIST_LIMIT} rows by default (raise with limit, up to ${MAX_POST_LIST_LIMIT}) — the response's ` +
      "total is the filtered count before limit (across both kinds when kind is omitted) and hasMore is true whenever posts.length < total, so truncation is " +
      "never silent.",
    sideEffects: "none",
    authorization: { permission: "content.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        kind: { ...POST_KIND_SCHEMA, description: `${POST_KIND_SCHEMA.description} Optional; omit to list both public kinds.` },
        query: {
          type: "string",
          aliases: ["search"],
          description: "Case-insensitive substring of title or slug (alias: search). Applied over the loaded list before limit; total counts matches. If both query and search are supplied, their values must agree.",
        },
        status: {
          type: "string",
          enum: ["draft", "published"],
          description: "Filter the loaded list by status before limit. Omit to include both drafts and published entries.",
        },
        fields: {
          anyOf: [{ type: "array", items: { type: "string", enum: POST_LIST_FIELDS } }, { type: "string" }],
          description: "Return only these keys per row, plus id (always included). A comma-separated string is also accepted. An empty array returns ids only. Overrides includeBody.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_POST_LIST_LIMIT, clamp: true,
          description: `Maximum rows to return. Defaults to ${DEFAULT_POST_LIST_LIMIT}; values above ${MAX_POST_LIST_LIMIT} are clamped to ${MAX_POST_LIST_LIMIT} rather than rejected.`,
        },
        includeBody: {
          type: "boolean",
          description:
            "Listing only. true returns each row's full TipTap bodyJson (large) instead of the plain-text excerpt/bodyChars. " +
            "Default false. Prefer reading one post by id when you need only a few full bodies.",
        },
      },
    },
  };
}

function postGetDefinition(required: Parameters<typeof createPostAgentToolCatalog>[0], _optional = {}): AgentToolDefinition {
  const { postIdSchema, copy } = required;
  return {
    name: "content_post_get",
    description:
      "Reads one post or page by id (id, kind, title, slug, status, bodyJson, updatedAt, version, publicUrl, plus publishAt, " +
      "featuredMediaId and scheduled only when set, plus author and showAuthor; scheduled:true means published but waiting for publishAt). publicUrl is the " +
      "row's resolved public path (e.g. '/about'), ready to pass straight to " + copy.fetchPublishedPage + " to verify it renders — or " +
      "null for a draft/unpublished row, since it has no live link yet. " +
      "Omit kind to derive it from the stored row. Disclosed asymmetry inherited from the two real admin routes this mirrors: with kind:'page', a row whose actual kind is " +
      "'post' is rejected as not-found (mirrors pages/get-by-id.ts's explicit guard) — but with kind:'post', a row whose actual " +
      "kind is 'page' is still returned (mirrors posts/get-by-id.ts's own legacy, kind-blind lookup). Browse entries with " + copy.contentPostRead + " without an ID.",
    sideEffects: "none",
    authorization: { permission: "content.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: postIdSchema, kind: { ...POST_KIND_SCHEMA, description: `${POST_KIND_SCHEMA.description} Optional; omit to derive kind from the id.` } },
    },
  };
}

function postCreateDefinition(required: Parameters<typeof createPostAgentToolCatalog>[0], _optional = {}): AgentToolDefinition {
  const { featuredImageSchema, tiptapDocSchema, copy } = required;
  return {
    name: "content_post_create",
    description:
      "Creates a new post or page. Omitted kind defaults to 'post'; send kind:'page' to create a page. Always starts as 'draft' unless status is explicitly set to 'published'. slug is derived from " +
      "title when omitted (disambiguated on collision); bodyJson defaults to an empty TipTap document ({ type: 'doc', content: [] }) " +
      `when omitted. Complete text body example: ${TIPTAP_TEXT_BODY_EXAMPLE}. Rejected if an explicitly-supplied slug is malformed, reserved ('admin'/'api'), or already taken in this workspace. ` +
      "The returned post includes publicUrl — its resolved public path when created with status 'published', or null for the " +
      "default 'draft' (nothing to link to yet until it is published via content_post_update). " +
      "When publicUrl is present, link to it first in your reply. adminUrl is an optional secondary edit link; never make a UUID admin URL the main published-content link. " +
      "Optional publishAt schedules it; featuredImage sets its lead image. A scheduled result has scheduled:true and publicUrl " +
      "null: tell the user when it will be published. A published result also has publishedWhere: whether it is on this local " +
      "site only or on the live site — never call a local-only publish live. A new page is not added to the site header: the header " +
      "shows the site menu, so link the page with " + copy.updateMenuTree + ". Read the rendered menu’s record with " + copy.menuRead + ".",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "content.write" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: {
        kind: { ...POST_KIND_SCHEMA, default: "post", description: `${POST_KIND_SCHEMA.description} Optional; defaults to 'post' when omitted. Send 'page' explicitly for a page.` },
        title: { type: "string", maxLength: MAX_TITLE_LENGTH, description: `Human-readable title, up to ${MAX_TITLE_LENGTH} characters. An empty/whitespace-only title defaults to 'Untitled'.` },
        slug: {
          type: "string",
          pattern: SLUG_OR_ROOT_PATTERN.source,
          maxLength: MAX_SLUG_LENGTH,
          description: `Optional explicit URL slug (lowercase letters, numbers, dashes; max ${MAX_SLUG_LENGTH} characters; cannot be 'admin' or 'api'). Omit to derive one from title. Or exactly '/' for the site homepage (kind:'page' only).`,
        },
        bodyJson: { ...tiptapDocSchema, description: `${tiptapDocSchema.description} Omit for an empty document.` },
        status: { type: "string", enum: ["draft", "published"], description: "Omit to default to 'draft'." },
        publishAt: PUBLISH_AT_SCHEMA,
        featuredImage: featuredImageSchema,
        author: { type: ["string", "null"], description: "Display credit, editable to any name. Omit to default to the signed-in account username; null or an empty string clears it. This does not change ownership or permissions." },
        showAuthor: { type: "boolean", description: "Show the author in the post byline. Defaults to false; author is still stored when hidden." },
      },
    },
  };
}

function postUpdateDefinition(required: Parameters<typeof createPostAgentToolCatalog>[0], _optional = {}): AgentToolDefinition {
  const { editGuidance, featuredImageSchema, postIdSchema, tiptapDocSchema, copy } = required;
  return {
    name: "content_post_update",
    description:
      "Patches an existing post/page — send id and only the fields that change. Omit kind to derive it from the stored row; " +
      "kind (legacy alias: type) cannot change the record's kind. Any of title, slug, bodyJson, status, publishAt, " +
      "featuredImage, author, showAuthor and template you omit keep their current stored values (the underlying updatePost function still has no partial-update path, so this tool fills the gap " +
      "from the stored row before calling it). Send at least one writable field, or the call is rejected. This is also how a " +
      "post/page is published or unpublished: {id, kind, status:'published'} (or 'draft') alone is enough — there is no separate " +
      "set-status tool. Set template to a filename from " + copy.postPreview + ".availableTemplates; choices are validated against the active theme and content kind. An empty string selects no template; null resets the choice. Schedule with status:'published' plus a future publishAt; a scheduled result has scheduled:true and " +
      "publicUrl null: tell the user when it will be published. A published result also has publishedWhere: whether it is on " +
      "this local site only or on the live site — never call a local-only publish live. Rejected if the row does not exist, if kind:'page' is given for an actual kind:'post' row (see " +
      "" + copy.contentPostRead + "'s identical disclosed asymmetry — not rejected the other way around), if a sent slug is " +
      "malformed/reserved/taken by another row, or if a sent bodyJson is not a JSON object. " +
      "SEND expectedVersion whenever you are editing content you read earlier: it is how you avoid silently erasing a change a " +
      "human made in the admin editor between your read and your write. Pass the 'version' from the " + copy.contentPostRead + " " +
      "row you based your edit on. If it no longer matches, the call is rejected with VERSION_CONFLICT and " +
      "NOTHING is written — read again and retry only if the affected content is unchanged. " +
      "If it changed, show the overlap and ask which edit to keep. Even " +
      "without expectedVersion, a partial patch (any field omitted) is still checked against the row's current version at write " +
      "time, so a human's save landing between your read and this call still rejects with VERSION_CONFLICT rather than silently " +
      "merging over it — only a FULL four-field call with no expectedVersion keeps the old unguarded last-write-wins behavior. " +
      "Returns post.publicUrl when published, null for drafts. Link to publicUrl first; adminUrl is only a secondary edit link, never the main published-content link. " +
      editGuidance,
    sideEffects: "mutates-durable-state",
    authorization: { permission: "content.write" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: postIdSchema,
        kind: { ...POST_KIND_SCHEMA, description: `${POST_KIND_SCHEMA.description} Optional; omit to derive kind from the id.` },
        title: { type: "string", minLength: 1, maxLength: MAX_TITLE_LENGTH, description: "Optional — omit to leave the title unchanged. Non-empty when sent (unlike create, an empty title is rejected here rather than defaulted)." },
        slug: {
          type: "string",
          pattern: SLUG_OR_ROOT_PATTERN.source,
          maxLength: MAX_SLUG_LENGTH,
          description: `Optional — omit to leave the slug unchanged. Lowercase letters, numbers, and dashes; max ${MAX_SLUG_LENGTH} characters when sent. Or exactly '/' for the site homepage (kind:'page' only).`,
        },
        bodyJson: { ...tiptapDocSchema, description: `Optional — omit to leave the body unchanged. The COMPLETE replacement body when sent, not a diff. ${tiptapDocSchema.description}` },
        status: { type: "string", enum: ["draft", "published"], description: "Optional — omit to leave the status unchanged. Setting this to 'published' from 'draft' is how a post/page is published; back to 'draft' is how it is unpublished." },
        publishAt: { ...PUBLISH_AT_SCHEMA, description: `Optional — omit to leave the schedule unchanged; null clears it. ${PUBLISH_AT_SCHEMA.description}` },
        featuredImage: { ...featuredImageSchema, description: `Optional — omit to leave the featured image unchanged. ${featuredImageSchema.description}` },
        author: { type: ["string", "null"], description: "Optional display credit — omit to keep the stored name; null or an empty string clears it. Does not change ownership or permissions." },
        showAuthor: { type: "boolean", description: "Optional — omit to keep the byline setting; true shows the stored author, false hides it." },
        template: { type: ["string", "null"], description: "Optional — omit to keep the saved template. Use a filename from " + copy.postPreview + ".availableTemplates for this post/page; invalid choices return the valid list. A landing page for a different brand or product takes a template without the site header and footer (pages-blank.html in the bundled themes) when the list offers one. Empty string selects no template; null resets the choice to the renderer's default behavior." },
        // OPTIONAL, and it must stay optional: making it required would break every caller that
        // predates it, and the domain guard itself is opt-in (`updatePost` treats an absent basis as
        // "no basis sent" and keeps its original last-write-wins behavior).
        expectedVersion: {
          type: "integer",
          minimum: 0,
          description:
            "OPTIONAL optimistic-concurrency basis — the 'version' of the row you read before making this edit. Omit it and " +
            "this update simply overwrites whatever is currently stored, INCLUDING a human's unseen changes. Send it and the " +
            "update is rejected with VERSION_CONFLICT (nothing written) if anyone saved in the meantime. Send it whenever you " +
            "have a version to send. On conflict, read again and retry only if the affected content is unchanged. " +
            "If it changed, show the overlap and ask which edit to keep.",
        },
      },
    },
  };
}

function postDeleteDefinition(required: Parameters<typeof createPostAgentToolCatalog>[0], _optional = {}): AgentToolDefinition {
  const { postIdSchema, copy } = required;
  return {
    name: "content_post_delete",
    description:
      "Waits for human approval, then moves one post or page to Trash with {id}. Omitted kind is derived from the stored post or page; an explicit kind is also accepted. Returns {deleted: true, cancelled: false, post}. This is a reversible soft delete: the row is retained and can be restored through " + copy.trashRestoreItem + " or the recorded change set. Requires content.read and content.write. Refuses a missing/already-trashed row, an internal template, a page kind mismatch, or a concurrent version change. Permanent deletion is a separate confirmation-gated tool.",
    // Genuinely destructive, and classified as its own thing rather than folded into the same
    // bucket as an edit — `tool-registrations.ts`'s independent `postDerivedRisk` derives the
    // identical value from what the handler actually calls, and the two are compared for equality
    // at build time (`assertToolIsWirable`), so this declaration cannot quietly soften itself.
    sideEffects: "deletes-durable-state",
    // `content.write`, not a new `content.delete`: deleting content is writing content, this
    // codebase grants no `content.delete` anywhere, and inventing a permission no policy grants
    // would make the tool unusable rather than safer. Matches `posts/delete.ts`/`pages/delete.ts`.
    authorization: { permission: "content.write" },
    // Owner 2026-10-07: the shared registration policy asks before reversible removal too.
    // Consent arrives through the human surface exchange, never a model-supplied input field.
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: postIdSchema, kind: { ...POST_KIND_SCHEMA, description: `${POST_KIND_SCHEMA.description} Optional; omit to derive the kind from the stored row.` } },
    },
  };
}

