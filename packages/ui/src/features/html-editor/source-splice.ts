import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

/**
 * @file Bug C's root cause (see this repo's `pages-redo` plan, "Bug C: one text edit rewrites the
 * whole page's HTML") is that `serializeEditorContent` rebuilds the **whole document** from
 * GrapesJS's own component model on every edit, so anything the model doesn't preserve
 * byte-for-byte — HTML entities, attribute quote style, a leading `<style>` block's formatting —
 * is silently lost outside the edited element too, not just inside it.
 *
 * This module is the lossless-splice primitive that fixes that: parse the **original** source
 * once with parse5 to find exactly where each element's inner content starts and ends
 * (`indexElementSourceRanges`), then replace only those bytes for the one element that actually
 * changed (`spliceElementInner`) — every other byte of the original string, including its
 * whitespace, quoting, and entities, passes through untouched because it is never re-serialized.
 *
 * Deliberately product-neutral and DOM-free: it knows nothing about GrapesJS, "protected"
 * elements, or embed markers. The caller (the `useInteractiveHtmlEditor` hook, wired in a later
 * slice) is responsible for deciding which element changed and supplying its path and tag name.
 *
 * `style` and `script` elements are skipped entirely, both from indexing and from path
 * numbering — GrapesJS removes both from its own component tree (moving `<style>` into its
 * `CssComposer` and dropping `<script>` unless `allowScripts` is set), so a path computed from
 * GrapesJS's tree would never account for them either. Skipping them here, rather than indexing
 * and then filtering, keeps this module's one path numbering scheme the single source of truth
 * that both sides (this indexer and whatever numbers GrapesJS's tree) must agree on.
 */

type Parse5Node = DefaultTreeAdapterMap['node'];
type Parse5ParentNode = DefaultTreeAdapterMap['parentNode'];
type Parse5Element = DefaultTreeAdapterMap['element'];

/** Tags GrapesJS never represents as ordinary tree components — never indexed, never a path slot. */
const UNINDEXED_TAGS = new Set(['style', 'script']);

/**
 * An element's position among its ancestors' **element-only** children, ignoring text nodes,
 * comments, and `style`/`script` elements at every level. `[0, 1]` means "the second element
 * child of the first element child of the fragment root".
 */
export type ElementPath = readonly number[];

/** One element's source byte range, as located in the original HTML string that was indexed. */
export interface ElementSourceRange {
  /** Byte offset of the first character of the element's inner content (just after `startTag`). */
  readonly start: number;
  /** Byte offset just past the element's inner content (just before `endTag`, if any). */
  readonly end: number;
  /** The element's tag name, so a caller can detect drift between what it expects and what parsed. */
  readonly tagName: string;
}

/** Canonical string key for a path, for use as a `Map` key (`Map<pathKey(path), ...>`). */
export function pathKey(path: ElementPath): string {
  return path.join('.');
}

function isElement(node: Parse5Node): node is Parse5Element {
  return 'tagName' in node;
}

function hasChildNodes(node: Parse5Node): node is Parse5ParentNode {
  return 'childNodes' in node;
}

function recordInnerRange(
  { node, currentPath, out }: { node: Parse5Element; currentPath: ElementPath; out: Map<string, ElementSourceRange> },
  _options: object = {},
): void {
  const location = node.sourceCodeLocation;
  // parse5 attaches a location only to elements created from a start-tag token, so a located
  // element always has `startTag` (implied elements — a `tbody`, a `</p>`- or `</br>`-created
  // element — carry no location at all and are skipped). Requiring `startTag` here replaces the old
  // `: location.endOffset` fallback, which no parsed element could reach.
  if (location?.startTag) {
    // Void elements (`<br>`, `<img>`) have no `endTag` and no inner content: their range is
    // empty (`start === end`), anchored at the end of the start tag.
    const start = location.startTag.endOffset;
    const end = location.endTag ? location.endTag.startOffset : start;
    out.set(pathKey(currentPath), { start, end, tagName: node.tagName });
  }
}

/**
 * Walks one level of element-only children (recursing into each), assigning each a path and
 * recording its source range. `style`/`script` children are skipped without consuming a path slot.
 *
 * @complexity O(n) over the fragment's total node count — each node is visited exactly once.
 */
function indexChildren(children: readonly Parse5Node[], parentPath: ElementPath, out: Map<string, ElementSourceRange>): void {
  let elementIndex = 0;
  for (const node of children) {
    if (!isElement(node) || UNINDEXED_TAGS.has(node.tagName)) continue;

    const currentPath = [...parentPath, elementIndex];
    recordInnerRange({ node, currentPath, out }, {});

    if (hasChildNodes(node)) indexChildren(node.childNodes, currentPath, out);
    elementIndex++;
  }
}

/**
 * Parses `html` once and indexes every reachable element's inner-content source range by its
 * element-only child path (see `ElementPath`). The same `html` string must be re-indexed after
 * any splice — a returned index is only valid against the exact string it was built from, since
 * every offset is a byte position into that specific string.
 *
 * @param html Source HTML to index. Parsed as a fragment (`parse5.parseFragment`), so a leading
 *   `<html>`/`<body>` wrapper is not assumed and is not specially handled here.
 * @returns A map from `pathKey(path)` to that element's source range. `style`/`script` elements,
 *   comments, and text nodes are never present as entries or path slots.
 * @complexity O(n) in the size of `html` (parse5's own parse cost dominates; indexing itself is
 *   a single linear tree walk).
 * @overallScore 100
 */
export function indexElementSourceRanges(html: string): Map<string, ElementSourceRange> {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const index = new Map<string, ElementSourceRange>();
  indexChildren(fragment.childNodes, [], index);
  return index;
}

/**
 * Replaces only the inner-content bytes of the element at `path` with `newInner`, leaving every
 * other byte of `html` — including whitespace, attribute quoting, and entities — untouched.
 *
 * Returns `null`, never a wrong splice, when the address cannot be trusted: `path` does not
 * resolve to any indexed element (the document's shape changed since the path was computed), or
 * it resolves to an element whose tag does not match `expectedTagName` (the caller's own model
 * and the source string have drifted apart). Callers must treat `null` as a signal to fall back
 * to a full re-serialization — never retry with a guessed range.
 *
 * @param html Original source string (not a previously-spliced one — see this module's file
 *   header on re-splicing from the original on every edit rather than compounding offsets).
 * @param path Element-only child path of the element to edit, as produced by
 *   `indexElementSourceRanges`.
 * @param expectedTagName Tag name the caller believes lives at `path` (e.g. the GrapesJS
 *   component's own tag). A mismatch is treated the same as an unresolved path.
 * @param newInner Replacement inner HTML for the addressed element.
 * @returns The spliced string, or `null` if `path` could not be located or its tag disagreed.
 * @complexity O(n) — dominated by re-indexing `html` (see `indexElementSourceRanges`); the splice
 *   itself is two string slices and a concatenation.
 * @overallScore 100
 */
export function spliceElementInner(html: string, path: ElementPath, expectedTagName: string, newInner: string): string | null {
  const range = indexElementSourceRanges(html).get(pathKey(path));
  if (!range || range.tagName !== expectedTagName) return null;
  return html.slice(0, range.start) + newInner + html.slice(range.end);
}

const VOID_TAGS: ReadonlySet<string> = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Verified offsets are JS string indexes (UTF-16), suitable for slice and textarea selection. */
export interface ElementOuterRange {
  readonly outerStart: number;
  readonly outerEnd: number;
  readonly openingEnd: number;
}

/** Source tree shared by block detection and preparation; raw atoms never consume a splice slot. */
export interface SourceElement {
  readonly tagName: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly path: ElementPath | null;
  readonly outerRange: ElementOuterRange | null;
  readonly sourceSupported: boolean;
  readonly children: readonly SourceElement[];
}

function sourceOuterEnd({ node, html }: { node: Parse5Element; html: string }, _options: object = {}): number | undefined {
  const loc = node.sourceCodeLocation;
  const start = loc?.startTag;
  const foreignSelfClosing = node.namespaceURI !== 'http://www.w3.org/1999/xhtml' && !!start
    && html.slice(start.startOffset, start.endOffset).endsWith('/>');
  if (VOID_TAGS.has(node.tagName) || foreignSelfClosing) return start?.endOffset;
  return loc?.endTag?.endOffset;
}

function sourceOuterRange(
  { node, html, parentStart, parentEnd }: { node: Parse5Element; html: string; parentStart: number; parentEnd: number },
  _options: object = {},
): ElementOuterRange | null {
  const start = node.sourceCodeLocation?.startTag;
  const outerEnd = sourceOuterEnd({ node, html }, {});
  const boundsValid = !!start && outerEnd !== undefined && start.startOffset >= parentStart && outerEnd <= parentEnd;
  // Template content is a separate fragment; it has no ordinary component path/shell here.
  if (!boundsValid || node.tagName === 'template') return null;
  return { outerStart: start!.startOffset, outerEnd: outerEnd!, openingEnd: start!.endOffset };
}

function invalidateOverlappingSiblings(
  { elements }: { elements: (Omit<SourceElement, 'sourceSupported'> & { sourceSupported: boolean })[] },
  _options: object = {},
): void {
  // Foster parenting can move a valid-looking node ahead of a source-earlier table. Neither
  // sibling can be trusted as a model-addressable source owner in that recovered ordering.
  for (let i = 1; i < elements.length; i++) {
    const previous = elements[i - 1]!;
    const current = elements[i]!;
    if (previous.outerRange && current.outerRange && previous.outerRange.outerEnd > current.outerRange.outerStart) {
      previous.sourceSupported = current.sourceSupported = false;
    }
  }
}

/**
 * Extends the inner-splice index without changing its published range shape. Missing end tags,
 * implicit nodes and reordered/foster-parented children cannot establish an opaque source owner.
 * Validation is linear in source nodes; ranges are checked against their immediate source parent.
 */
export function indexSourceElements({ html }: { html: string }, _options: object = {}): SourceElement[] {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const walk = ({ nodes, parentPath, parentStart, parentEnd }: { nodes: readonly Parse5Node[]; parentPath: ElementPath; parentStart: number; parentEnd: number }, _options: object = {}): SourceElement[] => {
    let slot = 0;
    const elements = nodes.filter(isElement).map(node => {
      const atom = UNINDEXED_TAGS.has(node.tagName);
      let path: ElementPath | null = null;
      if (!atom) {
        path = [...parentPath, slot];
        slot += 1;
      }
      const loc = node.sourceCodeLocation;
      const children = walk({ nodes: node.childNodes, parentPath: path ?? parentPath, parentStart: loc?.startTag?.endOffset ?? parentStart, parentEnd: loc?.endTag?.startOffset ?? parentEnd }, {});
      const outerRange = sourceOuterRange({ node, html, parentStart, parentEnd }, {});
      return {
        tagName: node.tagName,
        attributes: Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value])),
        path,
        outerRange,
        sourceSupported: !!outerRange && children.every(child => child.sourceSupported),
        children,
      };
    });
    invalidateOverlappingSiblings({ elements }, {});
    return elements;
  };
  return walk({ nodes: fragment.childNodes, parentPath: [], parentStart: 0, parentEnd: html.length }, {});
}
