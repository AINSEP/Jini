import { widgetReport } from "./resolver-contracts.js";
import type { WidgetHostPorts, PostRecord, PostRepoPort } from "./host-ports.js";
import type { PageHtmlEmbedRef } from "./html/html-embeds.js";
import type { WidgetRenderIR, WidgetResolveContext } from "./types.js";
import type { ResolveHtmlPageEmbedsDeps } from "./resolver-contracts.js";
import { resolvePostContentRenderContext } from "./post-content-context.js";

/**
 * Resolves a post/page row by whichever key a {@link PageHtmlEmbedRef} carries — `id` authoritative
 * when present, `slug` consulted only for a ref with no `id` at all. Same order
 * {@link resolveWidgetTypeEmbeds}'s slug fallback and `resolveMediaTypeEmbeds`'s `parseMediaEmbedRef`
 * already use for `widget`/`media` markers (S3, 2026-09-23 widget-attrs plan — `post`/`content` gain
 * the identical treatment those two got in 2026-08-31/2026-09-16, deliberately deferred until now;
 * see the retired paragraph this replaces in git history for why it was left out of those passes).
 * `posts.slug` is unique per workspace (`posts_workspace_slug_unique`), so — like the widget/media
 * cases — there is no "more than one match" branch to hedge against.
 *
 * Shared by {@link resolvePostTypeEmbeds} and {@link resolveContentTypeEmbeds} so both go through the
 * ONE id-else-slug lookup, via the identical visibility guard ({@link findPublishedPostById}/
 * {@link findPublishedPostBySlug}), rather than two copies that could drift apart.
 *
 * Non-throwing: `null` means "not found or not visible" — the same
 * REQ-27 degrade-to-placeholder contract every resolver in this registry follows.
 *
 * @complexity O(1) — one guarded repo lookup (by id or by slug, never both), no iteration.
 */
export async function findPublishedPostByRef(
  postRepo: PostRepoPort,
  ref: Pick<PageHtmlEmbedRef, "id" | "slug">,
  context: WidgetResolveContext,
  host: Pick<WidgetHostPorts, "posts">
): Promise<PostRecord | null> {
  if (ref.id !== null) {
    return host.posts.findPublishedPostById({ deps: { repo: postRepo }, input: { workspaceId: context.workspaceId, id: ref.id } });
  }
  // `slug` is non-null here: both callers (`resolvePostTypeEmbeds`, `resolveOneContentEmbed`) return
  // before calling this when `ref.id ?? ref.slug` is null, so an id-less ref always carries a slug.
  return host.posts.findPublishedPostBySlug({ deps: { repo: postRepo }, input: { workspaceId: context.workspaceId, slug: ref.slug! } });
}

/**
 * `data-embed-type="post"` resolver — the post-template-picker feature (post-template.md's own
 * design conversation, first shipped 2026-08-10). `data-embed-id`/`data-embed-slug` name the post's
 * stored id or its unique slug, resolved by {@link findPublishedPostByRef} immediately above (id
 * authoritative when both are present).
 *
 * Returns RAW post data (title/bodyJson/updatedAt/slug), not rendered HTML — this file (`widgets/`)
 * must not depend on the host app's `src/server/inbound/public-http/http/site/render.ts` (that module sits above this one in the codebase's
 * layering, the same constraint `resolveMediaTypeEmbeds`'s own doc discloses for why it returns
 * `{assetId, transformName, ...}` instead of an `<img>` string). `render.ts`'s `renderWidgetIr`
 * `"post-content"` case (which already has `renderDocNode` in scope) does the actual TipTap-to-HTML
 * render from this data.
 *
 * A caller with no `postRepo` supplied (every pre-existing call site) behaves exactly like a `media`
 * embed with no `mediaRepo` — every occurrence degrades to the placeholder, logged once, not silently.
 *
 * **Visibility fix, 2026-08-11**: was `postRepo.findById` directly — `PostRepoPort.findById` is
 * trash- and status-BLIND by design (`post.ts`'s own doc on that port), so this resolver could
 * previously pull ANY row by id, including an unpublished draft or a trashed one, onto the public
 * site. That hole predates and is independent of this date's `content`-marker work, but is fixed
 * here alongside it (same file, same class of hazard, same fix already being built for
 * {@link resolveContentTypeEmbeds}'s guard) rather than left live next to a freshly-hardened sibling
 * resolver. See {@link findPublishedPostById}'s own doc for why this differs from the raw port call.
 */
export async function resolvePostTypeEmbeds(
  refs: readonly PageHtmlEmbedRef[],
  deps: ResolveHtmlPageEmbedsDeps,
  context: WidgetResolveContext
): Promise<ReadonlyMap<string, WidgetRenderIR>> {
  const resolved = new Map<string, WidgetRenderIR>();
  const { postRepo } = deps;
  if (!postRepo) {
    if (refs.length > 0) {
      widgetReport({ context }).warn({ message: 'resolveHtmlPageEmbeds: "post" embeds present but no postRepo dependency was supplied — every occurrence degrades to the placeholder' }, { meta: { workspaceId: context.workspaceId, occurrences: refs.length } });
    }
    return resolved;
  }

  await Promise.all(
    refs.map(async (ref) => {
      const key = ref.id ?? ref.slug;
      if (key === null) {
        widgetReport({ context }).warn({ message: 'resolveHtmlPageEmbeds: unresolved "post" reference — missing or invalid "id"/"slug" in data-embed-config' }, { meta: { workspaceId: context.workspaceId } });
        return;
      }
      const post = await findPublishedPostByRef(postRepo, ref, context, deps.host);
      if (!post) {
        widgetReport({ context }).warn({ message: 'resolveHtmlPageEmbeds: unresolved "post" reference — no such published post' }, { meta: { workspaceId: context.workspaceId, postId: key } });
        return;
      }
      const renderContext = await resolvePostContentRenderContext(deps, post.bodyJson, context);
      resolved.set(key, {
        componentId: "post-content",
        props: { title: post.title, slug: post.slug, updatedAt: post.updatedAt, publishAt: post.publishAt ?? null, bodyJson: post.bodyJson, ...renderContext },
      });
    })
  );

  return resolved;
}
