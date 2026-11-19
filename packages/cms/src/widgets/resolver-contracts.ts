import type { PluginExportsPort } from "./html/plugin-export.js";
import { createConsoleLogger, type JsonObject, type Logger, type UUID } from "@jini-ai/core/primitives";
import type { WidgetHostPorts, PostRepoPort, MediaContentTypeStorePort } from "./host-ports.js";
import type { MediaRepoPort, TransformDefinitionRepoPort } from "../media/index.js";
import type { TaxonomyListPort, TermListPort } from "../taxonomy/index.js";
import type { PageHtmlEmbedRef } from "./html/html-embeds.js";
import { type SiteTimeZonePort } from "./date-label.js";
import type { WidgetRenderIR, WidgetResolveContext } from "./types.js";
import type { ResolvePageWidgetsDeps } from "./page-widget-resolution.js";

/**
 * The narrower dependency slice widget-instance resolution alone needs — `resolveWidgetInstances`
 * and `resolveHtmlPageEmbeds` (below) never touch `bindingRepo` (that repo only backs region
 * placements, which an `"html"`-format Page has no concept of). `ResolvePageWidgetsDeps` remains a
 * structural supertype of this, so `resolvePageWidgets` passes its own full deps through unchanged.
 */
export type WidgetInstanceResolutionDeps = Pick<ResolvePageWidgetsDeps, "entryRepo" | "report">;

// ---------------------------------------------------------------------------
// HTML Page embeds (SPEC-047 Slice 2, registry-restructured 2026-08-07 per
// `generic-embed-contract`) — resolves `html-embeds.ts`'s `data-embed-type`
// placeholder convention. A parallel entry point to `resolvePageWidgets` above, not a mode of it: an
// `"html"`-format Page has no `bodyJson` tree and is not an `entries` row `pageEntryId` could
// resolve (see `routes/site/pages.ts`'s `resolveWidgetsForRender`, which documents that same gap for
// the TipTap inline-embed path on the live `home`/`post` routes) — its references live in a plain
// HTML string instead, so they need their own scan step, not a `bodyJson` walk. Everything
// downstream of "which ids are referenced" is shared with `resolvePageWidgets`
// (`resolveWidgetInstances`, `resolveWidgetType`, the REQ-27/28 failure taxonomy).
// ---------------------------------------------------------------------------

/**
 * One embed type's resolver: given every {@link PageHtmlEmbedRef} of that type found on the page,
 * resolve as many as possible into a map keyed by the referenced id. A ref whose `id` is `null`
 * (missing or out-of-bounds `id` key in the marker config) can never be resolved — a resolver skips it and should
 * log a resolver-internal miss (see `HTML_EMBED_RESOLVERS`'s own doc for why this is a DIFFERENT log
 * line from "unknown embed type"). The returned map's "present-with-placeholder-vs-absent" shape
 * (a genuinely nonexistent target is ABSENT; a found-but-broken target is PRESENT with a placeholder
 * IR) mirrors {@link resolveWidgetInstances}'s own convention — both render identically via
 * `render.ts`'s `renderHtmlPageBody`, so this is not a behavior bug, same as the pre-restructuring
 * `widgetResolved`/`formResolved` shape this replaces.
 */
/**
 * `resolveHtmlPageEmbeds`'s full dependency set — a structural superset of
 * {@link WidgetInstanceResolutionDeps} (the `widget` resolver's own narrower need) plus the
 * OPTIONAL `mediaRepo`/`transformRepo` pair the `media` resolver needs. Optional, not required
 * (mirrors `PagesHtmlDocumentStoreDeps.entryRefsRepo`'s own "optional dependency" precedent), so
 * every pre-existing widget-only call site and test keeps compiling and behaving unchanged; a
 * `media` embed present with no `mediaRepo`/`transformRepo` supplied simply cannot resolve (logged,
 * degrades to the REQ-28 placeholder like any other unresolved reference) rather than forcing every
 * call site that never touches media to thread media dependencies through anyway.
 */
export interface ResolveHtmlPageEmbedsDeps extends WidgetInstanceResolutionDeps {
  /** Optional host admission port. Absence keeps the plugin marker's authored fallback. */
  readonly pluginExports?: PluginExportsPort;
  readonly host: Pick<WidgetHostPorts, "media" | "posts">;
  readonly mediaRepo?: MediaRepoPort;
  readonly transformRepo?: TransformDefinitionRepoPort;
  readonly postRepo?: PostRepoPort;
  readonly taxonomyRepo?: TaxonomyListPort;
  readonly termRepo?: TermListPort;
  /**
   * Video/embed capability (2026-08-24) — optional, same "degrade gracefully when absent" contract
   * `mediaRepo`/`transformRepo` already have. When present, {@link resolveMediaTypeEmbeds} uses it
   * to tell a video asset from an image one (keyed by `MediaRecord.source.sha256`, the same key
   * the host app's `src/server/inbound/admin-http/routes/media/upload.ts` already records under). Absent (every pre-existing call site
   * before this feature, and any future one that never touches media) means every asset resolves as
   * an image exactly as it always has — this is additive, not a behavior change for images.
   */
  readonly mediaContentTypeStore?: MediaContentTypeStorePort;
  /**
   * The site's zone (Bug D, 2026-10-22). When present, every `"post-content"` IR carries it as
   * `props.timeZone` so the host renders the header's date label as the site's calendar day; absent
   * leaves the props exactly as before (the host then renders UTC).
   */
  readonly siteTimeZone?: SiteTimeZonePort;
  /**
   * Template-preview pending-body fix (2026-08-12) — an explicitly-passed, per-call override for
   * exactly one entity id's content, consulted ONLY by {@link resolveContentTypeEmbeds}. Lets
   * the host app's `src/server/inbound/admin-http/routes/posts/template-preview.ts` preview the operator's unsaved, in-editor `bodyJson`
   * through the real render pipeline: without this, the current entity's own `{"type":"content"}`
   * slot (`injectCurrentEntityContentId`) always re-fetches by id via {@link findPublishedPostById},
   * which returns the last-SAVED row and silently discards any in-memory override the caller built
   * (`ADS-memory/reports/implementation/2026-08-11-template-preview-render-bug.md` documents the
   * sibling `templateChoice`-only bug this closes the `bodyJson` half of).
   *
   * Deliberately per-call, never a shared/global/module-level cache — threaded fresh through this
   * `deps` object on every `resolveHtmlPageEmbeds` call, so two concurrent preview requests for
   * different posts (or the same post from two browser tabs) can never observe each other's pending
   * body. `undefined` for every pre-existing call site; behavior for those is byte-identical to
   * before this field existed.
   *
   * `title`/`slug`/`updatedAt` are carried alongside `bodyJson` because {@link resolveContentTypeEmbeds}'s
   * resolved `"post-content"` IR needs all four regardless of source — this is the same shape a real
   * `findPublishedPostById` result already provides, just supplied directly instead of fetched.
   */
  readonly pendingContentOverride?: {
    readonly id: UUID;
    readonly title: string;
    readonly slug: string;
    readonly updatedAt: string;
    /** The row's go-live time — the date line shows it over `updatedAt` (`postDisplayDateIso`). */
    readonly publishAt?: string | null;
    readonly bodyJson: JsonObject;
  };
}

export type HtmlEmbedResolver = (
  refs: readonly PageHtmlEmbedRef[],
  deps: ResolveHtmlPageEmbedsDeps,
  context: WidgetResolveContext
) => Promise<ReadonlyMap<string, WidgetRenderIR>>;

/** The warn sink for one render: the host's reporter, else the console under a `[widgets]` prefix. */
export function widgetReport({ context }: { context: Pick<WidgetResolveContext, "report"> }, _optional: Record<string, never> = {}): Pick<Logger, "warn"> {
  return context.report ?? createConsoleLogger({ prefix: "[widgets]" });
}
