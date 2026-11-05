import { parse, type DefaultTreeAdapterMap } from "parse5";
import { attr } from "./html-document.js";

type Node = DefaultTreeAdapterMap["node"];
type Range = { startOffset: number; endOffset: number };

/** Select whole elements before attributes; the ordered edit pass skips overlapping ranges. */
function presentationRange(node: DefaultTreeAdapterMap["element"], preserved: ReadonlySet<string>): Range | undefined {
  const location = node.sourceCodeLocation;
  if (!location) return undefined;
  const rel = (attr({ element: node, name: "rel" }) ?? "").toLowerCase().split(/\s+/);
  const href = attr({ element: node, name: "href" }) ?? "";
  if (node.tagName === "style") return location;
  if (node.tagName === "link" && rel.includes("stylesheet") && !preserved.has(href)) return location;
  return location.attrs?.style;
}

/** Iterative traversal includes inert template content without recursion or argument spreading. */
function* walk(root: Node): Generator<Node> {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    yield node;
    if ("childNodes" in node) for (const child of node.childNodes) pending.push(child);
    if ("content" in node) pending.push(node.content);
  }
}
/** Remove presentation using source ranges; untouched bytes (including comments) stay exact.
 * Scripts, classes and functional attributes are preserved. This is not an HTML sanitizer.
 * @param required.html - Document or fragment to transform; never mutated.
 * @param optional.preservedStylesheetHrefs - Exact hrefs retained for host sentinels/vendor CSS.
 * @returns HTML without style elements/attributes or unretained stylesheet links; no I/O.
 * @complexity O(n + p + r log r) time and O(n + p + r) space for HTML bytes n,
 * preserved href bytes p and removal ranges r.
 * @example stripHtmlPresentation({ html: '<p style="color:red">Hi</p>' })
 */
export function stripHtmlPresentation(
  { html }: { html: string },
  { preservedStylesheetHrefs = [] }: { preservedStylesheetHrefs?: readonly string[] } = {},
): string {
  const preserved = new Set(preservedStylesheetHrefs);
  const ranges: Range[] = [];
  for (const node of walk(parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false }))) {
    if (!("tagName" in node)) continue;
    const range = presentationRange(node, preserved);
    if (range) ranges.push(range);
  }
  ranges.sort((a, b) => a.startOffset - b.startOffset);
  const parts: string[] = [];
  let end = 0;
  for (const range of ranges) {
    if (range.startOffset < end) continue;
    parts.push(html.slice(end, range.startOffset));
    end = range.endOffset;
  }
  parts.push(html.slice(end));
  return parts.join("");
}
