import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

type MarkerEdit = { start: number; end: number; replacement: string };

/** JSON escapes keep an id containing a quote/ampersand literal inside a single-quoted
 * attribute. The shared scanner reads that quoting verbatim, without HTML decoding. */
function widgetMarkerConfig({ node }: { node: DefaultTreeAdapterMap["element"] }): string {
  const id = node.attrs.find((attr) => attr.name === "data-embed-id")?.value;
  return JSON.stringify({ type: "widget", ...(id !== undefined ? { id } : {}) })
    .replace(/'/g, "\\u0027").replace(/&/g, "\\u0026");
}

/** Remove the obsolete id together with its separating whitespace. */
function widgetIdEdit({ html, startOffset, endOffset }: { html: string; startOffset: number; endOffset: number }): MarkerEdit {
  let start = startOffset;
  while (start > 0 && /\s/.test(html[start - 1]!)) start -= 1;
  return { start, end: endOffset, replacement: "" };
}

/** Plan compatibility edits for one parsed element; unrelated/configured markers keep their contract. */
function widgetMarkerEdits({ html, node }: { html: string; node: DefaultTreeAdapterMap["element"] }): MarkerEdit[] {
  const type = node.attrs.find((attr) => attr.name === "data-embed-type");
  if (type?.value.toLowerCase() !== "widget") return [];
  const locations = node.sourceCodeLocation?.attrs;
  const typeLocation = locations?.["data-embed-type"];
  if (!typeLocation) return [];
  const hasConfig = node.attrs.some((attr) => attr.name === "data-embed-config");
  const edits: MarkerEdit[] = [{ start: typeLocation.startOffset, end: typeLocation.endOffset,
    replacement: hasConfig ? "" : `data-embed-config='${widgetMarkerConfig({ node })}'` }];
  const idLocation = locations?.["data-embed-id"];
  if (idLocation) edits.push(widgetIdEdit({ html, ...idLocation }));
  return edits;
}

/** Apply each original source range once; overlapping ranges cannot be safely spliced.
 * parse5 can reconstruct formatting elements with identical source locations.
 * @complexity O(e log e) time for sorting e edits, plus source-splicing costs.
 */
function applyMarkerEdits({ html, edits }: { html: string; edits: MarkerEdit[] }): string {
  const unique = new Map(edits.map((edit) => [`${edit.start}:${edit.end}`, edit]));
  let boundary = html.length;
  let output = html;
  for (const edit of [...unique.values()].sort((a, b) => b.start - a.start)) {
    if (edit.end > boundary) throw new Error("Overlapping legacy widget marker edits");
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
    boundary = edit.start;
  }
  return output;
}

/** Adapt the old CMS widget attributes to the shared JSON marker vocabulary at render time.
 * Source offsets preserve authored HTML; serialization would rewrite unrelated markup. parse5
 * keeps comments, script/style text and quoted attribute values out of the element scan.
 * Only widgets need this compatibility rule; other embed types keep the current contract. */
export function normalizeLegacyWidgetMarkers(
  { html }: { html: string },
  _optional: Record<string, never> = {},
): string {
  if (!/data-embed-type/i.test(html)) return html;
  const stack: DefaultTreeAdapterMap["childNode"][] = [...parseFragment(html, { sourceCodeLocationInfo: true }).childNodes];
  const edits: MarkerEdit[] = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (!("tagName" in node)) continue;
    stack.push(...node.childNodes);
    edits.push(...widgetMarkerEdits({ html, node }));
  }
  return applyMarkerEdits({ html, edits });
}
