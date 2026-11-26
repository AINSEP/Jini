import { toolMetadata } from '@jini-ai/core/tool-metadata/post';
import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/cms/core";
import { ToolInputError, buildDomainRegistrations, indexCatalogById, requireInputRecord, type DerivedRiskByToolId, type ToolRegistration, type ToolContributor } from "@jini-ai/core";
import { type JsonObject } from "@jini-ai/core/primitives";
import { type AuthorizeFn } from "@jini-ai/core/contracts/events";
import { getAdminPostById } from "@jini-ai/cms/posts/post-read";
import { PostNotFoundError, type PublicPostRecord as PostRecord, type PostRepoPort } from "@jini-ai/cms/posts/post";
import type { readPageBodyOptions, shapePageBody, ShapedPageBody } from "@jini-ai/diagnostics/web-evidence/page-body";

/** Renderer injected at the server composition root; the feature has no server/assistant value edge. */
export interface PostPreviewToolDeps {
  workspaceId: string; authorize: AuthorizeFn; postRepo: PostRepoPort;
  catalog: Parameters<typeof indexCatalogById>[0]["catalog"];
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
export const postPreviewDerivedRisk: DerivedRiskByToolId = new Map([
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
      try { ({ post } = await getAdminPostById({ deps: { repo: deps.postRepo }, input: { workspaceId: deps.workspaceId, id: postId } })); }
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
