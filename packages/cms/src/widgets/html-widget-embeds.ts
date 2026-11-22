import { widgetReport } from "./resolver-contracts.js";
import { isNonArrayRecord } from "@jini-ai/core";
import type { JsonObject, UUID } from "@jini-ai/core/primitives";
import type { PageHtmlEmbedRef } from "./html/html-embeds.js";
import { resolveWidgetType } from "./resolvers/index.js";
import { WIDGET_CONTENT_TYPE } from "./types.js";
import type { WidgetRenderIR, WidgetResolveContext, WidgetResolveResult } from "./types.js";
import type { ResolveHtmlPageEmbedsDeps } from "./resolver-contracts.js";
import { toRenderIr, resolveWidgetInstances } from "./widget-instance-resolution.js";

/**
 * Resolves every DISTINCT `slug` among `refs` (id-less refs only — {@link resolveWidgetTypeEmbeds}
 * never consults `slug` when `id` is present, see that function's own doc) to its widget entry's real
 * id, via one {@link EntryRepoPort.findBySlug} call per distinct slug, run concurrently
 * (`Promise.all`) — mirrors `resolveMediaTypeEmbeds`'s own per-ref fan-out for a lookup this port has
 * no batch primitive for. A slug with no matching widget warns and is simply absent from the returned
 * map — {@link resolveWidgetTypeEmbeds} degrades that exactly like a nonexistent `id` (REQ-27/28's
 * never-throws, degrade-to-placeholder discipline, unchanged for this new lookup path).
 *
 * `entries_workspace_type_slug_unique` (`workspaceId, type, slug`) makes "more than one match"
 * structurally impossible — unlike the dormant `name` fallback's own design, which had to hedge
 * against ambiguity because nothing backed it with a real unique index. That is why this function has
 * no "zero or >1 matches -> placeholder" branch: zero is the only failure shape a `findBySlug` call
 * against a UNIQUE-constrained column can produce.
 *
 * @complexity O(s) over the distinct slugs present, one `findBySlug` call each, run concurrently.
 */
async function resolveWidgetSlugsToIds(
  slugRefs: readonly PageHtmlEmbedRef[],
  deps: ResolveHtmlPageEmbedsDeps,
  context: WidgetResolveContext
): Promise<ReadonlyMap<string, UUID>> {
  const distinctSlugs = new Set(slugRefs.map((ref) => ref.slug as string));
  const idBySlug = new Map<string, UUID>();

  await Promise.all(
    Array.from(distinctSlugs).map(async (slug) => {
      const entry = await deps.entryRepo.findBySlug({ workspaceId: context.workspaceId, type: WIDGET_CONTENT_TYPE, slug });
      if (!entry) {
        widgetReport({ context }).warn({ message: 'resolveHtmlPageEmbeds: unresolved "widget" reference — no widget with that slug' }, { meta: { workspaceId: context.workspaceId, slug } });
        return;
      }
      idBySlug.set(slug, entry.id);
    })
  );

  return idBySlug;
}

/** `data-embed-type="widget"` batches through the same {@link resolveWidgetInstances}
 * `resolvePageWidgets` uses — any widget type, any placement context; no widget-embed-specific
 * resolver logic exists or is needed beyond this thin adapter (plus, as of 2026-08-31, the `slug`
 * lookup {@link resolveWidgetSlugsToIds} performs). Behavior for an `id`-carrying ref is carried over
 * unchanged from the pre-restructuring `resolveHtmlPageEmbeds` widget path.
 *
 * **`id` is authoritative when present; `slug` is consulted only for a ref with no `id` at all** —
 * matches `html-embeds.ts`'s own doc on the two keys. A ref's `slug` is resolved to a real entry id
 * FIRST, then folded into the SAME `ids` set the id-carrying refs already populate, so id- and
 * slug-addressed widgets share {@link resolveWidgetInstances}'s one batched `listByWorkspace` query
 * (REQ-24) rather than paying for a second one. The returned map is keyed by whatever the MARKER
 * itself carried (`ref.id` for an id-based ref, `ref.slug` for a slug-based one) — never by the
 * resolved id a slug-based ref never had in its own markup — because `render.ts`'s
 * `renderHtmlPageBody` looks results up using that same marker-authored key (`ref.id ?? ref.slug`);
 * see that function's own doc.
 *
 * @complexity O(r) over `refs`, plus {@link resolveWidgetSlugsToIds}'s own O(s) slug-lookup cost, plus
 * {@link resolveWidgetInstances}'s one batched query and at most one `resolveWidgetType` call per
 * distinct widget type present (REQ-24) — unchanged from before this function gained `slug` support.
 */
/** Every id {@link resolveWidgetInstances} must batch-load for `refs` — an id-carrying ref's own
 * `id` directly, plus every slug-carrying ref's resolved id (`idBySlug`) folded into the SAME set,
 * so id- and slug-addressed widgets share one batched query (REQ-24). Warns once per ref carrying
 * neither a usable `id` nor `slug` at all. Split out of {@link resolveWidgetTypeEmbeds} to keep that
 * function's own complexity low (Programmer workflow 5a3) — this loop is pure bookkeeping, not a
 * second decision. */
function collectWidgetIdsToLoad(
  refs: readonly PageHtmlEmbedRef[],
  idBySlug: ReadonlyMap<string, UUID>,
  context: WidgetResolveContext
): Set<UUID> {
  const ids = new Set<UUID>();
  for (const ref of refs) {
    if (ref.id !== null) {
      ids.add(ref.id);
    } else if (ref.slug === null) {
      widgetReport({ context }).warn({ message: 'resolveHtmlPageEmbeds: unresolved "widget" reference — missing or invalid "id"/"slug" in data-embed-config' }, { meta: { workspaceId: context.workspaceId } });
    } else {
      // Slug-addressed references are added from the shared batched lookup below.
    }
  }
  for (const id of idBySlug.values()) ids.add(id);
  return ids;
}

/** Builds the final result, keyed by whatever the MARKER itself carried (`ref.id` for an id-based
 * ref, `ref.slug` for a slug-based one — never the resolved id a slug-based ref never had in its own
 * markup, see {@link resolveWidgetTypeEmbeds}'s own doc for why). `resolvedRaw` only carries an entry
 * for an id that named a REAL, non-trashed widget row (`resolveWidgetInstances`'s own doc) — a
 * nonexistent id/slug must stay ABSENT from the result, never present-with-placeholder, preserving
 * this file's present-vs-absent convention (`resolveHtmlPageEmbeds`'s own doc) unchanged from before
 * `slug` support existed. Split out of {@link resolveWidgetTypeEmbeds} for the same complexity reason
 * as {@link collectWidgetIdsToLoad}. */
function buildResolvedWidgetMap(
  refs: readonly PageHtmlEmbedRef[],
  idBySlug: ReadonlyMap<string, UUID>,
  resolvedRaw: ReadonlyMap<UUID, WidgetResolveResult>
): Map<string, WidgetRenderIR> {
  const resolved = new Map<string, WidgetRenderIR>();
  for (const ref of refs) {
    const resolvedId = ref.id ?? (ref.slug !== null ? idBySlug.get(ref.slug) : undefined);
    const lookupKey = ref.id ?? ref.slug;
    if (resolvedId !== undefined && lookupKey !== null && resolvedRaw.has(resolvedId)) {
      resolved.set(lookupKey, toRenderIr(resolvedRaw.get(resolvedId)));
    }
  }
  return resolved;
}

export async function resolveWidgetTypeEmbeds(
  refs: readonly PageHtmlEmbedRef[],
  deps: ResolveHtmlPageEmbedsDeps,
  context: WidgetResolveContext
): Promise<ReadonlyMap<string, WidgetRenderIR>> {
  const slugRefs = refs.filter((ref) => ref.id === null && ref.slug !== null);
  const idBySlug = await resolveWidgetSlugsToIds(slugRefs, deps, context);
  const ids = collectWidgetIdsToLoad(refs, idBySlug, context);
  const overrides = refs.flatMap(ref => {
    const content = ref.config?.content;
    const widgetEntryId = ref.id ?? (ref.slug ? idBySlug.get(ref.slug) : undefined);
    return widgetEntryId && ref.placementKey && isNonArrayRecord({ value: content })
      ? [{ key: ref.placementKey, widgetEntryId, content: content as JsonObject }] : [];
  });
  const originalIds = new Set(refs.filter(ref => !ref.placementKey).flatMap(ref => {
    const id = ref.id ?? (ref.slug ? idBySlug.get(ref.slug) : undefined);
    return id ? [id] : [];
  }));
  const resolvedRaw = await resolveWidgetInstances(deps, context.workspaceId, ids, context, overrides, originalIds);
  const resolved = buildResolvedWidgetMap(refs, idBySlug, resolvedRaw);
  for (const override of overrides) if (resolvedRaw.has(override.key)) resolved.set(override.key, toRenderIr(resolvedRaw.get(override.key)));
  return resolved;
}

/** A form slug/id is a synthetic contact-form instance, resolved through the widget pipeline. */
export async function resolveFormTypeEmbeds(
  refs: readonly PageHtmlEmbedRef[],
  _deps: ResolveHtmlPageEmbedsDeps,
  context: WidgetResolveContext,
): Promise<ReadonlyMap<string, WidgetRenderIR>> {
  const keys = [...new Set(refs.map((ref) => ref.id ?? ref.slug).filter((key): key is string => key !== null))];
  const results = await resolveWidgetType({
    typeKey: "contact-form",
    context,
    instances: keys.map((id) => ({ id, widgetType: "contact-form", config: { formDefinitionRef: id } })),
  });
  return new Map(keys.map((key) => [key, toRenderIr(results.get(key))]));
}
