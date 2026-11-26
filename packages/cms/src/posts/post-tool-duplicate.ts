import { getAdminPostById } from "@jini-ai/cms/posts/post-read";
import { createPost } from "./post-create.js";
import { AGENT_TOOL_PRINCIPAL_KIND } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "@jini-ai/core";
import type { PostStatus } from "@jini-ai/cms/core";
import type { JsonObject } from "@jini-ai/core/primitives";
import type { DuplicateResourceHandlerContributor } from "@jini-ai/core/contracts/site/assistant-tool-contributions";
import { PostNotFoundError, PostValidationError, type PostRecord, type PublicPostRecord } from "@jini-ai/cms/posts/post";
import type { PostKind } from "@jini-ai/core/contracts/site/post-kind";
import { copyBodyJsonWithFreshEmbedPlacements } from "@jini-ai/cms/widgets";
import type { DeriveDuplicateName } from "@jini-ai/cms/forms";
import { assistantPostAttribution, postCommandDeps } from "./post-tool-policy.js";
import { toPostWriteResultView } from "@jini-ai/cms/posts/post-tool-views";
import type { PostToolDeps } from "./post-tool-deps.js";

/**
 * Derives `content_duplicate`'s default title for a post/page copy — see
 * `../content-duplication/derive-available-name.ts`'s header for the owner's numeric-suffix ruling
 * and the trailing-number rule. Only ever called when the caller supplied no explicit
 * `overrides.title` (see this function's one call site, guarded by `??`).
 *
 * Scoped to rows of the SAME `kind` as the source: a post and a page may legitimately share a title,
 * so a page named "About" must not be blocked by an unrelated post also named "About".
 *
 * @complexity One `postRepo.list()` scan (78 pages / 64 posts at current scale, read live
 * 2026-09-08 — see the shared module's own header for why this is an accepted O(n) scan rather than
 * a new port method), then {@link deriveDuplicateName}'s own bounded search.
 */
async function deriveDefaultDuplicateTitle(routeDeps: PostToolDeps, source: PostRecord, deriveDuplicateName: DeriveDuplicateName): Promise<string> {
  const existingTitles = new Set(
    (await routeDeps.postRepo.list({ workspaceId: routeDeps.workspaceId }))
      .filter((post) => post.kind === source.kind)
      .map((post) => post.title)
  );
  return deriveDuplicateName(
    { sourceName: source.title },
    { isTaken: async ({ candidate }, _optional = {}) => existingTitles.has(candidate) }
  );
}

/**
 * Shared implementation behind `content_duplicate`'s `"post"` and `"page"` resource contributors
 * (see {@link contributePostDuplicateHandlers} below).
 *
 * This used to be `content_post_duplicate`'s own bespoke tool handler
 * (`ADS-memory/reports/2026-09-07-page-duplicate-tool.md`) — the owner's follow-up correction
 * (`ADS-memory/reports/2026-09-07-page-tool-gap.md`'s cross-resource redesign: "one tool per verb,
 * generic over resource" rather than one `*_duplicate` tool per resource) folded it behind
 * `content_duplicate` instead. The logic itself — including the widgetEmbed placement regeneration
 * and the bespoke-HTML fail-loudly path — is UNCHANGED; only how a caller reaches it moved.
 *
 * `guardKind` plays the disclosed-asymmetry disambiguation role `kind` played on the old bespoke
 * tool, and plays it identically for the `"post"`/`"page"` resource ids `content_duplicate` exposes:
 * `"page"` guards a mismatched actual `kind:"post"` source as not-found; `"post"` does not guard the
 * other way (`agent-tools.ts`'s own header). It is NOT the created row's own kind — that is always
 * the SOURCE's real kind, since kind is immutable once created.
 *
 * @complexity O(n) in the copied body's size (one `copyBodyJsonWithFreshEmbedPlacements` walk) plus
 * O(1) repo/command-gateway calls.
 */
async function duplicatePostOrPage(
  { routeDeps, guardKind, input, deriveDuplicateName }: { routeDeps: PostToolDeps; deriveDuplicateName: DeriveDuplicateName; guardKind: PostKind; input: { principalId: string; id: string; overrides: { title?: string; slug?: string; status?: string } } },
  _optional: Record<string, never> = {}
): Promise<Record<string, unknown>> {
  const sourceId = input.id;

  // Upfront content.read check, mirroring content_post_delete's identical shape: gates LEARNING
  // anything about the source row (its title/bodyJson would otherwise leak to a caller with no read
  // access, since this read happens before executeCommand's own content.write gate below ever
  // runs). `content_duplicate`'s own handler ALSO checks this resource's declared permission
  // (content.write) before calling here at all — see `contributePostDuplicateHandlers` below — so
  // this is a second, narrower gate on top of that outer one, not a replacement for it.
  await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: routeDeps.authorize }), workspaceId: routeDeps.workspaceId, principalId: input.principalId, permission: routeDeps.contentReadPermission }, { entityType: "post", entityId: sourceId });

  const { post: source } = await getAdminPostById({
    deps: { repo: routeDeps.postRepo },
    input: { workspaceId: routeDeps.workspaceId, id: sourceId },
  });
  // Disclosed asymmetry (agent-tools.ts's own header, mirrored verbatim from content_post_get):
  // guardKind "page" guards a mismatched actual kind:"post" row as not-found; "post" does not guard
  // the other way.
  if (guardKind === "page" && source.kind !== "page") {
    throw new PostNotFoundError(`page '${sourceId}' was not found`);
  }

  const overrideStatus = input.overrides.status;
  if (overrideStatus !== undefined && overrideStatus !== "draft" && overrideStatus !== "published") {
    throw new PostValidationError("status must be 'draft' or 'published'");
  }

  const title = input.overrides.title ?? (await deriveDefaultDuplicateTitle(routeDeps, source, deriveDuplicateName));
  const slug = input.overrides.slug;
  const status: PostStatus = overrideStatus ?? "draft";

  const { sourceHtml, bodyJsonForCreate } = await readDuplicateBody(routeDeps, source, sourceId);

  const newId = routeDeps.idGen.newId();

  const { result } = await routeDeps.executeCommand<{ post: PostRecord }>({
    deps: postCommandDeps(routeDeps),
    command: {
      workspaceId: routeDeps.workspaceId,
      actor: { id: input.principalId, kind: AGENT_TOOL_PRINCIPAL_KIND },
      summary: `Agent duplicate ${source.kind} '${source.title}' as '${title}'`,
      permission: routeDeps.contentWritePermission,
    },
    mutation: {
      entityType: "post",
      entityId: newId,
      operation: "create",
      captureInverse: async () => null,
      execute: () => routeDeps.postRepo.transaction({ fn: async () => {
        return createDuplicatePost(routeDeps, { source, newId, title, slug, status, bodyJsonForCreate, sourceHtml, input });
      } }),
      captureEntityVersion: ({ result }) => result.post.version,
    },
  });

  const finalPost = result.post;

  // Mirrors content_post_create's identical inline processOutbox call — only fires an event when
  // this copy was itself created directly as `status: "published"` (the default is "draft", so the
  // common case enqueues nothing).
  await routeDeps.processOutbox({ outbox: routeDeps.outbox, bus: routeDeps.bus, clock: routeDeps.clock });

  return { post: toPostWriteResultView({ deps: routeDeps.postToolViewDeps({ routeDeps }), post: finalPost }) };
}

async function createDuplicatePost(routeDeps: PostToolDeps, { source, newId, title, slug, status, bodyJsonForCreate, sourceHtml, input }: {
  source: PublicPostRecord; newId: string; title: string; slug: string | undefined; status: PostStatus;
  bodyJsonForCreate: JsonObject | undefined; sourceHtml: string | undefined;
  input: Parameters<typeof duplicatePostOrPage>[0]["input"];
}) {
  const created = await createPost({
    deps: {
      repo: routeDeps.postRepo,
      reservedSegments: routeDeps.reservedSegments,
      clock: routeDeps.clock,
      beforeSaveHook: routeDeps.pluginBeforeSaveHook,
      outbox: routeDeps.outbox,
    },
    // kind is the SOURCE's real kind (see this function's own doc), never the caller's
    // disambiguation input. bodyJson is omitted (undefined) on the HTML branch — the new row
    // is born as an ordinary empty "doc" row and converted by ensureHtmlFormat below, exactly
    // like pages_write_html's own first-write sequence.
    input: {
      workspaceId: routeDeps.workspaceId,
      id: newId,
      title,
      kind: source.kind,
      ...(slug === undefined ? {} : { slug }),
      ...(bodyJsonForCreate === undefined ? {} : { bodyJson: bodyJsonForCreate }),
      status,
      author: source.author ?? null,
      showAuthor: source.showAuthor ?? false,
      ...assistantPostAttribution({ principalId: input.principalId }),
      analyticsSource: "assistant",
      // Agent tool path: see content_post_create's identical `creatorKind` note.
      creatorKind: "agent",
      // See content_post_create's identical delegatedBy* comment above.
      delegatedByWorkspaceId: routeDeps.workspaceId,
      delegatedById: input.principalId,
    },
  });
  if (sourceHtml === undefined) return created;
  // Conversion belongs to the copy's transaction: a refused conversion must not leave a
  // created row/revision behind or reach executeCommand's change-set recording step.
  // Seeds the new row's HTML body — mirrors pages_write_html's own `ensureHtmlFormat` step.
  // `created.post` is stale after this (still "doc" format, version 1); re-read to return the
  // row's real, post-conversion state.
  if (!routeDeps.pagesHtmlStore) throw new Error("Post duplication has no HTML page store");
  await routeDeps.pagesHtmlStore({ workspaceId: routeDeps.workspaceId, postId: newId }).ensureHtmlFormat({ seedHtml: sourceHtml });
  return getAdminPostById({ deps: { repo: routeDeps.postRepo }, input: { workspaceId: routeDeps.workspaceId, id: newId } });
}

async function readDuplicateBody(routeDeps: PostToolDeps, source: PostRecord, sourceId: string) {
  // Resolved BEFORE the new row is created, not after: an HTML page whose body genuinely cannot be
  // copied must fail loudly with NOTHING written — never an orphaned draft row left behind for the
  // operator to notice and clean up (see agent-tools.ts's own tool doc, and
  // features/content-duplication/agent-tools.ts's `content_duplicate` catalog entry).
  let sourceHtml: string | undefined;
  let bodyJsonForCreate: JsonObject | undefined;
  if (source.bodyFormat === "html") {
    if (!routeDeps.pagesHtmlStore) {
      throw new Error(
        `content_duplicate: '${sourceId}' is a bespoke-HTML page, and this workspace has no HTML-body ` +
          "store wired for duplication. Nothing was copied — its content is never silently dropped."
      );
    }
    sourceHtml = await routeDeps.pagesHtmlStore({ workspaceId: routeDeps.workspaceId, postId: sourceId }).read();
  } else {
    // The one piece of real design work this tool exists for — see the header of
    // `@jini-ai/cms/widgets`' duplicate-embeds module for why widgetEntryId is kept and placementId
    // is regenerated, never the reverse. Known, separate discrepancy (noted, not fixed here):
    // `agent-tools.ts`'s published `TIPTAP_DOC_SCHEMA` documents a widgetEmbed's `attrs` as carrying
    // only `placementId`, while the real node the embed write path reads and writes carries BOTH
    // `placementId` and `widgetEntryId`. That schema is model-facing documentation, not a runtime
    // validator, and this tool never authors a `bodyJson` from scratch: it only copies one this
    // codebase already wrote.
    bodyJsonForCreate = copyBodyJsonWithFreshEmbedPlacements({ bodyJson: source.bodyJson, newPlacementId: () => routeDeps.idGen.newId() });
  }

  return { sourceHtml, bodyJsonForCreate };
}

/**
 * `content_duplicate`'s resource contributors for `"post"` and `"page"` — see
 * `assistant/duplicate-resource-registry.ts` for the contract each entry satisfies. Both resolve to
 * `content.write`, the SAME permission `content_post_create`/`content_post_update` already declare
 * in this domain's own catalog (`agent-tools.ts`) — no new permission invented for the generic tool,
 * per the owner's explicit instruction to resolve each resource's permission from what it already
 * declares.
 *
 * Called from the composition root (`server/runtime/composition/tool-catalog-manifest.ts`'s
 * `installFirstPartyToolContributors`), NOT from within this domain — see
 * `duplicate-resource-registry.ts`'s own header for why a `features/post -> assistant` VALUE edge to
 * call `registerDuplicateResourceHandler` directly from here would reopen the exact module cycle
 * this domain's own `contributePostTools` history already fought to close. This function only
 * returns data; it imports the registry's TYPE, never its register function.
 */
export function contributePostDuplicateHandlers({ deriveDuplicateName }: { deriveDuplicateName: DeriveDuplicateName }, _optional = {}): DuplicateResourceHandlerContributor<PostToolDeps>[] {
  return [
    {
      resource: "post",
      build: (routeDeps, _optional = {}) => ({
        permission: routeDeps.contentWritePermission,
        duplicate: (input, _optional = {}) => duplicatePostOrPage({ routeDeps, guardKind: "post", input, deriveDuplicateName }),
      }),
    },
    {
      resource: "page",
      build: (routeDeps, _optional = {}) => ({
        permission: routeDeps.contentWritePermission,
        duplicate: (input, _optional = {}) => duplicatePostOrPage({ routeDeps, guardKind: "page", input, deriveDuplicateName }),
      }),
    },
  ];
}
