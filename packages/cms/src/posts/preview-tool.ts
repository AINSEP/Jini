import type { AgentToolSideEffect } from "@jini-ai/core";
import { toolMetadata } from '@jini-ai/core/tool-metadata/post';
import { adaptLegacyAuthorize, requireToolPermission, type AgentToolDefinition } from "@jini-ai/core";
import { ToolInputError, buildDomainRegistrations, indexCatalogById, requireInputRecord, type ToolRegistration, type ToolContributor } from "@jini-ai/core";
import { type JsonObject } from "@jini-ai/core/primitives";
import { type AuthorizeFn } from "@jini-ai/core/contracts/events";
import { getAdminPostByIdOrSlug } from "@jini-ai/cms/posts/post-read";
import { PostNotFoundError, type PublicPostRecord as PostRecord, type PostRepoPort } from "@jini-ai/cms/posts/post";
type PageBodyOptions = { maxBytes?: number | undefined; find?: string | undefined; textOnly?: boolean | undefined };
type ShapedPageBody = { bodyBytes: number; truncated: boolean } & (
  { body: string; matches?: never; matchCount?: never } |
  { matches: Array<{ offset: number; snippet: string }>; matchCount: number; body?: never }
);
declare const readPageBodyOptions: (required: { input: Record<string, unknown> }, optional?: Record<string, never>) => PageBodyOptions;
declare const shapePageBody: (required: { body: string }, optional?: PageBodyOptions) => ShapedPageBody;

/** Renderer injected at the server composition root; the feature has no server/assistant value edge. */
export interface PostPreviewToolDeps {
  workspaceId: string; authorize: AuthorizeFn; postRepo: PostRepoPort;
  catalog: readonly AgentToolDefinition[];
  readPermission: string;
  readPostTemplateOptions: (required: { deps: PostPreviewToolDeps; kind: PostRecord["kind"] }) => Promise<string[]>;
  readPageBodyOptions: typeof readPageBodyOptions;
  shapePageBody: typeof shapePageBody;
  missingPostMessage: (id: string) => string;
}
export interface PostPreviewInput { post: PostRecord; templateChoice?: string | null; bodyJson?: JsonObject; bodyHtml?: string }
export interface PostPreviewRenderer {
  renderPostPreview({ deps, input }: { deps: PostPreviewToolDeps; input: PostPreviewInput }, optional?: Record<string, never>): Promise<{ html: string; templateChoice: string | null }>;
}
export const postPreviewDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map([
  // -> getAdminPostByIdOrSlug + injected renderer: reads and in-memory clones only, no saves.
  ["content_post_preview", "none"],
]);

/** Validate all override fields before copying any of them or performing reads. */
function validatePreviewOverrides(input: Record<string, unknown>, _options: Record<string, never> = {}): void {
  for (const key of ["templateChoice", "bodyHtml"] as const) if (input[key] !== undefined && typeof input[key] !== "string") throw new ToolInputError({ message: `content_post_preview: ${key} must be a string.` });
  if (input.bodyJson !== undefined && (typeof input.bodyJson !== "object" || input.bodyJson === null || Array.isArray(input.bodyJson))) throw new ToolInputError({ message: "content_post_preview: bodyJson must be a JSON object." });
}

/**
 * Reads id (or its legacy postId alias) and unsaved edits without changing the input. A supplied
 * id wins even when invalid, so a stale alias cannot redirect a preview to a different record.
 * Empty HTML/template opt-outs are preserved; malformed fields throw ToolInputError.
 * @complexity O(1) field checks.
 */
function readPreviewInput(input: Record<string, unknown>, _options: Record<string, never> = {}): { postId: string; overrides: Omit<PostPreviewInput, "post"> } {
  const id = input.id === undefined ? input.postId : input.id;
  if (typeof id !== "string" || id.trim().length === 0) throw new ToolInputError({ message: "content_post_preview: id must be a non-empty id or slug (postId is a legacy alias)." });
  validatePreviewOverrides(input);
  const overrides: Omit<PostPreviewInput, "post"> = {};
  if (input.templateChoice !== undefined) overrides.templateChoice = input.templateChoice as string;
  if (input.bodyHtml !== undefined) overrides.bodyHtml = input.bodyHtml as string;
  if (input.bodyJson !== undefined) overrides.bodyJson = input.bodyJson as JsonObject;
  return { postId: id, overrides };
}

/** Builds the read-only preview handler; authorization precedes lookup and any render read. */
export function buildPostPreviewRegistrations({ deps, renderer }: { deps: PostPreviewToolDeps; renderer: PostPreviewRenderer }, _optional: Record<string, never> = {}): ToolRegistration[] {
  const CATALOG = indexCatalogById({ catalog: deps.catalog });
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "post-preview", catalogModule: "features/post/preview-tool.ts", catalog: CATALOG, derivedRisk: postPreviewDerivedRisk, handlers: {
    content_post_preview: async ctx => {
      const input = requireInputRecord({ input: ctx.input });
      const { postId, overrides } = readPreviewInput(input);
      const options = deps.readPageBodyOptions({ input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: deps.readPermission }, { entityType: "post" });
      let post: PostRecord;
      try { ({ post } = await getAdminPostByIdOrSlug({ deps: { repo: deps.postRepo }, input: { workspaceId: deps.workspaceId, idOrSlug: postId } })); }
      catch (error) {
        if (error instanceof PostNotFoundError) throw new ToolInputError({ message: deps.missingPostMessage(postId) });
        throw error;
      }
      const rendered = await renderer.renderPostPreview({ deps, input: { post, ...overrides } });
      const availableTemplates = await deps.readPostTemplateOptions({ deps, kind: post.kind });
      const shaped: ShapedPageBody = deps.shapePageBody({ body: rendered.html }, options);
      return { postId: post.id, title: post.title, status: post.status, templateChoice: rendered.templateChoice, availableTemplates, ...shaped };
    },
  } });
}
/** Contributes under its own domain, preserving all of post's existing tools. */
export function contributePostPreviewTools(renderer: PostPreviewRenderer, _optional: Record<string, never> = {}): ToolContributor<PostPreviewToolDeps, unknown> {
  return { domain: "post-preview", build: deps => buildPostPreviewRegistrations({ deps, renderer }), risk: postPreviewDerivedRisk };
}

export function createPostPreviewAgentToolCatalog({ fetchPublishedPageToolId, fetchLiveUrlToolId }: { fetchPublishedPageToolId: string; fetchLiveUrlToolId: string }, _optional: Record<string, never> = {}): AgentToolDefinition[] {
  return [{
  name: "content_post_preview",
  description: `Renders a post or page by id (or slug; postId is a legacy alias) — including a draft, or edits you haven't saved — through its theme template. Preview a draft by entry ID. Use available browser widths for actual visual checks and report those widths. A public-route screenshot checks only the page served at that address. Use before publishing to check a draft, or to try a different template. Changes nothing. For a published page as visitors get it, use ${fetchPublishedPageToolId} (local) or ${fetchLiveUrlToolId} (live). Returns postId, title, status, templateChoice, availableTemplates, bodyBytes, truncated and body, or matches with offsets/snippets and matchCount when find is supplied. Set a saved template with content_post_update's template field using one of availableTemplates. Pass textOnly for text without markup. Refuses an unknown id/slug, invalid options, or a template preview when no theme is active.`,
  sideEffects: "none" as const, authorization: { permission: "content.read" },
  inputSchema: { type: "object", additionalProperties: false, anyOf: [{ required: ["id"] }, { required: ["postId"] }], properties: {
    id: { type: "string", minLength: 1, description: "Post/page id or slug, any status except Trash. Takes precedence over postId." },
    postId: { type: "string", minLength: 1, description: "Legacy alias for id. Prefer id." },
    templateChoice: { type: "string", description: "Optional pending choice. Omit to use the saved choice; empty string opts out of a template." },
    bodyJson: { type: "object", description: "Optional unsaved document body." },
    bodyHtml: { type: "string", description: "Optional unsaved HTML body for an HTML-format page." },
    find: { type: "string", minLength: 1, maxLength: 200 }, textOnly: { type: "boolean" },
    maxBytes: { type: "integer", minimum: 1, maximum: 1000000 },
  } },
}];

}

export function bindPostPreviewTools(required: Pick<PostPreviewToolDeps, "catalog" | "readPermission" | "readPageBodyOptions" | "shapePageBody"> & {
  contentPostReadToolId: string;
  readPostTemplateOptions(required: { deps: Pick<PostPreviewToolDeps, "workspaceId" | "authorize" | "postRepo">; kind: PostRecord["kind"] }): Promise<string[]>;
}, _optional: Record<string, never> = {}) {
  const build = ({ deps, renderer }: { deps: Pick<PostPreviewToolDeps, "workspaceId" | "authorize" | "postRepo">; renderer: { renderPostPreview(required: { deps: Pick<PostPreviewToolDeps, "workspaceId" | "authorize" | "postRepo">; input: PostPreviewInput }, optional?: Record<string, never>): Promise<{ html: string; templateChoice: string | null }> } }, _optional: Record<string, never> = {}) =>
    buildPostPreviewRegistrations({ deps: { ...deps, catalog: required.catalog, readPermission: required.readPermission, readPageBodyOptions: required.readPageBodyOptions, shapePageBody: required.shapePageBody,
      readPostTemplateOptions: ({ kind }) => required.readPostTemplateOptions({ deps, kind }),
      missingPostMessage: postId => `content_post_preview: no post or page with id or slug '${postId}'. Use ${required.contentPostReadToolId} to find it.`,
    }, renderer: { renderPostPreview: ({ input }) => renderer.renderPostPreview({ deps, input }) } });
  return { buildPostPreviewRegistrations: build,
    contributePostPreviewTools: (renderer: Parameters<typeof build>[0]["renderer"], _optional: Record<string, never> = {}): ToolContributor<Pick<PostPreviewToolDeps, "workspaceId" | "authorize" | "postRepo">, unknown> =>
      ({ domain: "post-preview", build: deps => build({ deps, renderer }), risk: postPreviewDerivedRisk }),
  };
}
