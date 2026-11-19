import { createConsoleLogger } from "@jini-ai/core/primitives";
import type { PostRecord } from "./host-ports.js";
import type { PageHtmlEmbedRef } from "./html/html-embeds.js";
import type { WidgetRenderIR, WidgetResolveContext } from "./types.js";
import type { ResolveHtmlPageEmbedsDeps } from "./resolver-contracts.js";
import { resolvePostContentRenderContext } from "./post-content-context.js";
import { findPublishedPostByRef } from "./post-embed-resolution.js";

/** Whether the preview override stands in for `ref`: by id when the ref carries one, else by slug. */
function matchesPendingOverride(
  ref: Pick<PageHtmlEmbedRef, "id" | "slug">,
  override: NonNullable<ResolveHtmlPageEmbedsDeps["pendingContentOverride"]>,
): boolean {
  return ref.id !== null ? ref.id === override.id : ref.slug === override.slug;
}

/** The `"post-content"` IR for one post body source (a saved post or the preview override). */
async function postContentIr({ source, ref, deps, context }: {
  source: Pick<PostRecord, "title" | "slug" | "updatedAt" | "bodyJson"> & { readonly publishAt?: string | null | undefined };
  ref: PageHtmlEmbedRef;
  deps: ResolveHtmlPageEmbedsDeps;
  context: WidgetResolveContext;
}): Promise<WidgetRenderIR> {
  const renderContext = await resolvePostContentRenderContext(deps, source.bodyJson, context);
  return {
    componentId: "post-content",
    props: {
      title: source.title,
      slug: source.slug,
      updatedAt: source.updatedAt,
      publishAt: source.publishAt ?? null,
      bodyJson: source.bodyJson,
      header: ref.header,
      ...renderContext,
    },
  };
}

/** Resolves one `"content"` ref into `resolved` (keyed by its id, else slug), or logs why it stays unresolved. */
async function resolveOneContentEmbed({ ref, deps, context, resolved }: {
  ref: PageHtmlEmbedRef;
  deps: ResolveHtmlPageEmbedsDeps;
  context: WidgetResolveContext;
  resolved: Map<string, WidgetRenderIR>;
}): Promise<void> {
  const { postRepo, pendingContentOverride } = deps;
  const key = ref.id ?? ref.slug;
  if (key === null) {
    (context.report ?? createConsoleLogger({ prefix: "[widgets]" })).warn({ message: 'resolveHtmlPageEmbeds: unresolved "content" reference — missing or invalid "id"/"slug" in data-embed-config' }, { meta: { workspaceId: context.workspaceId } });
    return;
  }

  // Preview override, checked BEFORE any DB call (see `pendingContentOverride`'s own doc):
  // the operator's pending, unsaved body for this exact row, never a fetch. Matches by `id` when
  // the ref carries one (id authoritative, same order `findPublishedPostByRef` uses below), by
  // `slug` only for a slug-only ref. Routes through the identical `"post-content"` IR/props shape
  // the DB branch below builds, so this substitutes only the DATA SOURCE — every downstream
  // render/sanitization step (`render.ts`'s `renderWidgetPostContent` -> `renderDocNode`) is the
  // SAME code the saved-body path runs, never a second, parallel render path with its own
  // escaping rules.
  if (pendingContentOverride && matchesPendingOverride(ref, pendingContentOverride)) {
    resolved.set(key, await postContentIr({ source: pendingContentOverride, ref, deps, context }));
    return;
  }

  // No DB source for this ref (postRepo absent) and it didn't match the override above: nothing
  // safe to do but leave it unresolved — degrades to the REQ-28 placeholder like any other miss.
  if (!postRepo) return;

  const entity = await findPublishedPostByRef(postRepo, ref, context, deps.host);
  if (!entity) {
    (context.report ?? createConsoleLogger({ prefix: "[widgets]" })).warn({ message: 'resolveHtmlPageEmbeds: unresolved "content" reference — no such published entity' }, { meta: { workspaceId: context.workspaceId, entityId: key } });
    return;
  }
  if (entity.bodyFormat === "html") {
    (context.report ?? createConsoleLogger({ prefix: "[widgets]" })).warn({ message: 'resolveHtmlPageEmbeds: unresolved "content" reference — html-format entity reached the registry resolver instead of the recursive pre-splice pass (depth/budget guard, or a direct reference outside a template render)' }, { meta: { workspaceId: context.workspaceId, entityId: key } });
    return;
  }
  resolved.set(key, await postContentIr({ source: entity, ref, deps, context }));
}

/**
 * `data-embed-type="content"` resolver — the unified content marker's registry-owned half
 * (2026-08-11, `ADS-memory/reports/design/2026-08-11-unified-content-marker-and-templates.md`).
 * Handles `"doc"`-format targets ONLY: an `"html"`-format target's own body, and any FURTHER
 * `content` markers nested inside it, are fetched, recursively resolved, and spliced in BEFORE this
 * stage ever runs (`pages.ts`'s `resolveHtmlFormatContentMarkers` pre-pass, called ahead of
 * `resolveHtmlPageEmbeds` from the template render path) — by the time the shared marker scan reaches
 * this registry, an `html`-format reference has either already been consumed by that pre-pass or hit
 * its depth/budget guard (below). Either way there is nothing safe to do here but degrade to the
 * placeholder, same as any other unresolved reference: this resolver must never splice raw HTML
 * itself, which is exactly what would collapse guard 1's doc/html escaping split into one branchless
 * path (a TipTap doc renders through `renderDocNode`'s node-aware escaping; stored Page HTML is
 * spliced at the trust level `PagesHtmlDocumentStore`/`pages.edit_html` already assume for it — the
 * two must stay on separate code paths, never merged behind one generic "just render whatever this
 * is" function).
 *
 * Reuses the EXISTING `"post-content"` render IR (`renderWidgetPostContent` in `render.ts`) rather
 * than a new componentId: that function already renders ANY `{title, bodyJson, updatedAt}` bag
 * regardless of the source row's `kind` — nothing in it is Post-specific — so a `kind: "page"`
 * doc-format row (e.g. `our-story`) renders through the identical, already-vetted path a `kind:
 * "post"` row does. The `"post-content"` label itself is pre-existing and not renamed here (`render.ts`
 * is not in this change's file list); a follow-up rename to a kind-neutral label is low-priority tech
 * debt, disclosed rather than silently left unmentioned.
 *
 * Visibility-filtered via {@link findPublishedPostByRef} (guard 2, the highest-risk part of the
 * unified-marker design): an id OR slug supplied by an author, OR an id auto-filled by
 * `injectCurrentEntityContentId` for the entity the route already resolved (never a slug —
 * `injectCurrentEntityContentId` skips any marker already carrying a `slug`, its own doc explains
 * why), can in principle name ANY row — this is the one place in the new marker's resolution chain
 * that decides whether that row is allowed to reach the public page. The guard is on the ROW
 * {@link findPublishedPostByRef} returns, identical regardless of which key found it.
 *
 * `pendingContentOverride` (2026-08-12; slug matching added S3 2026-09-23) bypasses this specific
 * `findPublishedPostByRef` call, but NOT the visibility guard's intent: it only ever matches ONE
 * row — the exact one the host app's `src/server/inbound/admin-http/routes/posts/template-preview.ts` already fetched (any status, but
 * through its own `content.read`-authorized, session-gated lookup) and is previewing back to the
 * SAME authenticated operator who owns that unsaved edit. It matches by `id` when the ref carries
 * one (never falling through to `slug` for that same ref — the identical authoritative-when-present
 * order {@link findPublishedPostByRef} uses below), by `slug` only for a slug-only ref. It can never
 * be used to inject content for a DIFFERENT row than the one the caller resolved and authorized —
 * see the override's own doc on {@link ResolveHtmlPageEmbedsDeps.pendingContentOverride}.
 *
 * `ref.header` (2026-09-04, {@link PageHtmlEmbedRef.header}'s own doc) is threaded into IR
 * `props.header` unchanged in BOTH branches below — the DB lookup and the `pendingContentOverride`
 * short-circuit both read it off the SAME scanned `ref`. This value is only ever a STAGING default,
 * though, not what actually renders: `resolved` below is keyed by `ref.id`, one IR per id, so if the
 * same id is embedded twice with different `header` options the two `resolved.set` calls race and
 * one silently overwrites the other here — the `fc1a506a` bug (2026-09-05). `render.ts`'s
 * `renderHtmlPageBody`/`withOccurrenceHeader` is what actually makes this safe: it discards this
 * staged `header` and re-applies the CURRENT occurrence's own `ref.header` at substitution time,
 * where the real per-occurrence ref is available. See the `resolved` map's own comment immediately
 * below before adding another per-occurrence option here — the same collision reopens unless it
 * gets the same substitution-time treatment.
 *
 * @complexity O(e) over the `content` refs present (already capped upstream at
 * `MAX_HTML_EMBEDS_PER_PAGE`) — one `findPublishedPostById` call per ref not satisfied by
 * {@link ResolveHtmlPageEmbedsDeps.pendingContentOverride}, run concurrently via `Promise.all`,
 * mirroring every other resolver in this registry.
 */
export async function resolveContentTypeEmbeds(
  refs: readonly PageHtmlEmbedRef[],
  deps: ResolveHtmlPageEmbedsDeps,
  context: WidgetResolveContext
): Promise<ReadonlyMap<string, WidgetRenderIR>> {
  // Keyed by `ref.id`, ONE staged IR per id — not per occurrence. Any prop set here from
  // occurrence-specific data (e.g. `header` in `props` below) is only a default: if the same id is
  // embedded more than once on a page with different per-occurrence options, the concurrent
  // `resolved.set` calls below race and whichever ref wins decides that prop for every occurrence,
  // silently dropping the others' — the exact bug `fc1a506a` (2026-09-05) fixed for `header`.
  // Occurrence-specific options must be re-applied at SUBSTITUTION time instead, where the real
  // per-occurrence `ref` is available (`render.ts`'s `renderHtmlPageBody`/`withOccurrenceHeader` is
  // `header`'s own fix); staging one here is fine only as long as every consumer of this Map applies
  // that same override for its own option.
  const resolved = new Map<string, WidgetRenderIR>();
  const { postRepo, pendingContentOverride } = deps;
  if (!postRepo && !pendingContentOverride) {
    if (refs.length > 0) {
      (context.report ?? createConsoleLogger({ prefix: "[widgets]" })).warn({ message: 'resolveHtmlPageEmbeds: "content" embeds present but no postRepo dependency was supplied — every occurrence degrades to the placeholder' }, { meta: { workspaceId: context.workspaceId, occurrences: refs.length } });
    }
    return resolved;
  }

  await Promise.all(refs.map((ref) => resolveOneContentEmbed({ ref, deps, context, resolved })));

  return resolved;
}
