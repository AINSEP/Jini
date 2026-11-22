/** @file Source-located HTML edits: find elements with their byte offsets and apply edits without re-serializing. */
import { parse, type DefaultTreeAdapterMap } from "parse5";

export type Element = DefaultTreeAdapterMap["element"];
export type Edit = { startOffset: number; endOffset: number; text: string };

/** Source locations keep theme scripts, formatting and root-relative paths byte-for-byte intact.
 * @complexity O(HTML bytes); iterative traversal includes template contents.
 */
export function elements({ html }: { html: string }, _options = {}): Element[] {
  const pending: DefaultTreeAdapterMap["node"][] = [parse(html, { sourceCodeLocationInfo: true })];
  const found: Element[] = [];
  while (pending.length) {
    const node = pending.pop();
    if (node === undefined) throw new Error("Static export HTML scan has no pending node");
    if ("childNodes" in node) pending.push(...node.childNodes);
    if ("tagName" in node) found.push(node);
    if ("content" in node) pending.push(node.content);
  }
  return found;
}

/** Apply disjoint edits from the end so offsets refer to the original source. */
export function editedHtml({ html, edits }: { html: string; edits: Edit[] }, _options = {}): string {
  const parts: string[] = [];
  let end = html.length;
  for (const edit of edits.sort((a, b) => b.startOffset - a.startOffset)) {
    parts.push(html.slice(edit.endOffset, end), edit.text);
    end = edit.startOffset;
  }
  parts.push(html.slice(0, end));
  return parts.reverse().join("");
}

export function attribute({ node, name }: { node: Element; name: string }, _options = {}): string | undefined {
  return node.attrs.find(attr => attr.name === name)?.value;
}
