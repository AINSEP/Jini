/**
 * @file The embed-reference view of a `"html"`-format Page's body (SPEC-047 Slice 2, generalized
 * 2026-08-07 per `project-tovu-generic-embed-contract`, rewired onto the shared marker parser
 * 2026-08-10).
 *
 * Purpose:
 * A TipTap `widgetEmbed` node has a structured home (`bodyJson`) to carry a `{placementId,
 * widgetEntryId}` attrs object. A Page's body is a free-form HTML string with no such tree, so an
 * embed there has to be a literal markup convention instead:
 * `<div data-embed-config='{"type":"widget","id":"{widgetEntryId}"}'></div>` (or `"type":"media"`,
 * `"post"`, or any future type token), anywhere in the page's `body_html`.
 *
 * **This file no longer owns a pattern.** Locating and parsing a marker is `core/embeds/marker.ts`'s
 * single job; this module is only the adapter that projects a parsed marker into the
 * {@link PageHtmlEmbedRef} shape `resolver-service.ts` resolves against. Before the 2026-08-10
 * unification there were four regexes for one concept — this one, `static-render.ts`'s,
 * `entry-refs/extractor.ts`'s deliberate second copy, and the theme-slot pair — and they had already
 * drifted: this one required an EMPTY `<div></div>`, while the theme path deliberately matched a
 * marker WITH authored fallback content inside it. Sharing the parser is what makes "what render.ts
 * embeds" and "what entry_refs indexes" incapable of disagreeing, rather than merely tested for
 * agreement after the fact.
 *
 * **Why `type` is a free string, not a closed union.** A closed union would mean this file's own
 * type signature has to change every time a new embed type is added — exactly the coupling the
 * generic contract exists to remove. Adding a fourth type is a new resolver registration
 * (`resolver-service.ts`'s `HTML_EMBED_RESOLVERS`), never a scanner change. Unknown types flow
 * through untouched; "is this type known" is a resolution-time question, never a scan-time one.
 *
 * **Inner content is now allowed, and that is a widening.** The old empty-div requirement meant any
 * content inside a placeholder kept it from matching at all — it rendered verbatim and inert. The
 * shared parser captures inner content instead, because a theme marker's authored content is a real
 * fallback that must survive when nothing resolves. For most types the consequence is that
 * {@link substituteHtmlEmbeds} replaces the WHOLE element, fallback content included, exactly as it
 * already replaced the whole empty div: an html Page's embed placeholder is scaffolding for the
 * resolved widget, not a nav that must survive a failed lookup. Unresolved still degrades to the
 * REQ-28 placeholder via the caller's own `resolve`, never to a crash and never to raw marker markup
 * reaching a visitor.
 *
 * **`"media"`, `"post"`, and `"content"` are wrapper-preserving.** An author who wraps one of these
 * markers in their own element — `<div style="max-width:600px"
 * data-embed-config='{"type":"media","id":"..."}'></div>`, or `<main class="page-body"
 * data-embed-config='{"type":"content","id":"..."}'></main>` — expects that element and its own
 * attributes (style, class, id, aria-*) to survive; only the marker's CONTENT should become the
 * resolved markup. See {@link WRAPPER_PRESERVING_EMBED_TYPES}'s own doc for the per-type reasoning,
 * and {@link substituteHtmlEmbeds}'s own doc for the one tag-nesting exception `"media"` alone needs.
 *
 * **`"widget"` (and any other type this stage resolves) keeps its element ONLY if the author gave it
 * attributes (2026-09-16, direct owner ask: "regular attributes that somebody puts on a
 * data-embed-config should work on the rendered tag").** A BARE `<div
 * data-embed-config='{"type":"widget","id":"w1"}'></div>` is still whole-element replaced,
 * byte-identical to before — `"widget"`'s resolved root tag is not a small, closed set (see
 * {@link WRAPPER_PRESERVING_EMBED_TYPES}'s own doc for why it still cannot unconditionally join the
 * wrapper-preserving group), but an author who wrote `<div style="max-width:600px"
 * data-embed-config='{"type":"widget","id":"w1"}'></div>` plainly wants that `style` to survive.
 * {@link withElementKeptIfAttributed} is the shared primitive for this rule.
 *
 * **`"media"`'s own attributes (2026-09-16) are partitioned, not simply kept-or-dropped.** See
 * {@link MEDIA_ELEMENT_ATTRIBUTE_NAMES} and {@link substituteHtmlEmbeds}'s own doc.
 *
 * **Why attribute VALUES are not re-validated here for injection safety.** A Page's `body_html` is
 * already unescaped, trusted-ish markup by the time it reaches this module (see
 * `update-html.ts`'s own disclosure) — nothing this file does widens that trust boundary. The one
 * thing this module owns defensively is bounding how much work an adversarial/oversized page can
 * demand at render/index time (`MAX_HTML_EMBEDS_PER_PAGE`) and never using a captured id for
 * anything other than a map/repo lookup key (never re-emitted into HTML unescaped, never
 * interpolated into a query) — see `resolver-service.ts`'s `resolveHtmlPageEmbeds` and
 * `extractor.ts`'s html-ref collector, both of which only ever use the id that way.
 *
 * **`slug`, an author-memorable alternative to `id` (2026-08-31).** The owner's own complaint —
 * `{"type":"widget","id":"29721c44-a811-444f-b7b5-e61a9918a3a9"}` is not something a person can
 * type from memory — is real, and this is the fix: `{"type":"widget","slug":"contact-form"}`.
 * `slug` is projected here exactly like `name`/`variant` already are (a raw, unvalidated config
 * key; deciding whether it is USABLE is a resolver-side concern), but it is a genuinely different
 * mechanism from the dormant `name` field above, not a rename of it. `name` was scaffolded
 * (2026-08-05/07 generic-embed-contract design, `project-tovu-generic-embed-contract` in
 * `ADS-memory/`) for a fuzzy, POSSIBLY-AMBIGUOUS match — "exactly one match resolves; zero or >1
 * degrades to the placeholder, never a guess" — and no resolver in this codebase has ever
 * implemented that ambiguity guard. `slug` needs no such guard: it targets a column
 * (`entries.slug`) carrying a real database `UNIQUE(workspace_id, type, slug)` index, so "more than
 * one match" cannot occur by construction, not merely by convention. Reusing `name`'s never-shipped,
 * ambiguity-hedged semantics for a value that is unique by database constraint would be modeling a
 * problem this feature does not have.
 *
 * **`id` stays authoritative.** When a marker carries both, `id` wins and `slug` is not even
 * consulted — this is a strict widening of the pre-existing "the id resolves" rule (a marker with no
 * `slug` key behaves byte-identically to before), not a new fallback CHAIN where a present-but-broken
 * `id` triggers a `slug` retry; nothing in this codebase's history committed to that stronger contract
 * and building it would add a second resolution path for no requirement in hand. See
 * `resolver-service.ts`'s `resolveWidgetTypeEmbeds` for where `slug` is actually resolved — today
 * that is `"widget"` only (`entries.slug` is unique per `(workspaceId, type)`; `posts.slug` is
 * equally unique and could gain the identical treatment cheaply in a follow-up, but is intentionally
 * left untouched by this change; `media` has no `slug` column at all and cannot support this without
 * a schema migration).
 */

import {
  parseMarkerAttributes,
  scanEmbedMarkers,
  substituteMarkers,
  withElementKeptIfAttributed,
  withInnerContentAndAttributes,
  withInnerContentFinal,
  type EmbedMarker,
  type MarkerAttribute,
} from "../markers/marker.js";
import { normalizeLegacyWidgetMarkers } from "./legacy-widget-markers.js";

// Public rendering accepts legacy widget type/id attributes through this CMS-specific adapter.
// Resolution and substitution both normalize them so their lookup keys cannot drift apart.

/**
 * One embed reference found in a Page's `body_html`. `type` is deliberately a free string (see this
 * file's header) — the scanner never validates it against a known-type list. `id`/`slug`/`name`/
 * `variant` are `null` when the corresponding CONFIG KEY is absent or not a string (or, for `id`/
 * `slug`, out of {@link MAX_EMBED_ID_LENGTH} bounds) — the scanner reports what is literally written
 * in the markup; deciding whether an absent/invalid key makes the reference resolvable is a
 * resolver-side concern (`resolver-service.ts`), not a scanner-side one.
 *
 * Kept as a narrow projection of `EmbedMarker.config` rather than replaced by it: every resolver in
 * `HTML_EMBED_RESOLVERS` reads exactly these five fields, and `null`-for-absent is the shape their
 * skip branches already test. A resolver needing a new key reads it off the marker config directly
 * — this interface is the compatibility seam, not a ceiling.
 */
export interface PageHtmlEmbedRef {
  readonly type: string;
  readonly id: string | null;
  /** See this file's header for why this is NOT the same mechanism as `name` below, despite the
   *  similar shape — `slug` targets a database-unique column, `name` a never-implemented fuzzy match. */
  readonly slug: string | null;
  readonly name: string | null;
  readonly variant: string | null;
  /**
   * `false` only when the config key is the literal JSON boolean `false`; every other case
   * (absent, `true`, or any non-boolean value) is `true` (2026-09-04). Today read only by the
   * `"content"` resolver (`resolver-service.ts`'s `resolveContentTypeEmbeds`), which threads it
   * into the `"post-content"` IR's `props.header` so `render.ts`'s `renderWidgetPostContent` can
   * skip its `.post-detail-header` (`<h1>` + date byline) wrapper — previously unconditional
   * application code a template had no way to opt out of, forcing a `display:none` CSS workaround
   * for a homepage doc-format row that does not want a dated byline. `true`-by-default is load-
   * bearing: no existing template (a `kind:"post"` detail page, the listing page, `about`, `docs`)
   * carries a `header` key, and this default is what keeps every one of them rendering byte-
   * identically to before this field existed. Not read by `"widget"`/`"media"`/the legacy `"post"`
   * type — this is a `"content"`-marker-specific concern, not a general marker attribute.
   */
  readonly header: boolean;
  readonly mode?: "html";
}

/**
 * Resource bound (Programmer workflow step 5a4) mirroring `embed-service.ts`'s
 * `DEFAULT_MAX_EMBEDS_PER_DOCUMENT` for the TipTap path — same policy, same value, applied here
 * because an html Page has no equivalent write-time guardrail (`PagesHtmlDocumentStore.write()`
 * accepts any string; `embed-validation.ts`'s `validateWidgetEmbedMutation` is never in this path).
 * Without a cap, a page carrying thousands of embed placeholders would grow `entry_refs` and the
 * render-time resolved-id set unboundedly. `scanHtmlEmbeds` truncates AT this many refs; occurrences
 * beyond the cap simply resolve to the same REQ-28 placeholder every other unresolved reference
 * does (see `substituteHtmlEmbeds`'s own doc for why it does not need a matching count check).
 *
 * **This is a render/index-time resource guard, NOT a write-time invariant.** Nothing stops
 * `pages_write_html`/the admin HTML editor from storing a page with 5,000 embed placeholders in
 * `body_html` — `PagesHtmlDocumentStore.write()` has no count check of its own, unlike
 * `embed-validation.ts`'s `validateWidgetEmbedMutation` (REQ-20) on the TipTap path, which rejects
 * an over-limit mutation before it is ever persisted. This constant only bounds how much of an
 * already-stored oversized page gets resolved/indexed on any single render or reindex pass — it
 * does not guarantee such a page can never exist. A write-time cap would need its own design
 * decision (reject vs. truncate vs. warn the operator) that has not been made; do not read this
 * constant as implying one already has been.
 */
export const MAX_HTML_EMBEDS_PER_PAGE = 50;

/** An id long enough to be any real UUID/ULID but short enough that a pathological value can't
 * itself become a resource concern once carried into a `Set`/`Map` key or an `entry_refs` row. */
const MAX_EMBED_ID_LENGTH = 200;

/** One config key as a string, or `null` when absent or of any other JSON type. The resolvers'
 * `null`-means-unusable branches predate JSON configs and stay correct unchanged: a non-string
 * `"id": 7` is exactly as unusable as a missing one. */
function configString(config: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" ? value : null;
}

/** `null` when `rawId` is absent, empty, or beyond {@link MAX_EMBED_ID_LENGTH} — a bound too long to
 * safely carry into a `Map`/`Set` key or an `entry_refs` row (see {@link MAX_EMBED_ID_LENGTH}'s own
 * doc), same sanity check the old `data-widget-embed`/`data-form-embed` convention applied. Also used
 * for `slug` (via {@link normalizeEmbedSlug}) — same resource-cost reasoning applies to a slug string
 * carried into a repo lookup key, even though `id` and `slug` name two independently-validated marker
 * keys, not one value under two spellings. */
function normalizeEmbedId(rawId: string | null): string | null {
  if (rawId === null || rawId.length === 0 || rawId.length > MAX_EMBED_ID_LENGTH) return null;
  return rawId;
}

/** `null` when `rawSlug` is absent, empty, or beyond {@link MAX_EMBED_ID_LENGTH} — see
 * {@link normalizeEmbedId}'s own doc for why this shares that bound via one small wrapper rather than
 * a shared rename: `id`/`slug` are independently-validated keys, not one value under two names. */
function normalizeEmbedSlug(rawSlug: string | null): string | null {
  return normalizeEmbedId(rawSlug);
}

/** `true` unless `config[key]` is the JSON boolean literal `false` (2026-09-04, `header`'s own
 * doc on {@link PageHtmlEmbedRef}). Deliberately NOT `configString`'s "wrong type -> unusable"
 * pattern: this is an opt-OUT, so the safe default for anything that isn't a recognized `false` —
 * absent, `true`, or a typo'd non-boolean like `"false"` (a string) — must stay `true`, never
 * silently suppress on a value nobody intended as the opt-out. */
function configBooleanDefaultTrue(config: Readonly<Record<string, unknown>>, key: string): boolean {
  return config[key] !== false;
}

/** Project a parsed marker onto the six fields the resolvers read. `type` is lowercased here, as
 * the old attribute pattern's `i` flag did — a config is hand-authored JSON, so `"Widget"` must keep
 * reaching the same resolver `"widget"` does. */
function toEmbedRef(marker: EmbedMarker): PageHtmlEmbedRef {
  return {
    type: marker.type.toLowerCase(),
    id: normalizeEmbedId(configString(marker.config, "id")),
    slug: normalizeEmbedSlug(configString(marker.config, "slug")),
    name: configString(marker.config, "name"),
    variant: configString(marker.config, "variant"),
    header: configBooleanDefaultTrue(marker.config, "header"),
    ...(marker.config.mode === "html" ? { mode: "html" as const } : {}),
  };
}

/**
 * Every embed reference in `html`, in document order, truncated at
 * {@link MAX_HTML_EMBEDS_PER_PAGE}. Pure — no I/O, never throws. Shared by the render-time resolver
 * (`resolver-service.ts`'s `resolveHtmlPageEmbeds`, which needs to know what to batch-load) and
 * anything that needs to enumerate a page's embed set without rendering it.
 *
 * A marker whose config does not parse is simply absent from the result — render-time stays
 * forgiving (warn + degrade, never throw), and the unparseable marker's own markup survives
 * untouched into the output because {@link substituteHtmlEmbeds} cannot see it either. The LOUD
 * treatment of `rejected` belongs to `core/entry-refs/extractor.ts` (the integrity path a dropped
 * reference would let a delete proceed against) and to the write chokepoint, not here.
 *
 * @complexity O(n) over `html`'s length for the shared scan, plus O(min(k, cap)) to build the
 * returned array, where k is the number of markers.
 * @overallScore 100
 */
export function scanHtmlEmbeds({ html }: { html: string }, _optional: Record<string, never> = {}): PageHtmlEmbedRef[] {
  const refs: PageHtmlEmbedRef[] = [];
  for (const marker of scanEmbedMarkers({ html: normalizeLegacyWidgetMarkers({ html }) }).markers) {
    refs.push(toEmbedRef(marker));
    if (refs.length >= MAX_HTML_EMBEDS_PER_PAGE) break;
  }
  return refs;
}

/**
 * Tag names the `"media"` resolver's own rendered output can itself be (`render.ts`'s
 * `renderImageTag`/`renderVideoTag` emit a bare `<img>`/`<video>` tag; audio is listed for the same
 * reason ahead of an eventual player). If a `"media"` marker's OWN authored tag is one of these,
 * splicing the resolved tag INSIDE it would nest a rendered `<video>`/`<img>` inside another
 * same-named element — not meaningful, playable markup. Falling back to whole-element replace here is
 * the pre-existing behavior, unchanged for this case.
 *
 * Nothing in this codebase authors a `"media"` marker directly on one of these tags today — every
 * real example (the theme-authoring guide, the shipped `basic` theme, this bug's own report) wraps
 * the marker in a container (`div`, `nav`, …) — but {@link MARKER_PATTERN} in `core/embeds/marker.ts`
 * matches any `[a-z]+` tag name, so the grammar does not forbid it. This check is defensive, not a
 * response to an observed case.
 *
 * **`"media"`-only.** `"post"`/`"content"` need no equivalent set: both resolve exclusively through
 * `render.ts`'s `renderWidgetPostContent` (or the `widget-placeholder` div on a miss), and every
 * shape either can produce is `<div>`-rooted — nesting a `<div>` inside a same-named `<div>` marker
 * is ordinary, meaningful markup (unlike a `<video>` inside a `<video>`), so there is no collision to
 * guard against for those two types.
 */
const SELF_RENDERING_MEDIA_TAGS: ReadonlySet<string> = new Set(["img", "video", "audio"]);

/**
 * Attribute names D2 (2026-09-16 embed-attributes plan) says mean something on a rendered
 * `<video>`/`<img>` and NOTHING on a `<div>`/other wrapper tag — so when a `"media"` marker is
 * authored on a non-self-rendering wrapper, an attribute in this set moves off the wrapper and onto
 * the resolved media element; every other authored attribute (`class`, `style`, `id`, `data-*`,
 * `aria-*`, an unknown name) stays on the wrapper. See {@link substituteHtmlEmbeds}'s own doc for how
 * this partition is used, and `render.ts`'s merge helper for how `EmbedOccurrence.elementAttributes`
 * actually lands on the rendered tag (D3's precedence rules).
 *
 * `controls` is listed here (it means nothing on a `<div>` either) even though it is ALSO read
 * separately into {@link EmbedOccurrence.controls} — see {@link resolveMarkerControls}'s own doc for
 * why a raw `controls` attribute is never itself re-emitted onto the rendered element.
 */
export const MEDIA_ELEMENT_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "autoplay",
  "muted",
  "loop",
  "playsinline",
  "controls",
  "controlslist",
  "disablepictureinpicture",
  "disableremoteplayback",
  "poster",
  "preload",
  "crossorigin",
  "alt",
  "loading",
  "decoding",
  "fetchpriority",
  "sizes",
  "referrerpolicy",
  "width",
  "height",
]);

/**
 * Embed types whose resolved replacement is spliced INSIDE the marker's own tag/attrs
 * ({@link withInnerContentFinal}) rather than replacing the whole element — the generalization
 * (2026-08-24, same day as the original `"media"`-only fix) of the reasoning that fix established,
 * applied per type rather than blanket. `"media"` itself is no longer driven through this constant
 * (2026-09-16): it needs its own attribute-partitioning logic (see {@link substituteHtmlEmbeds}), not
 * a plain splice-or-not decision, so it is handled in its own branch instead.
 *
 * - **`content`** (generalized 2026-08-24): `development/docs/architecture/embed-type-inventory.md`
 *   names the realistic authored shape directly — `<main class="page-body"
 *   data-embed-config='{"type":"content"}'></main>` — and already documents that the SAME marker's
 *   `"html"`-format half (`pages.ts`'s `resolveHtmlFormatContentMarkers`, a separate pre-splice pass
 *   outside this function) uses `withInnerContentFinal` for exactly this reason. Before this change
 *   the `"doc"`-format half reaching THIS function (via the registry resolver,
 *   `resolveContentTypeEmbeds`) disagreed with its own sibling path and discarded the wrapper —
 *   generalizing here removes that inconsistency rather than introducing a new behavior.
 * - **`post`** (generalized 2026-08-24): resolves through the identical `"post-content"` IR/render
 *   function `content` does (`renderWidgetPostContent` — two sibling `<div>`s, header and body, or
 *   the placeholder `<div>` on a miss). Since the resolved shape is byte-for-byte the same producer,
 *   the same "an author plausibly wraps this in their own spotlight/teaser container" reasoning
 *   applies without a separate justification.
 * - **`widget` stays excluded from THIS constant** (it has its own 2026-09-16 rule instead — see this
 *   file's header and {@link withElementKeptIfAttributed}). Unlike `post`/`content`, a widget's
 *   resolved root tag is NOT a small, closed set this function can reason about: `WIDGET_IR_RENDERERS`
 *   (`server/http/site/render.ts`) alone spans `<div>`, `<ul>`, `<li>`, `<nav>`, and `<form>` across
 *   its registered component ids, and `resolver-service.ts`'s own doc states adding a new widget type
 *   is meant to be cheap — a future one can introduce any root tag. Several of today's shapes are also
 *   written to BE the final element at the marker's position rather than content for a further
 *   wrapper: `entry-summary`'s bare `<li>` is meant as a direct child of a `<ul>`, and
 *   `contact-form`'s `<form>` nested inside an author's own `<form>` marker tag would be invalid HTML
 *   — the same kind of self-nesting hazard {@link SELF_RENDERING_MEDIA_TAGS} guards for media, but
 *   spanning a tag set this function cannot enumerate (it only ever sees the resolved STRING
 *   `resolve()` returns, never the `componentId` that produced it). Unconditionally wrapping every
 *   widget the way `post`/`content` are wrapped would risk exactly that invalid nesting; keeping a
 *   BARE widget marker on the pre-existing whole-element replace avoids guessing at the mapping, while
 *   an author who explicitly attributed the marker gets their element kept (their choice, their risk).
 */
const WRAPPER_PRESERVING_EMBED_TYPES: ReadonlySet<string> = new Set(["post", "content"]);

/**
 * A wrapper-preserving-type (`"post"`/`"content"`) marker's own resolved replacement: the resolved
 * markup spliced inside the marker's own tag/attrs via {@link withInnerContentFinal} so an authored
 * wrapper (style, class, id, aria-*) survives in the rendered output — `withInnerContentFinal`, not
 * the plainer {@link withInnerContent}, because this output is the final HTML a visitor receives:
 * leaving `data-embed-config` on the rebuilt tag would ship a dead JSON attribute into that markup (an
 * existing invariant `render.test.ts` already pins — the rendered page must never carry
 * `data-embed-config`). `withInnerContent` stays correct for `static-render.ts`'s menu markers, which
 * are theme-authored scaffolding, not this function's final render output.
 *
 * `"media"` no longer reaches this function (2026-09-16) — its own attribute-partitioning branch in
 * {@link substituteHtmlEmbeds} replaced the self-rendering-tag check this function used to make for it.
 */
function spliceWrapperPreservingReplacement(marker: EmbedMarker, resolved: string): string {
  return withInnerContentFinal({ marker: marker, inner: resolved });
}

/**
 * One marker occurrence's forwarded attribute data (2026-09-16 embed-attributes plan), handed to
 * `resolve` alongside its {@link PageHtmlEmbedRef} — the per-occurrence half of "attributes on the
 * marker element reach the rendered output" that a `PageHtmlEmbedRef` alone cannot carry (it is keyed
 * by config content, not by which literal marker element authored it; `entry_refs`/the resolver both
 * intentionally do not need presentation data on that shape).
 */
export interface EmbedOccurrence {
  /**
   * Only meaningful for `"media"`: on a wrapper, the authored attributes D2
   * ({@link MEDIA_ELEMENT_ATTRIBUTE_NAMES}) says belong on `<video>`/`<img>`, not the wrapper; on a
   * marker authored directly on a self-rendering tag ({@link SELF_RENDERING_MEDIA_TAGS}), every
   * authored attribute. Empty for every other type.
   */
  readonly elementAttributes: readonly MarkerAttribute[];
  /**
   * `false` only when the marker's own `controls` attribute resolves to off — see
   * {@link resolveMarkerControls}. `true` (the pre-existing default) for every non-`"media"` type,
   * where the field is unused.
   */
  readonly controls: boolean;
}

const NO_ELEMENT_ATTRIBUTES: readonly MarkerAttribute[] = [];

/** The occurrence handed to `resolve` for every type this function does not partition attributes
 *  for — `"post"`, `"content"`, and the widget/fallback branch. Shared so those branches allocate
 *  nothing per marker. */
const DEFAULT_OCCURRENCE: EmbedOccurrence = { elementAttributes: NO_ELEMENT_ATTRIBUTES, controls: true };

/**
 * Whether a `"media"` marker's `controls` attribute turns controls OFF — the 2026-09-16 owner
 * decision: controls-off is an HTML ATTRIBUTE authored on the marker (`controls="false"`), not a JSON
 * config key. `false` only when the attribute's value, trimmed and lowercased, is the literal string
 * `"false"`; a bare `controls` (no value), any other value (e.g. a typo), or no `controls` attribute
 * at all all keep controls ON — the pre-existing default. Deliberately never itself re-emitted onto
 * the rendered tag: `controls` is an HTML boolean attribute a browser honors by PRESENCE alone, so a
 * literal `controls="false"` in the output would still show controls, exactly the bug this rule
 * exists to prevent. This is the ONLY place that inspects a `"controls"`-named {@link MarkerAttribute}
 * — {@link planMediaMarkerAttributes} strips any `"controls"` entry out of
 * {@link EmbedOccurrence.elementAttributes} unconditionally, so `render.ts`'s merge helper never even
 * sees one; it renders controls-on-or-off purely from the `controls` boolean this function returns.
 *
 * @complexity O(n) in the attribute count (one linear find).
 */
function resolveMarkerControls(attrs: readonly MarkerAttribute[]): boolean {
  const controlsAttr = attrs.find((attr) => attr.name === "controls");
  if (!controlsAttr || controlsAttr.value === null) return true;
  return controlsAttr.value.trim().toLowerCase() !== "false";
}

/** One `"media"` marker's resolved occurrence, PLUS how the wrapper (if any) should be rebuilt — see
 *  D2/D3/D5 of the 2026-09-16 embed-attributes plan. Split out of {@link substituteHtmlEmbeds} so that
 *  function's own per-type branching stays flat. */
interface MediaMarkerAttributePlan {
  readonly occurrence: EmbedOccurrence;
  /** Attributes that stay on the wrapper's own rebuilt tag — empty when the marker collapses (no
   *  wrapper at all). */
  readonly wrapperAttributes: readonly MarkerAttribute[];
  /** Whether ANY authored attribute moved off the wrapper (including a `controls`-only marker, whose
   *  effect is conveyed via {@link EmbedOccurrence.controls} rather than a literal forwarded
   *  attribute, but which still must not remain on the rendered wrapper's own tag). `false` means the
   *  wrapper's output can take the byte-identical fast path ({@link withInnerContentFinal} over the
   *  marker's own verbatim attrs) instead of re-serializing from a reduced attribute list. */
  readonly movedAnyAttribute: boolean;
}

function planMediaMarkerAttributes(marker: EmbedMarker): MediaMarkerAttributePlan {
  const parsed = parseMarkerAttributes({ marker: marker });
  const controls = resolveMarkerControls(parsed);
  // `controls` is NEVER included in `elementAttributes` (2026-09-16, tightened per owner review) —
  // its effect is carried exclusively by `controls` above. A browser honors an HTML boolean attribute
  // by PRESENCE alone regardless of value, so leaving a `controls`/`controls="false"` entry inside
  // `elementAttributes` for a renderer to forward verbatim would risk shipping a literal
  // `controls="false"` that still shows controls — stripping it here, once, removes that hazard
  // entirely rather than trusting every downstream renderer to skip the name correctly.
  const withoutControls = (attrs: readonly MarkerAttribute[]) => attrs.filter((attr) => attr.name !== "controls");
  if (SELF_RENDERING_MEDIA_TAGS.has(marker.tag.toLowerCase())) {
    // Collapse case: there is no wrapper, so every authored attribute (besides controls) hands to the
    // occurrence.
    return { occurrence: { elementAttributes: withoutControls(parsed), controls }, wrapperAttributes: NO_ELEMENT_ATTRIBUTES, movedAnyAttribute: true };
  }
  const mediaElementAttrs = parsed.filter((attr) => MEDIA_ELEMENT_ATTRIBUTE_NAMES.has(attr.name));
  const wrapperAttributes = parsed.filter((attr) => !MEDIA_ELEMENT_ATTRIBUTE_NAMES.has(attr.name));
  // `movedAnyAttribute` is computed from the PRE-strip count: a controls-only marker still moved an
  // attribute off the wrapper (controls means nothing on a div either), even though `elementAttributes`
  // itself ends up empty after `controls` is stripped out.
  return { occurrence: { elementAttributes: withoutControls(mediaElementAttrs), controls }, wrapperAttributes, movedAnyAttribute: mediaElementAttrs.length > 0 };
}

/**
 * Replaces every embed placeholder in `html` with `resolve(ref, occurrence)`'s return value.
 * `resolve` is synchronous and pure from this function's own perspective — the caller is expected
 * to have already batch-resolved every ref it cares about (mirroring how `render.ts`'s
 * `renderDocNode` receives an already-resolved `inlineResolved` map rather than doing its own I/O);
 * a ref `resolve` doesn't recognize (unknown type, never loaded, or beyond
 * {@link MAX_HTML_EMBEDS_PER_PAGE}) is `resolve`'s own call to degrade safely, not something this
 * function special-cases — every caller here (`render.ts`'s `renderHtmlPageBody`) already returns
 * the REQ-28 placeholder for an unresolved ref, which is exactly what "no cap-aware branch needed
 * here" relies on.
 *
 * `resolve` returning `undefined` means **leave this marker exactly as authored**, forwarded straight
 * to `substituteMarkers`' own invariant of the same name. That is not a convenience: since the
 * 2026-08-10 unification this stage SEES markers it does not own (a theme's `partial`/`menu`), and a
 * later stage resolves them. Substituting anything at all over one of those — including the REQ-28
 * placeholder — silently deletes a nav. Which types this stage owns is `resolver-service.ts`'s
 * `isPageEmbedType` to answer; this function only carries the answer through.
 *
 * Per-type handling (2026-09-16):
 * - **`"media"`**: {@link planMediaMarkerAttributes} computes the occurrence AND the wrapper split.
 *   On the marker's own self-rendering tag ({@link SELF_RENDERING_MEDIA_TAGS}) the replacement is
 *   returned as-is (no wrapper, unchanged from before). On any other tag: if nothing moved, the
 *   wrapper is rebuilt via the byte-identical {@link withInnerContentFinal} path; otherwise via
 *   {@link withInnerContentAndAttributes} with only the reduced wrapper attribute list.
 * - **`"post"`/`"content"`** ({@link WRAPPER_PRESERVING_EMBED_TYPES}): spliced via
 *   {@link spliceWrapperPreservingReplacement}, occurrence attributes always empty.
 * - **Every other type** (`"widget"`, and any type this stage does not itself own but still
 *   resolves): {@link withElementKeptIfAttributed} — a bare marker keeps the pre-existing
 *   whole-element replace; an attributed one keeps its element around the resolved output.
 *
 * @complexity O(n) over `html`'s length for the shared scan, plus O(k) per `"media"` marker in its own
 * attribute count (one two-way partition), O(1) per marker otherwise.
 * @overallScore 100
 */
export function substituteHtmlEmbeds(
  { html, resolve }: { html: string; resolve: (ref: PageHtmlEmbedRef, occurrence: EmbedOccurrence) => string | undefined },
  _optional: Record<string, never> = {},

): string {
  return substituteMarkers({ html: normalizeLegacyWidgetMarkers({ html }), resolve: (marker) => {
    const ref = toEmbedRef(marker);

    if (ref.type === "media") {
      const plan = planMediaMarkerAttributes(marker);
      const replacement = resolve(ref, plan.occurrence);
      if (replacement === undefined) return undefined;
      if (SELF_RENDERING_MEDIA_TAGS.has(marker.tag.toLowerCase())) return replacement;
      return plan.movedAnyAttribute
        ? withInnerContentAndAttributes({ marker: marker, attrs: plan.wrapperAttributes, inner: replacement })
        : withInnerContentFinal({ marker: marker, inner: replacement });
    }

    const replacement = resolve(ref, DEFAULT_OCCURRENCE);
    if (replacement === undefined) return undefined;
    // A missing widget contributes nothing, including its authored wrapper/fallback content.
    if (ref.type === "widget" && replacement === "") return "";
    if (WRAPPER_PRESERVING_EMBED_TYPES.has(ref.type)) return spliceWrapperPreservingReplacement(marker, replacement);
    return withElementKeptIfAttributed({ marker: marker, inner: replacement });
  } });
}
