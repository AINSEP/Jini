import { withoutUndefined } from "@jini-ai/core/records";

import { restorePostForward, deletePost } from "./post-trash.js";
import { listAdminPosts } from "@jini-ai/cms/posts/post-read";
import { normalizeShowPostAuthor, normalizePostAuthor } from "@jini-ai/cms/posts/post-write-fields";
import { createPost } from "./post-create.js";
import { toolMetadata } from '@jini-ai/core/tool-metadata/post';
import { AGENT_TOOL_PRINCIPAL_KIND, buildDomainRegistrations, optionalBoolean, optionalNumber, optionalString, requireInputRecord, requireString, withSchemaOnRejection, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { type JsonObject } from "@jini-ai/core/primitives";
import { type AgentToolDefinition as PostAgentToolDefinition, type ToolContributor } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";
import { withModelFacingErrors } from "@jini-ai/core/model-facing-tool-errors";
import { type PostRecord } from "@jini-ai/cms/posts/post";

import { assistantPostAttribution, postCommandDeps, postDerivedRisk } from "./post-tool-policy.js";
import { isPostShapeRejection, POST_MODEL_FACING_ERRORS } from "@jini-ai/cms/posts/post-tool-errors";
import { requirePostKind, optionalPostStatus, requireBodyJson, optionalPublishAt, resolveFeaturedImageInput } from "./post-tool-input.js";
import { toPostToolView, toPostToolViewWithPublicUrl, toPostWriteResultView } from "@jini-ai/cms/posts/post-tool-views";
import { clampPostListLimit, optionalPostListFields, matchesPostListFilters, projectPostListRow, toPostListRow, excerptCharsFor } from "./post-tool-list.js";
import { loadDeletablePost, assertFreshVersion } from "./post-tool-delete.js";

import type { PostToolDeps } from "./post-tool-deps.js";
import { buildPostHandlers } from "./tool-registrations.handlers.js";

export async function listPostToolPosts({ routeDeps, ctx }: { routeDeps: PostToolDeps; ctx: Parameters<ToolHandler>[0] }) {
  const input = requireInputRecord({ input: ctx.input });
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: routeDeps.contentReadPermission }, { entityType: "post" });

  const kind = input.kind === undefined ? undefined : requirePostKind(input);
  const limit = clampPostListLimit({ limit: optionalNumber({ input: input, key: "limit" }) });
  const includeBody = optionalBoolean({ input: input, key: "includeBody" }) === true;
  const query = optionalString({ input: input, key: "query" })?.toLowerCase();
  const status = optionalPostStatus(input);
  const fields = optionalPostListFields({ input });
  const { posts: allPosts } = await listAdminPosts(
    { deps: { repo: routeDeps.postRepo }, input: { workspaceId: routeDeps.workspaceId } },
    { kind: kind ?? "all" },
  );

  // The repository already loads the full workspace. Filter before the output cap so matches
  // beyond its first page remain reachable and total/hasMore describe the filtered inventory.
  const filteredPosts = allPosts.filter((post) => matchesPostListFilters(post, { query, status }));
  const total = filteredPosts.length;
  const posts = filteredPosts.slice(0, limit);
  return {
    posts: posts.map((post) => {
      if (fields !== undefined) return projectPostListRow({ row: toPostListRow({ routeDeps, post, excerptChars: excerptCharsFor({ rowCount: posts.length }) }), fields });
      return includeBody ? toPostToolViewWithPublicUrl({ deps: routeDeps.postToolViewDeps({ routeDeps }), post }) : toPostListRow({ routeDeps, post, excerptChars: excerptCharsFor({ rowCount: posts.length }) });
    }),
    total,
    hasMore: total > posts.length,
  };
}

function executePostToolCreate({ routeDeps, ctx, kind, title, slug, bodyJson, status, publishAt, featuredMediaId, author, showAuthor, postId }: {
  routeDeps: PostToolDeps; ctx: Parameters<ToolHandler>[0]; kind: ReturnType<typeof requirePostKind>; title: string; slug: string | undefined; bodyJson: JsonObject | undefined;
  status: ReturnType<typeof optionalPostStatus>; publishAt: ReturnType<typeof optionalPublishAt>; featuredMediaId: Awaited<ReturnType<typeof resolveFeaturedImageInput>>;
  author: ReturnType<typeof normalizePostAuthor> | undefined; showAuthor: ReturnType<typeof normalizeShowPostAuthor>; postId: string;
}) {
  return createPost({
    deps: {
      repo: routeDeps.postRepo,
      clock: routeDeps.clock,
      beforeSaveHook: routeDeps.pluginBeforeSaveHook,
      outbox: routeDeps.outbox,
      authorAccounts: routeDeps.userRepo,
      reservedSegments: routeDeps.reservedSegments,
    },
    input: {
      workspaceId: routeDeps.workspaceId,
      id: postId,
      title,
      kind,
      ...withoutUndefined({ source: { slug, bodyJson, status, publishAt, featuredMediaId, author, showAuthor } }),
      ...assistantPostAttribution({ principalId: ctx.principal.id }),
      analyticsSource: "assistant",
      // Recorded at write time so the agent-pause hold can tell this post from an owner-made one.
      creatorKind: "agent",
      // Every `tool-registrations.ts` handler is, by definition, reached only via
      // `@jini-ai/daemon`'s agent-run path (see `AGENT_TOOL_PRINCIPAL_KIND`'s own doc
      // in `@jini-ai/cms/core` — `ctx.principal.id` is already the real human's id here,
      // the same id a direct admin-UI edit would carry). Stamping delegatedBy* is what
      // makes an agent-run write distinguishable from a direct one in `post_revisions`,
      // since `actorId` alone is identical either way.
      delegatedByWorkspaceId: routeDeps.workspaceId,
      delegatedById: ctx.principal.id,
    },
  });
}

export async function createPostToolPost({ routeDeps, ctx }: { routeDeps: PostToolDeps; ctx: Parameters<ToolHandler>[0] }) {
  const input = requireInputRecord({ input: ctx.input });
  return withSchemaOnRejection({ toolId: "content_post_create", catalog: routeDeps.catalog, isShapeRejection: ({ error }) => isPostShapeRejection({ error }), fn: async () => {
    const kind = input.kind === undefined ? "post" : requirePostKind(input);
    const title = requireString({ input: input, key: "title" });
    const slug = optionalString({ input: input, key: "slug" });
    const bodyJson = input.bodyJson !== undefined ? requireBodyJson({ input, key: "bodyJson" }) : undefined;
    const status = optionalPostStatus(input);
    const author = input.author === undefined ? undefined : normalizePostAuthor({ author: input.author });
    const showAuthor = normalizeShowPostAuthor({ showAuthor: input.showAuthor });
    const publishAt = optionalPublishAt(input);
    const featuredMediaId = await resolveFeaturedImageInput(routeDeps, input);
    const postId = routeDeps.idGen.newId();

    ctx.signal.throwIfAborted();
    const { result } = await routeDeps.executeCommand<{ post: PostRecord }>({
      deps: postCommandDeps(routeDeps),
      command: {
        workspaceId: routeDeps.workspaceId,
        actor: { id: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND },
        summary: `Agent create ${kind} '${title}'`,
        permission: routeDeps.contentWritePermission,
      },
      mutation: {
        entityType: "post",
        entityId: postId,
        operation: "create",
        captureInverse: async () => null,
        execute: () =>
          executePostToolCreate({ routeDeps, ctx, kind, title, slug, bodyJson, status, publishAt, featuredMediaId, author, showAuthor, postId }),
        captureEntityVersion: ({ result }) => result.post.version,
        // A failed record must undo the create, including its revision and reserved slug.
        rollback: () => routeDeps.postRepo.hardDelete({ workspaceId: routeDeps.workspaceId, id: postId }),
      },
    });

    // Mirrors content_post_update's identical inline processOutbox call below — an agent
    // creating directly as `status: "published"` (the tool's own documented usage) now
    // enqueues `entry.published` (`createPost`'s `deps.outbox` doc); drained here so SEO's
    // sitemap-cache invalidation subscriber sees it without waiting for the serving process's
    // background drainer. On the BYOK path (serving process) this delivers at once; in the agent
    // daemon the outbox is enqueue-only, so this claims nothing and that drainer delivers instead
    // (`agent daemon outbox`).
    await routeDeps.processOutbox({ outbox: routeDeps.outbox, bus: routeDeps.bus, clock: routeDeps.clock });

    return { post: toPostWriteResultView({ deps: routeDeps.postToolViewDeps({ routeDeps }), post: result.post }), ...routeDeps.headerNavigationView({ kind }) };
  } });
}

async function restorePostToolDelete({ routeDeps, ctx, existing }: { routeDeps: PostToolDeps; ctx: Parameters<ToolHandler>[0]; existing: PostRecord }) {
  await restorePostForward({
    deps: {
      repo: routeDeps.postRepo,
      clock: routeDeps.clock,
      outbox: routeDeps.outbox,
      forgetRemoved: routeDeps.forgetRemovedPost,
    },
    input: {
      prior: existing,
      ...assistantPostAttribution({ principalId: ctx.principal.id }),
      // Same delegatedBy* attribution the forward write above records.
      delegatedByWorkspaceId: routeDeps.workspaceId,
      delegatedById: ctx.principal.id,
    },
  });
}

export async function deletePostToolPost({ routeDeps, ctx }: { routeDeps: PostToolDeps; ctx: Parameters<ToolHandler>[0] }) {
  const input = requireInputRecord({ input: ctx.input });
  const id = requireString({ input: input, key: "id" });
  const requestedKind = input.kind === undefined ? undefined : requirePostKind(input);

  // Gated exactly like content_post_get, and performed before opening anything so a caller with
  // no read access learns nothing and never causes a dialog to be raised.
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: ctx.principal.id, permission: routeDeps.contentReadPermission }, { entityType: "post", entityId: id });

  // Kind guard applied inside the loader rather than in `deletePost`, mirroring `pages/delete.ts`/
  // `pages/update.ts` — and carrying the same disclosed asymmetry the rest of this catalog has:
  // kind:'page' rejects an actual 'post' row, kind:'post' is not guarded the other way.
  // A trashed row is not-found too (post.ts's own rule), so a second delete cannot "succeed".
  const existing = await loadDeletablePost({ routeDeps, id }, { kind: requestedKind });
  const kind = requestedKind ?? existing.kind;

  // Keep the version check before the reversible removal.
  const current = await routeDeps.postRepo.findById({ workspaceId: routeDeps.workspaceId, id });
  assertFreshVersion({ current, existing, kind });

  ctx.signal.throwIfAborted();
  const { result } = await routeDeps.executeCommand<{ post: PostRecord }>({
    deps: postCommandDeps(routeDeps),
    command: {
      workspaceId: routeDeps.workspaceId,
      actor: { id: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND },
      // Attribute the reversible removal to the agent and the row read for this operation.
      summary: `Agent trash: Delete ${existing.kind} '${existing.title}' (${existing.slug})`,
      permission: routeDeps.contentWritePermission,
    },
    mutation: {
      entityType: "post",
      entityId: id,
      operation: "delete",
      captureInverse: async () => {
        // The whole inverse of a soft delete is "clear the marker" — see
        // `core/commands/appliers.ts`'s `postDeleteReverter`.
        return { deletedAt: null };
      },
      execute: () =>
        deletePost({
          deps: { repo: routeDeps.postRepo, clock: routeDeps.clock, outbox: routeDeps.outbox, remove: routeDeps.removePost },
          input: {
            workspaceId: routeDeps.workspaceId,
            id,
            ...assistantPostAttribution({ principalId: ctx.principal.id }),
            actorPluginId: routeDeps.assistantActorPluginId,
            // See content_post_create's identical delegatedBy* comment above.
            delegatedByWorkspaceId: routeDeps.workspaceId,
            delegatedById: ctx.principal.id,
          },
        }),
      captureEntityVersion: ({ result }) => result.post.version,
      // Restores the row read above: `existing` is the pre-image, and `rollback` only runs after
      // `execute` trashed it.
      rollback: async () => restorePostToolDelete({ routeDeps, ctx, existing }),
    },
  });

  // Drains deletePost's entry.unpublished event (published rows only) to SEO's sitemap-cache
  // invalidation subscriber — the same inline drain content_post_update and the routes perform.
  await routeDeps.processOutbox({ outbox: routeDeps.outbox, bus: routeDeps.bus, clock: routeDeps.clock });

  return { deleted: true, cancelled: false, post: toPostToolView({ post: result.post }) };
}

/**
 * Builds this domain's registrations.
 *
 * @param routeDeps - The same bag the admin routes are built from.
 * @param surfaces - Assistant-transport machinery `content_post_delete` needs to hold its call open
 * across the human's confirmation (ADR-055 Decision 2). Must be the SAME `SurfaceExchangeStore`
 * instance `registerMcpUiToolCallsRoute` was mounted with in production — `agent-daemon-server.ts`
 * builds one and passes it to both; a mismatched instance means the human's click reaches a store
 * nobody is waiting on, and the call times out instead of resolving. Required, matching every other
 * surface-raising domain's `build*Registrations(routeDeps, surfaces)` shape
 * (`assistant/tool-registrations.ts`'s `DomainSlice.build`) — there is no reduced-functionality
 * fallback for a missing store the way there is for a missing `ctx.emitSurface` per call (see the
 * handler below), because a domain with no store at all could never wire this tool's gate.
 */
export function buildPostRegistrations(routeDeps: PostToolDeps, surfaces: AssistantSurfaceDeps): ToolRegistration[] {
  const handlers = buildPostHandlers({ routeDeps });

  // No `unwiredToolIds`: Posts/Pages wires its ENTIRE catalog, same tripwire discipline as
  // Forms/Entries/Widgets — a 7th catalog entry added without a handler fails the build.
  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "post",
    catalogModule: "features/post/agent-tools.ts",
    catalog: routeDeps.catalog as ReadonlyMap<string, PostAgentToolDefinition>,
    // The whole map at once, so no handler can be the one that forgot — which is precisely what
    // happened here before: `toModelFacingUpdateError` was correct and wired into `content_post_update`
    // alone while its five siblings sent the same classes straight into the SEC-005 redactor.
    // Composes with the three handlers' inner `withSchemaOnRejection` rather than competing with it:
    // a shape rejection is already a `ToolInputError` by the time it arrives, and
    // `reclassifyToolError` returns those untouched. The inner `withPluginHookRefusals` turns a
    // plugin save-hook refusal into a fixed `PLUGIN_HOOK_FAILED` message naming the plugin before
    // the ladder sees it — that message needs the plugin id, which a fixed-message rule can't carry.
    handlers: withModelFacingErrors({ handlers: routeDeps.withPluginHookRefusals({ handlers }), rules: POST_MODEL_FACING_ERRORS }),
    derivedRisk: postDerivedRisk,
  });
}

// The composition root installs this contributor. Assistant site tools receive listPublishedPosts
// through structural, type-only ports: a feature-to-assistant registration value import would close
// a cycle against the site's post reader. Keep the published-post predicate with its domain owner;
// moving it into PostRepoPort would trade a correctness boundary for a dependency-graph shortcut.
export function contributePostTools(): ToolContributor<PostToolDeps, AssistantSurfaceDeps> {
  return { domain: "post", build: buildPostRegistrations, risk: postDerivedRisk };
}
