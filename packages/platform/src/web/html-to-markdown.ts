import { parse, type DefaultTreeAdapterMap } from "parse5";
import { fromParse5 } from "hast-util-from-parse5";
import { defaultHandlers, toMdast } from "hast-util-to-mdast";
import { toMarkdown, type Handle } from "mdast-util-to-markdown";
import { gfmTableToMarkdown } from "mdast-util-gfm-table";
import { boundHtml } from "./html-resource.js";
import { absolute, ASSET_PROTOCOLS, attr, imageSource, LINK_PROTOCOLS } from "./html-document.js";

/**
 * @file Public-page Markdown adapter, injected through `WebFetchPorts.htmlToMarkdown`.
 * parse5 owns HTML recovery; the syntax-tree libraries own Markdown structure. Raw text retains the reader contract.
 * Preparation only enforces the page reader's URL, visibility and resource contracts.
 */
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const SKIPPED = new Set(["head", "script", "style", "noscript", "template", "svg", "iframe", "object", "canvas", "select", "input", "textarea"]);
/** Beyond this nesting, a subtree degrades to its plain text instead of recursing further. */
const MAX_DEPTH = 300;

/** Narrow a parser node before accessing element attributes. */
function isElement(node: Node): node is Element {
  return "tagName" in node;
}

/** Iterative so a degraded, very deep subtree cannot overflow the stack either. O(subtree nodes). */
function plainText(root: Node): string {
  const pending = [root];
  const parts: string[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.nodeName === "#text" && "value" in node) parts.push(node.value);
    else if ("childNodes" in node && !(isElement(node) && SKIPPED.has(node.tagName))) {
      for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]!);
    }
  }
  return parts.join("").replace(/\s+/g, " ");
}

/** Resolve the document base before preparation drops the invisible head. O(head nodes). */
function documentBase(document: DefaultTreeAdapterMap["document"], pageUrl: string): string {
  const head = document.childNodes.find(isElement)?.childNodes.find(node => isElement(node) && node.tagName === "head");
  const base = head && isElement(head) ? head.childNodes.find(node => isElement(node) && node.tagName === "base") : undefined;
  return absolute({ raw: base && isElement(base) ? attr({ element: base, name: "href" }) : undefined, base: pageUrl, protocols: ASSET_PROTOCOLS }) ?? pageUrl;
}

/** Normalize reader URLs using the same owner as page facts; mutate only the freshly parsed tree. */
function prepareElement(element: Element, base: string): void {
  const href = element.tagName === "a" ? absolute({ raw: attr({ element, name: "href" }), base, protocols: LINK_PROTOCOLS }) : undefined;
  const src = element.tagName === "img" ? absolute({ raw: imageSource({ img: element }), base, protocols: ASSET_PROTOCOLS }) : undefined;
  // HTML must not supply the library's data-mdast override: it can inject arbitrary Markdown nodes.
  // The old reader ignored table spans; retaining that contract also prevents hostile span expansion.
  element.attrs = element.attrs.filter(attribute => !attribute.name.startsWith("data-mdast") && !["colspan", "rowspan"].includes(attribute.name));
  if (element.tagName === "table") promoteFirstRow(element);
  if (element.tagName === "a" || element.tagName === "img") {
    element.attrs = element.attrs.filter(attribute => !["href", "src", "title"].includes(attribute.name));
    if (href) element.attrs.push({ name: "href", value: href });
    if (src) element.attrs.push({ name: "src", value: src });
    if (element.tagName === "img") {
      const alt = element.attrs.find(attribute => attribute.name === "alt");
      if (alt) alt.value = alt.value.replace(/\s+/g, " ").trim();
    }
  }
}

/** The existing reader treats the first row as the header, including tables made only of td cells. */
function promoteFirstRow(table: Element): void {
  const pending = [...table.childNodes].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (!isElement(node) || node.tagName === "table") continue;
    if (node.tagName === "tr") {
      for (const cell of node.childNodes) {
        if (isElement(cell) && cell.tagName === "td") { cell.tagName = "th"; cell.nodeName = "th"; }
      }
      return;
    }
    for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]!);
  }
}

/** Drop invisible subtrees and images with no usable URL before the bridge sees them. */
function readable(node: Node, base: string): boolean {
  if (node.nodeName === "#comment" || node.nodeName === "#documentType") return false;
  if (!isElement(node)) return true;
  if (SKIPPED.has(node.tagName)) return false;
  return node.tagName !== "img" || absolute({ raw: imageSource({ img: node }), base, protocols: ASSET_PROTOCOLS }) !== undefined;
}

/** Move whitespace outside attention before serialization; empty attention is plain whitespace.
 * Only this newly parsed tree is mutated. Nested inline wrappers retain their formatting.
 */
function attentionChildren(parent: Element): void {
  parent.childNodes = parent.childNodes.flatMap(node => {
    if (!isElement(node) || !["b", "strong", "i", "em"].includes(node.tagName)) return [node];
    const boundary = (last: boolean): DefaultTreeAdapterMap["textNode"] | undefined => {
      let edge: Node | undefined = node;
      while (edge && isElement(edge)) edge = last ? edge.childNodes.at(-1) : edge.childNodes[0];
      return edge?.nodeName === "#text" && "value" in edge ? edge : undefined;
    };
    const first = boundary(false);
    const leading = first?.value.match(/^\s+/)?.[0] ?? "";
    if (first) first.value = first.value.slice(leading.length);
    const last = boundary(true);
    const trailing = last?.value.match(/\s+$/)?.[0] ?? "";
    if (last && trailing) last.value = last.value.slice(0, -trailing.length);
    const text = (value: string): DefaultTreeAdapterMap["textNode"] => ({ nodeName: "#text", value, parentNode: parent });
    const descendants = [...node.childNodes];
    let image = false;
    while (descendants.length && !image) {
      const child = descendants.pop()!;
      if (isElement(child) && child.tagName === "img") image = true;
      else if ("childNodes" in child) descendants.push(...child.childNodes);
    }
    // No marker pair is emitted when whitespace was the entire content.
    return [...(leading ? [text(leading)] : []), ...(plainText(node).trim() || image ? [node] : []), ...(trailing ? [text(trailing)] : [])];
  });
}

/** Internal HAST text walk: retain code whitespace before the bridge minifies its cloned tree. */
type ReaderNode = { type: string; value?: string; children?: readonly ReaderNode[]; tagName?: string };
function hastText(root: ReaderNode): string {
  const pending = [root];
  const parts: string[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "text") parts.push(node.value ?? "");
    else if (node.children) for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]!);
  }
  return parts.join("");
}

/** A prepared anchor is visible when it contains text or a usable image, even without alt text.
 * Preparation already removed unsafe images. O(descendant nodes) time/space, with early exit.
 */
function hasVisibleAnchorContent({ node }: { node: ReaderNode }, _options: Record<string, never> = {}): boolean {
  const pending = [node];
  while (pending.length) {
    const child = pending.pop()!;
    if (child.type === "text" && child.value?.trim()) return true;
    if (child.type === "element" && child.tagName === "img") return true;
    if (child.children) pending.push(...child.children);
  }
  return false;
}

/** Reader attention never rewrites neighbouring letters into character references. */
const readerAttention: Handle = (node, _parent, state, info) => {
  const marker = node.type === "strong" ? "**" : "*";
  const exit = state.enter(node.type === "strong" ? "strong" : "emphasis");
  const tracker = state.createTracker(info);
  tracker.move(marker);
  const value = state.containerPhrasing(node, { ...tracker.current(), before: marker, after: marker });
  exit();
  return marker + value + marker;
};

/**
 * Bound depth BEFORE the recursive parse5-to-hast bridge and the library's tree walks.
 * O(nodes) time/space; discarded deep subtrees are scanned once for their visible text.
 * The input is a newly allocated parser tree, never caller state.
 */
function prepare(document: DefaultTreeAdapterMap["document"], base: string): void {
  const pending: Array<{ node: Node; depth: number; prepared?: boolean }> = [{ node: document, depth: 0 }];
  while (pending.length) {
    const { node, depth, prepared } = pending.pop()!;
    if (prepared) { if (isElement(node)) attentionChildren(node); continue; }
    if (isElement(node)) {
      prepareElement(node, base);
      if (depth > MAX_DEPTH) {
        const text = plainText(node);
        node.tagName = "span";
        node.nodeName = "span";
        node.attrs = [];
        node.childNodes = [{ nodeName: "#text", value: text, parentNode: node }];
        continue;
      }
    }
    if (!("childNodes" in node)) continue;
    node.childNodes = node.childNodes.filter(child => readable(child, base));
    pending.push({ node, depth, prepared: true });
    for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push({ node: node.childNodes[i]!, depth: depth + 1 });
  }
}

/**
 * Convert untrusted HTML to readable Markdown with absolute, allowlisted link/image URLs.
 * @returns Markdown without surrounding whitespace; input is capped before parsing and errors propagate.
 * @complexity O(nodes + output size) time/space for ordinary pages; nesting is bounded at 300.
 * @example htmlToMarkdown({ html: "<h1>Hello</h1>", pageUrl: "https://example.com/" })
 */
export function htmlToMarkdown({ html, pageUrl }: { html: string; pageUrl: string }, _optional: Record<string, never> = {}): string {
  const document = parse(boundHtml({ html }).html);
  prepare(document, documentBase(document, pageUrl));
  const hast = fromParse5(document);
  const pending: ReaderNode[] = [hast];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "element" && node.tagName === "code") (node as ReaderNode & { data?: { readerInlineCode: string } }).data = { readerInlineCode: hastText(node) };
    if (node.children) pending.push(...node.children);
  }
  const markdown = toMdast(hast, {
    document: true,
    handlers: {
      a: (state, node) => node.properties.href && hasVisibleAnchorContent({ node }) ? defaultHandlers.a!(state, node) : state.all(node),
      code: (state, node) => {
        const result = { type: "inlineCode" as const, value: String((node.data as { readerInlineCode?: string } | undefined)?.readerInlineCode ?? "") };
        state.patch(node, result);
        return result;
      },
      // Strikethrough was plain text in this reader; no extra GFM serialization extension is needed.
      del: (state, node) => state.all(node),
      s: (state, node) => state.all(node),
      strike: (state, node) => state.all(node),
      audio: (state, node) => state.all(node),
      video: (state, node) => state.all(node),
    },
  });
  // Preparation moves whitespace out of emphasis; handlers preserve raw reader text.
  // A nested list is indented by its parent item, including every continuation line.
  // The serializer owns blank-line runs and inline spaces; code fences/list indents stay verbatim.
  return toMarkdown(markdown, {
    emphasis: "*", bullet: "-", listItemIndent: "one", fences: true,
    rule: "-", ruleRepetition: 3, ruleSpaces: false,
    extensions: [gfmTableToMarkdown({ tableCellPadding: true, tablePipeAlign: false }), {
      handlers: {
        // The reader never escaped ordinary Markdown punctuation; only table pipes need escaping.
        text: (node, _parent, state) => state.stack.includes("tableCell") ? node.value.replace(/\|/g, "\\|") : node.value,
        strong: readerAttention, emphasis: readerAttention,
      },
    }],
  }).trim();
}
