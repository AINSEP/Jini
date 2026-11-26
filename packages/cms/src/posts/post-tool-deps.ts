import type { RemovePostFn } from "./post-trash.js";
import type { ForgetRemovedPostFn } from "../widgets/host-ports.js";
import type { SlugChangeCaptureLookup } from "@jini-ai/cms/posts/post-slugs";
import type { PostAuthorAccountPort } from "./post-create.js";
import type { BeforeSaveHookPort } from "@jini-ai/cms/posts/post-before-save";
import type { Clock } from "@jini-ai/core/primitives";
import type { EventBusPort, OutboxPort, AuthorizeFn, ChangeSetRepoPort } from "@jini-ai/core/contracts/events";
import type { PostRepoPort } from "@jini-ai/cms/posts/post";
import type { AgentToolDefinition, ToolHandler } from "@jini-ai/core";
import type { executeCommand } from "../core/commands/index.js";
import type { isDeepStrictEqual } from "node:util";
import type { PostToolViewDeps } from "./post-tool-views.js";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";
import type { PublicPostKind } from "@jini-ai/core/contracts/site/cms-core";
import type { PostSearchPort } from "@jini-ai/cms/posts/search";
import type { FeaturedImageDeps } from "@jini-ai/cms/posts/featured-image";
import type { RuntimeMode } from "@jini-ai/core/contracts/site/core-runtime-mode";

/**
 * Structural mirror of `features/pages/html-document-store.sqlite.ts`'s
 * `PagesHtmlDocumentStorePort`/`PagesHtmlDocumentStoreFactory` — declared locally rather than
 * imported. Importing the real type would add a `features/post -> features/pages` value-import
 * edge on top of the existing `features/pages -> features/post` one (`pages/tool-registrations.ts`
 * already imports `PostRepoPort` as `import type` from this domain), closing a module cycle
 * `check:architecture` would flag. Same Option-B-style injection this file's own `contributePostTools`
 * history already documents for `listPublishedPosts`/`extractGitHubLogin` (see that function's
 * trailing comment): depend on the shape, wire the real implementation only at the composition root.
 *
 * `server/routes/types.ts`'s `RouteDeps.pagesHtmlStore` already carries a real
 * `PagesHtmlDocumentStoreFactory`, and every `PostToolDeps` this repo actually constructs in
 * production is built from (or assignable from) that same `RouteDeps` object — so no composition-root
 * change is needed to wire this field; it is already present on the object that flows through.
 */
export interface DuplicatePagesHtmlStore {
  ensureHtmlFormat(required: { seedHtml: string }, optional?: Record<string, never>): Promise<void>;
  read(): Promise<string>;
  write(required: { html: string }, optional?: Record<string, never>): Promise<void>;
}
export type DuplicatePagesHtmlStoreFactory = (scope: { workspaceId: string; postId: string }) => DuplicatePagesHtmlStore;

/**
 * The exact slice of the route-deps bag Posts/Pages' tool handlers read. Declared structurally
 * (rather than importing `server/routes/types`'s `RouteDeps`) so this module carries no back-edge
 * into the composition root for the `RouteDeps` god type specifically — the `assistant/mcp-ui` import above is a
 * separate, already-disclosed back-edge left
 * untouched per the dispatch's explicit out-of-scope list. `server/routes/*` satisfies this
 * structurally by passing its existing `RouteDeps` object; nothing there changes.
 */
export interface PostToolDeps {
  copyBodyJsonWithFreshEmbedPlacements: typeof import("../widgets/duplicate-embeds.js").copyBodyJsonWithFreshEmbedPlacements;
  reservedSegments: ReadonlySet<string>;
  postPublicPath: import("./post-slugs.js").PostPublicPathResolver;
  isDeepStrictEqual: typeof isDeepStrictEqual;
  contentReadPermission: string;
  contentPostReadToolId: string;
  contentWritePermission: string;
  assistantActorPluginId: string;
  catalog: ReadonlyMap<string, AgentToolDefinition>;
  executeCommand: typeof executeCommand;
  processOutbox: (required: { outbox: OutboxPort; bus: EventBusPort; clock: Clock }) => Promise<unknown>;
  withPluginHookRefusals: (required: { handlers: Record<string, ToolHandler> }) => Record<string, ToolHandler>;
  postToolViewDeps: (required: { routeDeps: PostToolDeps }) => PostToolViewDeps;
  headerNavigationView: (required: { kind: PostKind }) => Record<string, unknown>;
  readPostTemplateOptions: (required: { deps: PostToolDeps; kind: PublicPostKind }) => Promise<string[]>;
  findMediaByIdOrSlug: FeaturedImageDeps["findMediaByIdOrSlug"];
  featuredImageRefusals: Record<"missing" | "trashed" | "not-image", (required: { ref: string }, optional?: { contentType?: string | undefined }) => string>;
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: Clock;
  idGen: { newId(): string };
  changeSets: ChangeSetRepoPort;
  outbox: OutboxPort;
  bus: EventBusPort;
  postRepo: PostRepoPort;
  /** Account lookup for the creation-time author default; production RouteDeps supplies it. */
  userRepo?: PostAuthorAccountPort;
  postSearch: PostSearchPort;
  pluginBeforeSaveHook: BeforeSaveHookPort;
  /** Routing's slug-change slot lookup — `content_post_update` renames leave the same 301 the admin
   *  routes' do. A `RouteDeps` satisfies it; see `UpdatePostDeps.slugChangeCapture`. */
  slugChangeCapture: SlugChangeCaptureLookup;
  /**
   * The pre-bound removal `content_post_delete` hands `deletePost` — see `post.ts`'s
   * {@link import("@jini-ai/cms/posts/post").RemovePostFn}. Structurally typed, so this file also imports nothing
   * from `features/trash`; a `RouteDeps` satisfies it by having the field.
   */
  removePost: RemovePostFn;
  /**
   * The undo half of {@link removePost}: both rollbacks in this file restore a post through
   * `restorePostForward`, and an undone delete must drop the Trash index row the removal wrote.
   * Structurally typed for the same reason — see `post.ts`'s
   * {@link import("@jini-ai/cms/posts/post").ForgetRemovedPostFn}.
   */
  forgetRemovedPost: ForgetRemovedPostFn;
  /**
   * OPTIONAL — `content_duplicate`'s `"post"`/`"page"` resource handlers
   * ({@link duplicatePostOrPage}) are the only consumers in this domain that need it. Kept optional
   * (rather than required, like `PagesToolDeps.pagesHtmlStore`) so every existing `PostToolDeps` test
   * double that predates this field keeps compiling unchanged; a real production caller always has
   * one (see this field's type doc above). When absent, duplicating an HTML-format page is refused
   * with an explicit, actionable error rather than silently dropping the page's body.
   */
  pagesHtmlStore?: DuplicatePagesHtmlStoreFactory;
  /**
   * OPTIONAL — only `content_post_create`/`content_post_update`'s `featuredImage` field reads these,
   * to resolve a media id or slug to the asset id the post stores (`featured-image.ts`). Optional for
   * the same reason as {@link pagesHtmlStore}: older test doubles keep compiling, and a production
   * `RouteDeps` always has both. When absent, a sent `featuredImage` is refused, never guessed at.
   */
  mediaRepo?: FeaturedImageDeps["mediaRepo"];
  mediaContentTypeStore?: FeaturedImageDeps["mediaContentTypeStore"];
  /** OPTIONAL — whether this instance is the live site, for {@link publishedWhereView}. Defaults to
   *  `resolveRuntimeMode()` (the host runtime setting); tests pass a fake. */
  runtimeMode?: () => RuntimeMode;
}
