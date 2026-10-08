/**
 * @file The ONE parser for embed markers (`data-embed-config`), shared by every consumer.
 *
 * Purpose:
 * Before the 2026-08-10 marker-spine unification there were four independent scanners, each with its
 * own regex, matching two different attribute vocabularies that had drifted apart:
 *
 * - `widgets/html-embeds.ts` — `data-embed-type`/`data-embed-id` in a Page's `body_html`
 * - `features/theme/static-render.ts` — the same pair for menu/post markers, PLUS
 *   `data-tovu-slot`/`data-nav-current`/`data-slot-variant` for theme partials
 * - `core/entry-refs/extractor.ts` — the same pair again, for reference extraction
 *
 * Four regexes for one concept is four places a fix has to land and four ways they can disagree
 * (they already did: the widgets pipeline only matched a self-closing `<div></div>`, while the theme
 * path deliberately matched a marker WITH authored fallback content inside it). This module is the
 * single definition. Consumers ask it what a piece of HTML references; none of them owns a pattern.
 *
 * The vocabulary is one attribute carrying JSON:
 *
 *     <div data-embed-config='{"type":"partial","id":"nav","current":"index"}'></div>
 *     <nav data-embed-config='{"type":"menu","id":"docs-nav","variant":"tree"}'>fallback</nav>
 *
 * Forms may request plain output with `{"type":"form","id":"contact","mode":"html"}`;
 * `mode` is resolver-owned config, so the parser carries it through unchanged.
 *
 * `type` and `id` are ordinary keys, not separate attributes, so a new key never requires a new
 * attribute name. The attribute is single-quoted precisely so the JSON's own double quotes need no
 * escaping.
 *
 * Architectural role:
 * PURE. No I/O, no DOM, no resolution — it reports what a marker *says*, never what it resolves to.
 * Lives in `core/` because all three consumers above sit in different features and `core/entry-refs`
 * (the integrity path) is already here.
 *
 * ## Why regex and not a parser
 *
 * Same reason the code it replaces used one: this runs server-side against theme-authored markup and
 * Page bodies with no DOM available, and every consumer needs the marker's *source offsets* to
 * substitute in place. A real HTML parse would also have to round-trip the document back to a string
 * byte-identically, which is a much harder guarantee than locating one attribute.
 */

/** A `data-embed-config` marker located in a piece of HTML. */
export interface EmbedMarker {
  /** `config.type` — which resolver handles this. Always present; a marker without it is invalid. */
  readonly type: string;
  /**
   * `config.id` — which instance. `undefined` for a type that needs no target (none today, but the
   * shape allows one rather than forcing a meaningless id).
   */
  readonly id: string | undefined;
  /** The whole parsed object, `type`/`id` included, so a resolver reads its own keys off one place. */
  readonly config: Readonly<Record<string, unknown>>;
  /** The marker element's tag name, for consumers that rebuild the open tag. */
  readonly tag: string;
  /** The marker's attribute string, verbatim, so other authored attributes survive a substitution. */
  readonly attrs: string;
  /** The full matched element including its inner content and closing tag. */
  readonly whole: string;
  /**
   * The marker's own original inner content (between its open and close tag), exactly as authored.
   * The mirror image of {@link withInnerContent}'s parameter: that function takes NEW inner content
   * and keeps the marker's existing tag/attrs; this field is for a caller going the other way —
   * keeping (or transforming) the marker's existing inner content while changing its attrs/config,
   * e.g. {@link withAddedId} filling in a missing `id` without disturbing whatever fallback markup
   * the author put inside the marker.
   */
  readonly inner: string;
  /** Index of `whole` within the scanned html — substitution without re-searching. */
  readonly index: number;
  /** 1-based position among all markers found, for stable locators (`entry_refs` `fieldPath`). */
  readonly occurrence: number;
}

/** Why a marker was rejected. Consumers decide whether to warn, skip, or refuse a write. */
export type EmbedMarkerProblem =
  | { readonly kind: "invalid-json"; readonly raw: string; readonly message: string }
  | { readonly kind: "not-an-object"; readonly raw: string }
  | { readonly kind: "missing-type"; readonly raw: string };

/** One rejected marker, with enough context to name it in an error a human can act on. */
export interface EmbedMarkerRejection {
  readonly problem: EmbedMarkerProblem;
  readonly occurrence: number;
  readonly index: number;
}

export interface ScanEmbedMarkersResult {
  readonly markers: readonly EmbedMarker[];
  /**
   * Markers that carry the attribute but could not be understood. **Never silently empty-on-error**:
   * `entry-refs/extractor.ts` builds the where-used index that safe-delete trusts, and a marker that
   * fails to parse would otherwise drop a reference from that index without a trace — letting a
   * delete proceed against something still in use. Extraction and the write chokepoint must treat a
   * non-empty `rejected` as loud; render-time consumers may degrade quietly.
   */
  readonly rejected: readonly EmbedMarkerRejection[];
}

/**
 * Matches the OPEN tag of one element carrying `data-embed-config`, capturing its tag name and its
 * attribute text. It stops at the open tag's own `>` and makes no assumption about what closes it —
 * {@link scanEmbedMarkers} locates the matching close tag separately, via {@link findBalancedClose}'s
 * depth count over the masked html.
 *
 * Before 2026-09-23 this pattern captured inner content itself, up to a backreferenced `<\/\1>`. That
 * was only safe for a marker with no same-named descendant — true for every marker convention in this
 * codebase at the time, and the same assumption `injectMenuEmbed` documented before this module
 * existed — but it meant `<div data-embed-config='...'><div>…</div></div>` (an inner element sharing
 * the marker's own tag name) closed at the FIRST `</div>`, truncating the marker's real inner content.
 * {@link findBalancedClose} removes that assumption by counting depth instead of matching nearest text.
 *
 * The tag name pattern (`[a-z][a-z0-9-]*`) accepts any HTML element name, including a custom element
 * (`<my-card>`), not just the historical letters-only set.
 *
 * Carries the `d` (`hasIndices`) flag so {@link scanEmbedMarkers} can read every field back out of
 * the ORIGINAL html at each capture group's own offsets, rather than out of whatever string was
 * actually scanned (see {@link maskNonRenderableRegions}) — see that function's doc for why the two
 * must never be the same string.
 *
 * Accepts the value single-quoted (group 3, the authored convention) OR double-quoted (group 4).
 * Before 2026-09-26 only the single-quoted form matched, but every DOM serializer — the admin's
 * Interactive canvas (GrapesJS), `innerHTML`, parse5 — re-emits the SAME attribute as
 * `data-embed-config="{&quot;type&quot;:…}"`, so one canvas save silently turned a working marker into
 * inert markup (the live /pages "That marker, live:" contact-form example rendered an empty box).
 * A double-quoted value is HTML-decoded before parsing ({@link decodeAttributeValue}); a single-quoted
 * one is still read verbatim, as it always was.
 */
const MARKER_PATTERN = /<([a-z][a-z0-9-]*)((?:\s+[^>]*?)?\sdata-embed-config=(?:'([^']*)'|"([^"]*)")(?:\s+[^>]*?)?)\s*>/gid;

/** The `data-embed-config` attribute itself, either quoting — for the rebuild helpers that rewrite or
 *  drop it inside a marker's {@link EmbedMarker.attrs}. Group 1 is set only for the double-quoted form. */
const MARKER_ATTRIBUTE_PATTERN = /\s+data-embed-config=(?:'[^']*'|("[^"]*"))/;

/** Named character references a serializer actually emits inside an attribute value. Any other named
 *  reference is left as written rather than guessed at. */
const NAMED_CHARACTER_REFERENCES: Readonly<Record<string, string>> = { quot: '"', amp: "&", apos: "'", lt: "<", gt: ">", nbsp: " " };

/**
 * A double-quoted attribute value as a browser reads it: `&quot;`/`&amp;`/`&apos;`/`&lt;`/`&gt;`/
 * `&nbsp;` and decimal/hex numeric references decoded. Kept local (this module stays import-free).
 *
 * @complexity O(n) over `value`.
 */
function decodeAttributeValue(value: string): string {
  return value.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-z]+));/g, (whole, dec?: string, hex?: string, name?: string) => {
    if (name !== undefined) return NAMED_CHARACTER_REFERENCES[name] ?? whole;
    const codePoint = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex as string, 16);
    return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : whole;
  });
}

/** The inverse of {@link decodeAttributeValue} for a value written back double-quoted. */
function encodeDoubleQuotedValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Every character of `text` replaced by a space, except newlines (left alone so a masked span
 * cannot change how many lines the surrounding string has). Same length in, same length out. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

/** An HTML comment, open to close, non-greedy so two separate comments never merge into one span. */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

/** A `<script>` or `<style>` element, capturing its tag name (for the backreferenced close) and its
 * raw-text content — the part a browser never parses as markup. */
const RAW_TEXT_ELEMENT_PATTERN = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/**
 * Produce a same-length copy of `html` with every HTML comment, and the raw-text content of every
 * `<script>`/`<style>` element, replaced by space filler. {@link scanEmbedMarkers} runs
 * {@link MARKER_PATTERN} against this copy — never the original — so a well-formed
 * `data-embed-config` marker written inside an authoring note (`<!-- ... -->`) or inside a
 * `<style>` block's CSS comment can never be matched: neither is ever parsed as an element by a
 * browser, so the scanner must not treat either as one either. A marker outside both is untouched
 * here and matches exactly as before.
 *
 * Same length is load-bearing, not cosmetic: every offset {@link scanEmbedMarkers} reports (and
 * {@link substituteMarkers}'s index-based splice back into the ORIGINAL html) depends on a masked
 * span occupying exactly the same positions as what it replaces. Deleting the comment/raw-text
 * content instead of blanking it would shift every later offset out from under those callers.
 *
 * EXPORTED (2026-09-09) for `features/pages/regions.ts`, which scans the SAME page bodies for
 * `data-agent-element` region elements and needs the identical "text inside a comment or inside a
 * <style> block is not markup" rule with the identical offset-preserving guarantee. A second copy
 * of this masking is exactly the four-scanners-for-one-concept drift this module's own header
 * exists to close: region scanning is a different question about the same bytes, not a second
 * vocabulary.
 */
export function maskNonRenderableRegions({ html }: { html: string }, _optional: Record<string, never> = {}): string {
  const withoutComments = html.replace(HTML_COMMENT_PATTERN, blank);
  return withoutComments.replace(RAW_TEXT_ELEMENT_PATTERN, (whole, tagName: string, content: string) => {
    const closingTagLength = tagName.length + 3; // "</" + tagName + ">"
    const openTagLength = whole.length - content.length - closingTagLength;
    return whole.slice(0, openTagLength) + blank(content) + whole.slice(openTagLength + content.length);
  });
}

/**
 * One capture group's `[start, end)` offsets from a `d`-flagged match's `indices` array. Throws
 * rather than returning `undefined` for a group `MARKER_PATTERN` never leaves unmatched — every
 * group here sits on a mandatory part of the pattern, never inside an optional alternation, so a
 * missing entry means the pattern changed underneath this function, not a normal runtime path.
 */
function requireGroupRange(indices: RegExpIndicesArray, group: number): readonly [number, number] {
  const range = indices[group];
  if (!range) {
    throw new Error(`marker.ts: expected capture group ${group} of MARKER_PATTERN to participate in the match`);
  }
  return range;
}

/**
 * Validate one marker's raw attribute text. Split out from {@link scanEmbedMarkers} so the scan stays
 * a plain loop: all three rejection branches live here, and the caller only chooses which list to
 * push onto.
 *
 * EXPORTED (2026-09-23, Bug A / interactive-bugs plan Slice A1) so a consumer that only has the raw
 * `data-embed-config` string in hand — the admin's canvas placeholder describer, which reads an
 * already-authored DOM attribute rather than re-running {@link scanEmbedMarkers} — can apply the exact
 * same parse-and-reject rule `scanEmbedMarkers` itself uses, instead of growing its own copy of it.
 */
export function parseEmbedMarkerConfig({ raw }: { raw: string }, _optional: Record<string, never> = {}): { config: Record<string, unknown> } | { problem: EmbedMarkerProblem } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { problem: { kind: "invalid-json", raw, message: (err as Error).message } };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { problem: { kind: "not-an-object", raw } };
  }
  const config = parsed as Record<string, unknown>;
  if (typeof config.type !== "string" || config.type === "") {
    return { problem: { kind: "missing-type", raw } };
  }
  return { config };
}

/** A tag token's `[start, end)` span in the masked html — from its `<` through its first `>`. */
type TagSpan = readonly [number, number];

/**
 * Every `<tagName`/`</tagName` token in `masked` from `fromIndex` onward, in document order. The
 * boundary lookahead (`[\s/>]`) stops `<my-card` matching a longer name like `<my-card-extra`; each
 * token ends at its first `>`, and the scan resumes there, so a token's own attribute text is never
 * re-read as another token. Stops at a trailing malformed tag with no `>` at all.
 *
 * Runs against the MASKED copy only, so a tag written inside a comment or a `<script>`/`<style>`
 * element's raw text (already blanked by {@link maskNonRenderableRegions}) is invisible here,
 * exactly as it is invisible to {@link MARKER_PATTERN} itself.
 *
 * @complexity O(n) over the remaining length of `masked`.
 */
function* tagTokens(masked: string, tagName: string, fromIndex: number): Generator<{ readonly isClose: boolean; readonly span: TagSpan }> {
  const token = new RegExp(`<(/?)${tagName}(?=[\\s/>])`, "gi");
  token.lastIndex = fromIndex;
  for (let match = token.exec(masked); match !== null; match = token.exec(masked)) {
    const closeAngle = masked.indexOf(">", match.index);
    if (closeAngle === -1) return;
    yield { isClose: match[1] === "/", span: [match.index, closeAngle + 1] };
    token.lastIndex = closeAngle + 1;
  }
}

/**
 * The depth-balanced close for the open tag whose match ended at `fromIndex`, by counting
 * {@link tagTokens} from there: `<div><div>…</div></div>` closes at the tag that actually balances the
 * one already open, not at the first `</div>` found. Falls back to the first close found when the
 * region never rebalances (a genuinely unclosed inner tag) — the result the old backreferenced pattern
 * produced, so malformed markup degrades as it did before. `null` when there is no close at all.
 *
 * Only {@link findBalancedClose}'s fallback for an open tag {@link indexTagTokens} tokenized
 * differently (its JSON config holds a `>`); every other lookup is answered from that index.
 *
 * @complexity O(n) over the remaining length of `masked`.
 */
function scanForBalancedClose(masked: string, tagName: string, fromIndex: number): TagSpan | null {
  let depth = 1;
  let firstClose: TagSpan | null = null;
  for (const { isClose, span } of tagTokens(masked, tagName, fromIndex)) {
    if (!isClose) {
      depth += 1;
      continue;
    }
    firstClose ??= span;
    depth -= 1;
    if (depth === 0) return span;
  }
  return firstClose;
}

/** One tag name's tokens over the whole masked html, paired once with a stack. */
interface TagTokenIndex {
  /** Each open token's start → the span of the close that balances it, or `null` if none does. */
  readonly partners: ReadonlyMap<number, TagSpan | null>;
  /** Every close token's span, in document order (so sorted by start). */
  readonly closes: readonly TagSpan[];
}

/**
 * Pairs every `<tagName`/`</tagName` token in `masked` in ONE pass. Stack pairing gives each open the
 * same close {@link scanForBalancedClose}'s depth count from that open would find (both match a close
 * with the nearest still-open tag), but for every open at once — so a page of k unbalanced markers
 * costs O(n), not the O(k·n) of rescanning to the end of the document once per marker.
 *
 * @complexity O(n) time, O(t) space for t tokens.
 */
function indexTagTokens(masked: string, tagName: string): TagTokenIndex {
  const partners = new Map<number, TagSpan | null>();
  const closes: TagSpan[] = [];
  const openStarts: number[] = [];
  for (const { isClose, span } of tagTokens(masked, tagName, 0)) {
    if (!isClose) {
      partners.set(span[0], null);
      openStarts.push(span[0]);
      continue;
    }
    closes.push(span);
    const opener = openStarts.pop();
    if (opener !== undefined) partners.set(opener, span);
  }
  return { partners, closes };
}

/** The first span in `closes` (sorted by start) starting at or after `fromIndex`, or `null`.
 * @complexity O(log c) — binary search. */
function firstCloseFrom(closes: readonly TagSpan[], fromIndex: number): TagSpan | null {
  let low = 0;
  let high = closes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    // low < high keeps mid within the sorted closes array.
    if (closes[mid]![0] < fromIndex) low = mid + 1;
    else high = mid;
  }
  return closes[low] ?? null;
}

/**
 * The `[start, end)` span (in `masked`) of the close tag that balances the marker open tag spanning
 * `[openStart, openEnd)` — see {@link scanForBalancedClose} for the balancing and first-close
 * fallback rules — or `null` when no close exists at all (a void element such as `<img>`, or an
 * unclosed marker): the caller then treats the open tag alone as the whole marker, rather than
 * letting it swallow the rest of the document.
 *
 * Answers from a per-tag-name {@link indexTagTokens} built once per scan and kept in `cache`. When
 * that index tokenized this open tag differently from the marker pattern (the index ends a tag at its
 * first `>`, and a `>` inside the JSON config ends it early), it falls back to the exact linear count.
 *
 * @complexity O(log c) amortized once the tag name's O(n) index exists; O(n) on the fallback.
 */
function findBalancedClose(
  masked: string,
  tag: { readonly name: string; readonly openStart: number; readonly openEnd: number },
  cache: Map<string, TagTokenIndex>,
): TagSpan | null {
  const key = tag.name.toLowerCase();
  let index = cache.get(key);
  if (index === undefined) {
    index = indexTagTokens(masked, key);
    cache.set(key, index);
  }
  const partner = index.partners.get(tag.openStart);
  const aligned = partner !== undefined && masked.indexOf(">", tag.openStart) + 1 === tag.openEnd;
  if (!aligned) return scanForBalancedClose(masked, key, tag.openEnd);
  return partner ?? firstCloseFrom(index.closes, tag.openEnd);
}

/**
 * Locate and parse every embed marker in `html`. Pure; allocates one result per marker.
 *
 * Scans {@link maskNonRenderableRegions}'s masked copy so a marker sitting inside an HTML comment or
 * a `<script>`/`<style>` element's raw text is never matched, and so tags inside either are invisible
 * to {@link findBalancedClose}'s depth count too. Every field on the resulting {@link EmbedMarker}
 * (`whole`, `tag`, `attrs`, `inner`, the parsed config) is read back out of the ORIGINAL `html` at
 * that match's own offsets — masking only decides which spans are eligible to be a marker or to count
 * toward a close tag's depth, it must never change what an eligible marker's own fields report.
 *
 * Uses a private copy of {@link MARKER_PATTERN} (same source/flags) for the `exec` loop below, rather
 * than mutating the shared module-level regex's `lastIndex` directly — this function is PURE, and a
 * shared mutable scan cursor would corrupt a reentrant or recursive call.
 */
export function scanEmbedMarkers({ html }: { html: string }, _optional: Record<string, never> = {}): ScanEmbedMarkersResult {
  const markers: EmbedMarker[] = [];
  const rejected: EmbedMarkerRejection[] = [];
  let occurrence = 0;

  const masked = maskNonRenderableRegions({ html: html });
  const pattern = new RegExp(MARKER_PATTERN.source, MARKER_PATTERN.flags);
  const closeIndexCache = new Map<string, TagTokenIndex>();
  for (let match = pattern.exec(masked); match !== null; match = pattern.exec(masked)) {
    occurrence += 1;
    const indices = (match as RegExpExecArray & { indices: RegExpIndicesArray }).indices;
    const [wholeStart, openTagEnd] = requireGroupRange(indices, 0);
    const tagRange = requireGroupRange(indices, 1);
    const attrsRange = requireGroupRange(indices, 2);
    const doubleQuotedRange = indices[4];
    const rawRange = doubleQuotedRange ?? requireGroupRange(indices, 3);
    const tag = html.slice(...tagRange);

    // No close at all (a void `<img>` marker): the open tag alone is the whole marker, inner empty.
    const [closeStart, closeEnd] = findBalancedClose(masked, { name: tag, openStart: wholeStart, openEnd: openTagEnd }, closeIndexCache) ?? [
      openTagEnd,
      openTagEnd,
    ];
    pattern.lastIndex = closeEnd; // resume past this marker's whole balanced span, never re-entering it

    const index = wholeStart;
    const whole = html.slice(wholeStart, closeEnd);
    const attrs = html.slice(...attrsRange);
    const raw = doubleQuotedRange ? decodeAttributeValue(html.slice(...rawRange)) : html.slice(...rawRange);
    const inner = html.slice(openTagEnd, closeStart);
    const result = parseEmbedMarkerConfig({ raw: raw });

    if ("problem" in result) {
      rejected.push({ problem: result.problem, occurrence, index });
      continue;
    }
    const { config } = result;
    markers.push({
      type: config.type as string,
      id: typeof config.id === "string" ? config.id : undefined,
      config,
      tag,
      attrs,
      whole,
      inner,
      index,
      occurrence,
    });
  }

  return { markers, rejected };
}

/**
 * The JSON text of a decoded marker value, made safe to sit verbatim inside a single-quoted
 * attribute: `'` and `&` become the JSON escapes `\u0027`/`\u0026`. Both can only occur inside a
 * JSON string, where those escapes mean the same character, so `JSON.parse` returns the identical
 * value. Deliberately not `&#39;`/`&amp;`: {@link scanEmbedMarkers} reads a single-quoted value
 * verbatim, so an entity there would reach `JSON.parse` undecoded and change the config.
 *
 * @complexity O(n) over `json`.
 */
function toSingleQuotedValue(json: string): string {
  return json.replace(/'/g, "\\u0027").replace(/&/g, "\\u0026");
}

/**
 * Rewrites every double-quoted, entity-encoded `data-embed-config="{&quot;type&quot;:…}"` (what a DOM
 * serializer such as the admin's Interactive canvas emits) back to the authored, readable form
 * `data-embed-config='{"type":…}'`, so the stored page source reads the way it was written. Every
 * Page HTML write runs through this (`PagesHtmlDocumentStore`), and the admin applies it to what the
 * canvas hands back.
 *
 * Exact at the config level: a rewritten marker scans to the same `config`, `attrs` and `inner` it did
 * before. Only the quoted value changes; the tag, other attributes and content are untouched. Left
 * as written: a single-quoted marker, a marker inside a comment or `<script>`/`<style>` (never matched,
 * see {@link maskNonRenderableRegions}), and a value that is not valid JSON, so a broken marker still
 * reaches {@link scanEmbedMarkers}'s rejection with its original text.
 *
 * @complexity O(n) over `html`.
 */
export function normalizeEmbedMarkerQuoting({ html }: { html: string }, _optional: Record<string, never> = {}): string {
  const masked = maskNonRenderableRegions({ html: html });
  const pattern = new RegExp(MARKER_PATTERN.source, MARKER_PATTERN.flags);
  let result = "";
  let copiedUpTo = 0;
  for (let match = pattern.exec(masked); match !== null; match = pattern.exec(masked)) {
    const valueRange = (match as RegExpExecArray & { indices: RegExpIndicesArray }).indices[4];
    if (!valueRange) continue;
    const decoded = decodeAttributeValue(html.slice(...valueRange));
    try {
      JSON.parse(decoded);
    } catch {
      continue;
    }
    // The value's quotes sit one character outside its capture group on either side.
    result += `${html.slice(copiedUpTo, valueRange[0] - 1)}'${toSingleQuotedValue(decoded)}'`;
    copiedUpTo = valueRange[1] + 1;
  }
  return result + html.slice(copiedUpTo);
}

/** Every marker of one type, in document order. The common "which menus does this theme name" shape. */
export function markersOfType({ html, type }: { html: string; type: string }, _optional: Record<string, never> = {}): readonly EmbedMarker[] {
  return scanEmbedMarkers({ html: html }).markers.filter((m) => m.type === type);
}

/**
 * The two marker `type` values this module parses but never itself resolves — owned end-to-end by
 * `features/theme/static-render.ts` (`injectMenuEmbeds` for {@link MENU_MARKER_TYPE}, `resolveSlots`
 * for {@link PARTIAL_MARKER_TYPE}), which run AFTER `widgets/resolver-service.ts`'s page-embed stage
 * on every static-tier page render.
 *
 * Hoisted here (2026-08-17) so that ownership fact has exactly one spelling. Before this, it existed
 * only as inline string-literal comparisons inside `static-render.ts` itself
 * (`marker.type !== "menu"`, `marker.type !== "partial"`), and `resolver-service.ts`'s own
 * `THEME_OWNED_MARKER_TYPES` carried an independently-typed copy of the same two strings as a
 * documented stopgap pending this exact hoist (`ADS-memory/reports/
 * 2026-08-16-embed-placeholder-gap.md`, "Reuse decision") — two spellings of one fact is exactly the
 * kind of drift risk this module exists to close for marker *parsing*; these two constants close it
 * for marker *type naming* the same way.
 *
 * Deliberately NOT the same question `isPageEmbedType()` (`widgets/resolver-service.ts`) answers —
 * that function tests registry membership (`Object.hasOwn(HTML_EMBED_RESOLVERS, type)`), which is
 * `false` for these two AND for a genuine unregistered/typo type alike. These constants name the
 * "owned elsewhere, not a typo" fact directly instead; see `isPageEmbedType`'s own doc for why
 * conflating the two would silence a real warning.
 */
export const MENU_MARKER_TYPE = "menu";
export const PARTIAL_MARKER_TYPE = "partial";

/**
 * The post-previews marker type (2026-09-03) — a theme/page marker that renders a bounded list of
 * published post previews wherever it appears, so any authored Page (a static theme's own marketing
 * page, or a Page/Post rendered through a `theme.json` `templates` entry) can host a post listing.
 * Same ownership shape as {@link MENU_MARKER_TYPE}/{@link PARTIAL_MARKER_TYPE} immediately above:
 * resolved end-to-end by `features/theme/static-render.ts`'s `injectPostPreviewsEmbeds`, never
 * registered in `widgets/resolver-service.ts`'s `HTML_EMBED_RESOLVERS` — see that file's
 * `THEME_OWNED_MARKER_TYPES`, which carries a matching literal entry for the same disclosed
 * "duplicated, not imported" reason its own doc already states for the other two.
 *
 * Config shape: `{"type":"post-previews","limit":6}` — `limit` is optional (defaults to
 * `DEFAULT_POST_PREVIEWS_LIMIT`, `static-render.ts`) and is always clamped, never trusted verbatim,
 * before it reaches the bounded repo query that feeds this marker.
 */
export const POST_PREVIEWS_MARKER_TYPE = "post-previews";

/**
 * The collection marker type (2026-09-23) — a theme/page marker that renders a bounded, filtered,
 * sorted list of entries from one custom content type wherever it appears. Same ownership shape as
 * {@link MENU_MARKER_TYPE}/{@link PARTIAL_MARKER_TYPE}/{@link POST_PREVIEWS_MARKER_TYPE} immediately
 * above: resolved end-to-end by `features/theme/static-render.ts`'s `injectCollectionEmbeds`, never
 * registered in `widgets/resolver-service.ts`'s `HTML_EMBED_RESOLVERS` — see that file's
 * `THEME_OWNED_MARKER_TYPES`, which carries a matching literal entry for the same disclosed
 * "duplicated, not imported" reason its own doc gives for the other three.
 *
 * Config shape (validated by `entries/public-list.ts`'s `parseCollectionListConfig`, not by this
 * module): `{"type":"collection","id":"recipe", …}` (`typeKey` accepted as an alias) plus the type's own filter/sort/limit/layout
 * keys. Unlike {@link POST_PREVIEWS_MARKER_TYPE}, a resolved collection marker's wrapper is stripped
 * of `data-embed-config` on the hit path ({@link withInnerContentFinal}) so a later re-scan of the
 * same output can never rediscover and re-resolve it.
 */
export const COLLECTION_MARKER_TYPE = "collection";

/**
 * The featured-image marker type (2026-10-05) — a post template's slot for the current post's
 * featured image. A static-tier theme has no template language to read `post.featuredImage` (the
 * Liquid/Handlebars tiers' theme data), so before this marker a static theme had no way to show the
 * image at all; it only reached `og:image`. Same ownership shape as {@link COLLECTION_MARKER_TYPE}:
 * resolved end-to-end by `features/theme/static-render.ts`'s `injectFeaturedImage`, listed in
 * `resolver-service.ts`'s `THEME_OWNED_MARKER_TYPES`.
 *
 * Config shape: `{"type":"featured-image"}` — no target; it always means the entity the route is
 * rendering. A hit fills the authored element with the `<img>` and strips the marker; no image
 * (none set, unresolved, or a page with no current post) removes the WHOLE element, wrapper and
 * fallback included, so a theme's figure/margins never render around nothing.
 */
export const FEATURED_IMAGE_MARKER_TYPE = "featured-image";

/**
 * The longest a target value ({@link embedMarkerTarget}'s `id`/`slug`/`typeKey`) may be before it
 * counts as absent rather than a usable reference. A duplicate of `features/widgets/html-embeds.ts`'s
 * `MAX_EMBED_ID_LENGTH` (same number, same reasoning: a bound too long to safely carry into a
 * `Map`/`Set` key or an `entry_refs` row), not a shared import — this module stays import-free (see
 * {@link maskNonRenderableRegions}'s file header and `marker-target-parity.unit.test.ts`'s boundary
 * assertion), the same "duplicated fact, disclosed in a comment" tradeoff {@link MENU_MARKER_TYPE} and
 * {@link PARTIAL_MARKER_TYPE} already document for their own server-side twins.
 */
const MAX_TARGET_VALUE_LENGTH = 200;

/**
 * One marker type's `data-embed-config` keys that can name its resolution target, in the exact
 * precedence order the server tries them — `embedMarkerTarget` returns the FIRST of these keys with a
 * usable string value. This is the "which key names the target" rule Bug A's root cause report
 * (2026-09-23 interactive-bugs plan) found spread across four different resolvers
 * (`resolver-service.ts`'s widget/media/post/content, `routes/site/pages.ts`'s collection) with no
 * single shared table — the admin's own placeholder describer could not reuse it because nothing here
 * exposed it. Hoisting it as data (not a switch statement) is what lets both the server's own resolvers
 * and the admin's UI-only describer read the identical precedence rule.
 *
 * - `widget`/`form`/`media`/`post`/`content`: `id`, else `slug` — registered in
 *   `resolver-service.ts`'s `HTML_EMBED_RESOLVERS` (see `marker-target-parity.unit.test.ts`, which fails
 *   loudly if a registered type has no matching row or incorrect target keys).
 * - `taxonomy`: `id` only — `widgets/resolvers/taxonomy.ts` reads `ref.id`, accepting a real
 *   taxonomy id or a unique taxonomy name through that key; `ref.slug` is never consulted.
 * - {@link COLLECTION_MARKER_TYPE}: `id`, else `typeKey` — `routes/site/pages.ts`'s
 *   `collectionMarkerTypeKey` tries `config.id` before `config.typeKey`; `slug` is never consulted.
 * - {@link MENU_MARKER_TYPE} / {@link PARTIAL_MARKER_TYPE}: `id` only — `static-render.ts` resolves
 *   both purely by id.
 * - {@link POST_PREVIEWS_MARKER_TYPE}: no keys at all — this marker needs no target
 *   ({@link embedMarkerTarget} reports that as its own `{ key: "none" }` outcome, never `undefined`,
 *   which means "target missing").
 *
 * An unknown type (not a key of this table) is not a member of it; {@link embedMarkerTarget} falls back
 * to `["id"]` for that case rather than treating an unrecognized type as needing no target — a display
 * must never claim a slug resolves for a type no resolver has ever registered.
 */
export const EMBED_MARKER_TARGET_KEYS: Readonly<Record<string, readonly ("id" | "slug" | "typeKey")[]>> = {
  widget: ["id", "slug"],
  form: ["id", "slug"],
  taxonomy: ["id"],
  media: ["id", "slug"],
  post: ["id", "slug"],
  content: ["id", "slug"],
  [COLLECTION_MARKER_TYPE]: ["id", "typeKey"],
  [MENU_MARKER_TYPE]: ["id"],
  [PARTIAL_MARKER_TYPE]: ["id"],
  [POST_PREVIEWS_MARKER_TYPE]: [],
};

/** The default target-key list for a type absent from {@link EMBED_MARKER_TARGET_KEYS} — an unknown
 *  or typo'd type is assumed id-addressable like most types, but never slug-addressable: no resolver
 *  has ever registered to read a slug for it, so claiming one would resolve is always wrong. */
const UNKNOWN_TYPE_TARGET_KEYS: readonly ("id" | "slug" | "typeKey")[] = ["id"];

/**
 * One marker's resolved target, from {@link embedMarkerTarget}: either a key/value pair naming what
 * the marker points at, or the `"none"` marker for a type that needs no target at all. Kept distinct
 * from `undefined` (target missing) — see {@link embedMarkerTarget}'s own doc.
 */
export type EmbedMarkerTarget = { readonly key: "id" | "slug" | "typeKey"; readonly value: string } | { readonly key: "none" };

/** `value` trimmed down to a usable target string, or `undefined` if it is not a non-empty string of
 *  at most {@link MAX_TARGET_VALUE_LENGTH} characters — the same absent-vs-present rule
 *  `features/widgets/html-embeds.ts`'s `normalizeEmbedId`/`normalizeEmbedSlug` apply to their own
 *  config reads. @complexity O(1). */
function normalizeTargetValue(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TARGET_VALUE_LENGTH) return undefined;
  return value;
}

/**
 * Which `data-embed-config` key names `type`'s resolution target, and that key's value, per
 * {@link EMBED_MARKER_TARGET_KEYS}'s precedence order. Three distinct outcomes:
 *
 * - `{ key, value }` — the first target key present with a usable string value.
 * - `{ key: "none" }` — this type ({@link POST_PREVIEWS_MARKER_TYPE}) needs no target; a caller must
 *   never read this as "target missing".
 * - `undefined` — the type has one or more target keys, but the marker's config supplies none of them
 *   (or only with an unusable value per {@link normalizeTargetValue}) — "target missing".
 *
 * `type` is compared lower-cased, matching `toEmbedRef`'s own `marker.type.toLowerCase()` in
 * `resolver-service.ts` — a hand-authored `"Widget"` must resolve exactly as `"widget"` does.
 *
 * @complexity O(k) in the number of candidate keys for `type` (at most 2 today) — independent of the
 * surrounding document's size.
 */
export function embedMarkerTarget({ type, config }: { type: string; config: Readonly<Record<string, unknown>> }, _optional: Record<string, never> = {}): EmbedMarkerTarget | undefined {
  const keys = EMBED_MARKER_TARGET_KEYS[type.toLowerCase()] ?? UNKNOWN_TYPE_TARGET_KEYS;
  if (keys.length === 0) return { key: "none" };
  for (const key of keys) {
    const value = normalizeTargetValue(config[key]);
    if (value !== undefined) return { key, value };
  }
  return undefined;
}

/**
 * The "Copy embed code" snippet for any marker type: the same `<div data-embed-config='{"type":…,
 * "<key>":"<value>"}'></div>` wrapper {@link scanEmbedMarkers}/{@link parseEmbedMarkerConfig} already
 * parse back — generalised (readable-slugs S5b) out of `apps/admin/src/features/collections/rules.ts`'s
 * `collectionEmbedSnippet`, the one admin-generated marker that existed before this: that function is
 * now a one-line call onto this (`embedMarkerSnippet("collection", "id", key)`), byte-for-byte
 * unchanged. `features/media`'s own "Copy embed code" button (S5a) is the second caller, with
 * `("media", "slug", asset.slug)` — see {@link EMBED_MARKER_TARGET_KEYS}'s `media` row for why `slug`
 * is a real, resolvable target key for this type.
 *
 * No escaping beyond the plain template: `key`/`value` are expected to already be validated,
 * quote-free identifiers (a slug, a type key, an id) by the time a caller reaches for a copy button —
 * the same assumption `collectionEmbedSnippet` always made.
 *
 * @complexity O(1) — one template string.
 */
export function embedMarkerSnippet(
  { type, key, value }: { type: string; key: "id" | "slug" | "typeKey"; value: string },
  _optional: Record<string, never> = {},
): string {
  return `<div data-embed-config='{"type":"${type}","${key}":"${value}"}'></div>`;
}

/**
 * Rebuild a marker's element around new inner content, keeping its own tag and every authored
 * attribute (`class`, `aria-label`, …). The counterpart to a wholesale replace: a menu marker keeps
 * its `<nav class="docs-nav">` wrapper and only swaps what's inside, whereas a partial slot marker
 * disappears entirely and is replaced by the partial.
 *
 * Synthesizing the open tag from `config` alone instead of using this is a silent bug — it drops the
 * theme's styling hooks and accessible names with nothing failing.
 */
export function withInnerContent({ marker, inner }: { marker: EmbedMarker; inner: string }, _optional: Record<string, never> = {}): string {
  return `<${marker.tag}${marker.attrs}>${inner}</${marker.tag}>`;
}

/**
 * Rebuild a marker's element with `id` added to its `data-embed-config`, keeping every other
 * authored config key, the marker's own tag, its other attributes, and its authored inner content
 * ({@link EmbedMarker.inner}) completely unchanged. The counterpart to {@link withInnerContent} for a
 * caller that needs to SUPPLY a marker's target rather than its content — e.g. the unified `content`
 * marker (2026-08-11): a theme-authored `{"type":"content"}` with no `id` means "the entity the route
 * already resolved", and the route fills that id in here before the marker is ever resolved, so every
 * downstream consumer (the scanner, the resolver, a later re-scan) sees an ordinary id-carrying marker
 * rather than needing its own "no id means current entity" special case.
 *
 * Callers must check `marker.id === undefined` themselves before calling this — an author's own
 * explicit id always wins over a caller-supplied default, and this function does not re-check that
 * (it would silently overwrite an explicit reference otherwise, which is the one thing the unified
 * marker's id-vs-no-id contract must never do).
 *
 * @complexity O(n) over the marker's own attrs length (one JSON stringify of a small object, one
 * regex replace over `attrs`) — independent of the surrounding document's size.
 */
export function withAddedId({ marker, id }: { marker: EmbedMarker; id: string }, _optional: Record<string, never> = {}): string {
  const config = JSON.stringify({ ...marker.config, id });
  // Keeps the marker's own quoting: a double-quoted value is re-encoded, a single-quoted one is not.
  const attrsWithId = marker.attrs.replace(MARKER_ATTRIBUTE_PATTERN, (_whole, doubleQuoted?: string) =>
    doubleQuoted === undefined ? ` data-embed-config='${config}'` : ` data-embed-config="${encodeDoubleQuotedValue(config)}"`,
  );
  return `<${marker.tag}${attrsWithId}>${marker.inner}</${marker.tag}>`;
}

/**
 * Rebuild a marker's element around new inner content, like {@link withInnerContent}, but ALSO strips
 * the marker's own `data-embed-config` attribute from the rebuilt tag — every other authored attribute
 * (`class`, `aria-label`, …) survives, only the marker-ness is removed.
 *
 * For a caller that performs its OWN final resolution outside the shared registry/render pipeline
 * (`pages.ts`'s recursive `content`-marker pre-splice, which fetches and inlines an `"html"`-format
 * entity's own body ahead of the normal `resolveHtmlPageEmbeds`/`renderHtmlPageBody` pass) and must
 * guarantee the result is not rediscovered and re-resolved by a LATER marker scan over the same output
 * — an ordinary {@link withInnerContent} splice would leave `data-embed-config` intact, and the next
 * scan would see what looks like a fresh, unresolved marker and try to resolve it again.
 *
 * @complexity O(n) over the marker's own attrs length (one regex replace) — independent of the
 * surrounding document's size.
 */
export function withInnerContentFinal({ marker, inner }: { marker: EmbedMarker; inner: string }, _optional: Record<string, never> = {}): string {
  const attrsWithoutMarker = marker.attrs.replace(MARKER_ATTRIBUTE_PATTERN, "");
  return `<${marker.tag}${attrsWithoutMarker}>${inner}</${marker.tag}>`;
}

/**
 * Replace each marker's WHOLE element with what `resolve` returns for it.
 *
 * Whole-element rather than inner-content because the two consumers genuinely differ: a partial slot
 * marker is scaffolding that vanishes once the partial is spliced in, while a menu marker is real
 * theme markup that must survive with only its contents swapped. Callers in the second camp wrap
 * their output in {@link withInnerContent}; making that explicit at the call site is better than a
 * mode flag, because the choice is a real per-type decision and not a preference.
 *
 * `resolve` returning `undefined` means "leave this marker exactly as authored", and that default is
 * load-bearing: a menu that does not exist, a target that was deleted, or a render that produces
 * nothing must fall back to the theme's authored content rather than blanking a nav. Every consumer
 * wants that rule, so it lives here rather than being re-implemented per call site.
 *
 * Applies right-to-left so each splice leaves the earlier markers' offsets valid.
 */
export function substituteMarkers(
  { html, resolve }: { html: string; resolve: (marker: EmbedMarker) => string | undefined },
  _optional: Record<string, never> = {},

): string {
  const { markers } = scanEmbedMarkers({ html: html });
  let out = html;
  for (let i = markers.length - 1; i >= 0; i -= 1) {
    // The reverse loop keeps i within the scanner result.
    const m = markers[i]!;
    const replacement = resolve(m);
    if (replacement === undefined) continue;
    out = out.slice(0, m.index) + replacement + out.slice(m.index + m.whole.length);
  }
  return out;
}

/**
 * One HTML attribute authored directly on a marker element (2026-09-16 — owner: "regular attributes
 * that somebody puts on a data-embed-config should work on the rendered tag"). Produced by
 * {@link parseMarkerAttributes}, consumed by callers that forward some or all of a marker's authored
 * attributes onto whatever it resolves to.
 */
export interface MarkerAttribute {
  readonly name: string;
  /** Source text, exactly as authored — never entity-decoded (see {@link parseMarkerAttributes}'s
   *  own doc for why). `null` means the attribute was written with no `="..."` at all (a boolean
   *  attribute like a bare `autoplay`), not that it had an empty value. */
  readonly value: string | null;
}

/**
 * The shape every attribute name {@link parseMarkerAttributes} accepts must have — deliberately
 * narrower than the full HTML spec's own name production, sized for real attribute names (`class`,
 * `data-*`, `aria-*`, `autoplay`, …), the same "narrower on purpose" discipline
 * `@jini-ai/cms/media`'s `html-attributes.ts` applies to its own allowlisted names. A token whose name
 * fails this is skipped, not thrown — this parser runs over already-authored page HTML (page trust,
 * no allowlist; see the 2026-09-16 embed-attributes plan §0), so "not a well-formed attribute name" is
 * a shape problem this parser degrades past, not a security boundary.
 */
const MARKER_ATTRIBUTE_NAME_PATTERN = /^[a-z_:][-a-z0-9_:.]*$/;

/**
 * Quote-aware attribute-token scanner: matches one `name`, or one `name=unquoted`, `name="value"`, or
 * `name='value'` pair. The identical loose shape `@jini-ai/cms/media`'s `html-attributes.ts` uses for
 * its own `HTML_ATTRIBUTE_TOKEN` — quote-aware so a `data-embed-config='{"type":"media"}'` token
 * (double quotes living inside a single-quoted value) is consumed as ONE token rather than corrupting
 * the scan at its first interior `"`.
 */
const MARKER_ATTRIBUTE_TOKEN = /([^\s="']+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g;

/**
 * Parses a marker's verbatim {@link EmbedMarker.attrs} text into structured attributes, in authored
 * order, with `data-embed-config` itself removed (it is the marker, not an attribute a caller would
 * ever want to forward) — the read half of the 2026-09-16 embed-attributes contract:
 * {@link formatMarkerAttributes} is its inverse.
 *
 * - Names are lowercased (HTML attribute names are case-insensitive).
 * - A token whose (lowercased) name is not a valid attribute name per
 *   {@link MARKER_ATTRIBUTE_NAME_PATTERN} is skipped, never thrown.
 * - A duplicate name keeps its FIRST occurrence — the same rule a real HTML parser applies, so this
 *   parser's result matches what a browser would actually expose on the element.
 * - Every value is kept as SOURCE TEXT: never entity-decoded. Re-decoding `&amp;` here and
 *   re-escaping on output (see {@link formatMarkerAttributes}) would double-escape a value like
 *   `title="a &amp; b"` into `&amp;amp;` — this module never round-trips through a decoded form.
 *
 * @complexity O(n) in the marker's own attrs length (one regex pass) — independent of the surrounding
 * document's size.
 */
export function parseMarkerAttributes({ marker }: { marker: EmbedMarker }, _optional: Record<string, never> = {}): MarkerAttribute[] {
  const seenNames = new Set<string>();
  const attributes: MarkerAttribute[] = [];
  MARKER_ATTRIBUTE_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_ATTRIBUTE_TOKEN.exec(marker.attrs)) !== null) {
    const name = match[1]!.toLowerCase();
    if (name === "data-embed-config") continue;
    if (!MARKER_ATTRIBUTE_NAME_PATTERN.test(name)) continue;
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    const value = match[2] ?? match[3] ?? match[4] ?? null;
    attributes.push({ name, value });
  }
  return attributes;
}

/**
 * Formats parsed attributes back into attribute-string text, the inverse of
 * {@link parseMarkerAttributes}: a valueless attribute is emitted as a bare ` name`; a valued one as
 * ` name="value"`. The ONLY transform applied to a value is `"` -> `&quot;` (a value may itself
 * contain a literal `"`, e.g. carried over from a single-quoted authored attribute) — `&` is never
 * touched, so source text that already reads `&amp;` is emitted unchanged rather than
 * double-escaping into `&amp;amp;`.
 *
 * @complexity O(n) in the total length of every attribute's name and value.
 */
export function formatMarkerAttributes({ attrs }: { attrs: readonly MarkerAttribute[] }, _optional: Record<string, never> = {}): string {
  return attrs.map((attr) => (attr.value === null ? ` ${attr.name}` : ` ${attr.name}="${attr.value.replace(/"/g, "&quot;")}"`)).join("");
}

/** Whether a marker carries any authored attribute besides `data-embed-config` itself — the "bare
 *  marker" test {@link withElementKeptIfAttributed} uses to decide whether an element survives a
 *  whole-marker substitution.
 *
 * @complexity O(n) in the marker's own attrs length (delegates to {@link parseMarkerAttributes}).
 */
export function hasAuthoredAttributes({ marker }: { marker: EmbedMarker }, _optional: Record<string, never> = {}): boolean {
  return parseMarkerAttributes({ marker: marker }).length > 0;
}

/**
 * Rebuild a marker's element around new inner content using an EXPLICIT attribute list (rather than
 * the marker's own verbatim {@link EmbedMarker.attrs}) — for a caller that has partitioned a marker's
 * authored attributes and needs only a subset on the rebuilt wrapper (e.g. {@link substituteHtmlEmbeds}
 * moving media-element attribute names off a non-media wrapper onto the resolved `<video>`/`<img>`,
 * keeping the rest on the wrapper). The counterpart to {@link withInnerContent}, which always keeps
 * every authored attribute verbatim.
 */
export function withInnerContentAndAttributes(
  { marker, attrs, inner }: { marker: EmbedMarker; attrs: readonly MarkerAttribute[]; inner: string },
  _optional: Record<string, never> = {},
): string {
  return `<${marker.tag}${formatMarkerAttributes({ attrs: attrs })}>${inner}</${marker.tag}>`;
}

/**
 * Whole-element replace UNLESS the marker carries authored attributes, in which case its element
 * survives (minus `data-embed-config`) around the resolved content — the 2026-09-16 rule for marker
 * types (`widget`, `partial`) that default to disappearing entirely: a bare marker keeps disappearing,
 * byte-identical to before, while an attributed one keeps whatever styling/accessibility hook the
 * author put on it. Delegates to {@link withInnerContentFinal} for the attributed case so the kept
 * wrapper's attribute text is the marker's own verbatim {@link EmbedMarker.attrs} (not a
 * parse-then-reformat round trip) — the same byte-identical-when-nothing-moves discipline
 * {@link withInnerContentFinal} itself already provides.
 */
export function withElementKeptIfAttributed({ marker, inner }: { marker: EmbedMarker; inner: string }, _optional: Record<string, never> = {}): string {
  return hasAuthoredAttributes({ marker: marker }) ? withInnerContentFinal({ marker: marker, inner: inner }) : inner;
}

/**
 * Human-readable one-liner for a rejection, for a warning line or a write-time validation error.
 * Deliberately quotes the offending JSON: the author needs to see what they typed, and the raw text
 * is theme- or admin-authored, never end-user input.
 */
export function describeRejection({ rejection }: { rejection: EmbedMarkerRejection }, _optional: Record<string, never> = {}): string {
  const { problem, occurrence } = rejection;
  const where = `embed marker #${occurrence}`;
  if (problem.kind === "invalid-json") return `${where}: data-embed-config is not valid JSON (${problem.message}) — ${problem.raw}`;
  if (problem.kind === "not-an-object") return `${where}: data-embed-config must be a JSON object — ${problem.raw}`;
  return `${where}: data-embed-config is missing a "type" — ${problem.raw}`;
}
