import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

type Element = DefaultTreeAdapterMap["element"];
type Edit = { start: number; end: number; replacement: string };

function legacyConfigAttribute(id: string | undefined): string {
  // JSON's own escapes keep an id containing a quote/ampersand literal inside a single-quoted
  // attribute. The shared scanner intentionally reads that quoting verbatim, without HTML decoding.
  const config = JSON.stringify({ type: "widget", ...(id !== undefined ? { id } : {}) })
    .replace(/'/g, "\\u0027").replace(/&/g, "\\u0026");
  return `data-embed-config='${config}'`;
}

/** Remove an attribute together with the whitespace that separated it from its predecessor. */
function attributeRemovalEdit({ html, start, end }: { html: string; start: number; end: number }): Edit {
  while (start > 0 && /\s/.test(html[start - 1]!)) start -= 1;
  return { start, end, replacement: "" };
}

/** Edits that turn one legacy widget element's attributes into the JSON marker vocabulary. */
function legacyWidgetEdits({ html, node }: { html: string; node: Element }): Edit[] {
  const type = node.attrs.find((attr) => attr.name === "data-embed-type");
  if (type?.value.toLowerCase() !== "widget") return [];
  const locations = node.sourceCodeLocation?.attrs;
  const typeLocation = locations?.["data-embed-type"];
  if (!typeLocation) return [];
  const id = node.attrs.find((attr) => attr.name === "data-embed-id")?.value;
  const hasConfig = node.attrs.some((attr) => attr.name === "data-embed-config");
  const edits: Edit[] = [{ start: typeLocation.startOffset, end: typeLocation.endOffset,
    replacement: hasConfig ? "" : legacyConfigAttribute(id) }];
  const idLocation = locations["data-embed-id"];
  if (idLocation) edits.push(attributeRemovalEdit({ html, start: idLocation.startOffset, end: idLocation.endOffset }));
  return edits;
}

function applyEdits({ html, edits }: { html: string; edits: Edit[] }): string {
  let output = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
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
  const edits: Edit[] = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (!("tagName" in node)) continue;
    stack.push(...node.childNodes);
    edits.push(...legacyWidgetEdits({ html, node }));
  }
  return applyEdits({ html, edits });
}
