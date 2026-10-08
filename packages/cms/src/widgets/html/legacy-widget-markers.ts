import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

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
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (!("tagName" in node)) continue;
    stack.push(...node.childNodes);
    const type = node.attrs.find((attr) => attr.name === "data-embed-type");
    if (type?.value.toLowerCase() !== "widget") continue;
    const locations = node.sourceCodeLocation?.attrs;
    const typeLocation = locations?.["data-embed-type"];
    if (!typeLocation) continue;
    const id = node.attrs.find((attr) => attr.name === "data-embed-id")?.value;
    const hasConfig = node.attrs.some((attr) => attr.name === "data-embed-config");
    // JSON's own escapes keep an id containing a quote/ampersand literal inside a single-quoted
    // attribute. The shared scanner intentionally reads that quoting verbatim, without HTML decoding.
    const config = JSON.stringify({ type: "widget", ...(id !== undefined ? { id } : {}) })
      .replace(/'/g, "\\u0027").replace(/&/g, "\\u0026");
    edits.push({ start: typeLocation.startOffset, end: typeLocation.endOffset,
      replacement: hasConfig ? "" : `data-embed-config='${config}'` });
    const idLocation = locations?.["data-embed-id"];
    if (idLocation) {
      let start = idLocation.startOffset;
      while (start > 0 && /\s/.test(html[start - 1]!)) start -= 1;
      edits.push({ start, end: idLocation.endOffset, replacement: "" });
    }
  }
  let output = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  return output;
}
