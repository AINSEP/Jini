import type { JsonValue, JsonObject } from "@jini-ai/core/primitives";
import { isNonArrayRecord } from "@jini-ai/core/records";
import { safeTextAlign } from "./style-values.js";

/**
 * Flattens a doc node's nested inline content down to its plain text — the heading label as a reader
 * sees it, with `bold`/`italic`/`link` marks and any other inline wrapper structure discarded. Used
 * only to derive {@link headingAnchorId}; the visible heading still renders through the normal
 * `renderNodes` path with all its markup intact.
 */
function nodeText(node: JsonValue): string {
  if (!isNonArrayRecord({ value: node })) return "";
  const record = node as JsonObject;
  if (typeof record.text === "string") return record.text;
  const content = Array.isArray(record.content) ? record.content : [];
  return content.map(nodeText).join("");
}

/**
 * The `id` a rendered heading carries so an in-page `#anchor` link has something to land on.
 *
 * Uses the host's injected `toSlug` rule for post slugs rather than a second slug
 * dialect — a heading's anchor and a post's slug should not disagree about what "C++ & Rust"
 * becomes. ASCII headings keep exactly the anchors they always had; headings with non-ASCII letters
 * now transliterate (`#caf` became `#cafe` on 2026-09-28). Returns `""` for a heading whose text
 * slugifies to nothing (emoji-only, punctuation-only, CJK);
 * the caller then emits no `id` rather than an empty one, since `id=""` is invalid and unlinkable
 * anyway.
 */
export function headingAnchorId({ node, toSlug }: { node: JsonValue; toSlug: (required: { text: string }, optional?: Record<string, never>) => string }, _optional: Record<string, never> = {}): string {
  return toSlug({ text: nodeText(node) });
}

/**
 * Suffixes repeated heading ids within ONE rendered document (`overview`, `overview-2`, `overview-3`).
 *
 * Runs as a pass over the finished `doc` HTML rather than being threaded through `renderDocNode` as
 * an accumulator parameter, for two reasons: `renderDocNode` is exported and its signature is
 * depended on by host render workers and direct test calls, and a document is the only scope where
 * "duplicate" is even meaningful — two posts may each legitimately have an `#overview`.
 *
 * Only ids this renderer just generated are touched. The pattern is anchored to a heading tag with
 * `id` as its FIRST attribute, which is exactly the shape the `heading` case emits and is not a shape
 * authored content can reach (doc nodes cannot carry raw HTML attributes), so no author-supplied
 * markup is rewritten by this.
 * Checks every candidate against emitted ids, including literal suffixed slugs such as `foo-2`.
 * Additional heading attributes (such as alignment styles) remain untouched.
 *
 * @complexity O(L + P) time for L HTML characters and P candidate-id checks; O(H) auxiliary space
 * for H headings. Per-base counters keep repeated headings from restarting the suffix search.
 */
export function dedupeHeadingIds({ html }: { html: string }, _optional = {}): string {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return html.replace(/<h([1-6]) id="([^"]*)"(?=[\s>])/g, (_m, level: string, id: string) => {
    let count = (seen.get(id) ?? 0) + 1;
    let uniqueId = count === 1 ? id : `${id}-${count}`;
    while (used.has(uniqueId)) {
      count += 1;
      uniqueId = `${id}-${count}`;
    }
    seen.set(id, count);
    used.add(uniqueId);
    return `<h${level} id="${uniqueId}"`;
  });
}

/**
 * `text-align` inline style for a `textAlign` attr value (`@tiptap/extension-text-align`, admin
 * editor toolbar, 2026-08-11). `"left"` (the CSS/HTML default), `null`, and any other
 * value this renderer doesn't recognize are never emitted as an explicit attribute — same "optional,
 * omit rather than emit a no-op" convention {@link renderImageTag}'s width/height/class already
 * follow.
 *
 * Goes through {@link safeTextAlign}'s fixed keyword allowlist, not `escapeHtml` — `escapeHtml`
 * stops the value from breaking OUT of the `style="…"` attribute (a stray `"`), but a value that
 * stays inside the quotes and smuggles a second declaration (`"center;position:fixed"`) passes
 * `escapeHtml` completely unchanged.
 *
 * @complexity O(1).
 */
export function styleForAlign({ align }: { align: string | null }, _optional = {}): string {
  if (align === null) return "";
  const safe = safeTextAlign({ value: align });
  return safe ? ` style="text-align:${safe}"` : "";
}

/** {@link styleForAlign} read directly off a doc node's own `attrs.textAlign` — the `paragraph` and
 *  `heading` cases below share this shape; {@link extractTitleNode}'s caller reads the same attr off
 *  an already-extracted node instead, since it needs the node's inline content too. */
export function alignStyleAttr({ node }: { node: JsonObject }, _optional = {}): string {
  const align = isNonArrayRecord({ value: node.attrs }) && typeof (node.attrs as JsonObject).textAlign === "string" ? (node.attrs as JsonObject).textAlign as string : null;
  return styleForAlign({ align });
}

/**
 * `text-align` inline style for a `tableCell`/`tableHeader` node's own `attrs.align`
 * (`@tiptap/extension-table`, 2026-08-11) — narrower than {@link alignStyleAttr}: a table cell's own
 * `normalizeTableCellAlign` (confirmed against the installed dist) only ever produces `"left"`,
 * `"center"`, `"right"`, or `null` — never `"justify"`, which makes little sense for a single cell's
 * content anyway. Re-checked here rather than trusted, same defense-in-depth reasoning every other
 * attrs-derived value in this file gets: `bodyJson` can be written by a direct API call, not only by
 * the editor UI that happens to constrain it client-side.
 */
export function tableCellAlignAttr({ node }: { node: JsonObject }, _optional = {}): string {
  const align = isNonArrayRecord({ value: node.attrs }) && typeof (node.attrs as JsonObject).align === "string" ? (node.attrs as JsonObject).align as string : null;
  return align === "left" || align === "center" || align === "right" ? styleForAlign({ align }) : "";
}

/**
 * `colspan`/`rowspan` HTML attributes for a `tableCell`/`tableHeader` node, each independently
 * bounds-checked and defaulted to `1` (both nodes' own `addAttributes` default, confirmed against
 * the installed dist) — omitted entirely when `1`, since `colspan="1"`/`rowspan="1"` is the HTML
 * default and writing it out is noise, matching this file's own "omit rather than emit a no-op"
 * convention ({@link styleForAlign}, {@link renderImageTag}'s width/height/class). The `<= 1000`
 * ceiling is a defensive bound, not a real table's expected shape — `bodyJson` is written by a
 * direct API call as easily as by the editor, and an unbounded `colspan` is a cheap way to force a
 * huge rendered table.
 */
/** Shared bounds check {@link tableSpanAttrs} applies independently to `colspan`/`rowspan` — pulled
 *  out so the compound condition is written (and complexity-counted) once instead of twice. */
function parseSpanAttr({ value }: { value: JsonValue | undefined }, _optional = {}): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 1;
  return value >= 1 && value <= 1000 ? value : 1;
}

export function tableSpanAttrs({ attrs }: { attrs: JsonObject }, _optional = {}): string {
  const colspan = parseSpanAttr({ value: attrs.colspan });
  const rowspan = parseSpanAttr({ value: attrs.rowspan });
  const columnAttribute = colspan !== 1 ? ` colspan="${colspan}"` : "";
  const rowAttribute = rowspan !== 1 ? ` rowspan="${rowspan}"` : "";
  return columnAttribute + rowAttribute;
}
