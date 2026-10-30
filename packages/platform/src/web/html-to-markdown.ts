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

/** A node's children for {@link plainText}; skipped elements and leaves contribute none. */
function scannableChildren(node: Node): readonly Node[] {
  if (!("childNodes" in node) || (isElement(node) && SKIPPED.has(node.tagName))) return [];
  return node.childNodes;
}

/** Iterative so a degraded, very deep subtree cannot overflow the stack either. O(subtree nodes). */
function plainText(root: Node): string {
  const pending = [root];
  const parts: string[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.nodeName === "#text" && "value" in node) {
      parts.push(node.value);
      continue;
    }
    const children = scannableChildren(node);
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]!);
  }
  return parts.join("").replace(/\s+/g, " ");
}

/** First child element with this tag; the HTML parser always synthesizes html and head. */
function childElement({ parent, tagName }: { parent: Element; tagName: string }, _options: Record<string, never> = {}): Element | undefined {
  return parent.childNodes.find((node): node is Element => isElement(node) && node.tagName === tagName);
}

/** Resolve the document base before preparation drops the invisible head. O(head nodes). */
function documentBase(document: DefaultTreeAdapterMap["document"], pageUrl: string): string {
  const head = childElement({ parent: document.childNodes.find(isElement)!, tagName: "head" })!;
  const base = childElement({ parent: head, tagName: "base" });
  return absolute({ raw: base ? attr({ element: base, name: "href" }) : undefined, base: pageUrl, protocols: ASSET_PROTOCOLS }) ?? pageUrl;
}

/** Normalize reader URLs using the same owner as page facts; mutate only the freshly parsed tree. */
function prepareElement(element: Element, base: string): void {
  // HTML must not supply the library's data-mdast override: it can inject arbitrary Markdown nodes.
  // The old reader ignored table spans; retaining that contract also prevents hostile span expansion.
  element.attrs = element.attrs.filter(attribute => !attribute.name.startsWith("data-mdast") && !["colspan", "rowspan"].includes(attribute.name));
  if (element.tagName === "table") promoteFirstRow(element);
  if (element.tagName === "a") replaceUrlAttribute({ element, name: "href", value: absolute({ raw: attr({ element, name: "href" }), base, protocols: LINK_PROTOCOLS }) });
  if (element.tagName === "img") {
    replaceUrlAttribute({ element, name: "src", value: absolute({ raw: imageSource({ img: element }), base, protocols: ASSET_PROTOCOLS }) });
    const alt = element.attrs.find(attribute => attribute.name === "alt");
    if (alt) alt.value = alt.value.replace(/\s+/g, " ").trim();
  }
}

/** Links and images keep only their normalized URL: raw href/src/title never reach the bridge. */
function replaceUrlAttribute({ element, name, value }: { element: Element; name: "href" | "src"; value: string | undefined }, _options: Record<string, never> = {}): void {
  element.attrs = element.attrs.filter(attribute => !["href", "src", "title"].includes(attribute.name));
  if (value) element.attrs.push({ name, value });
}

/** The existing reader treats the first row as the header, including tables made only of td cells. */
function promoteFirstRow(table: Element): void {
  for (const cell of firstRow({ table })?.childNodes ?? []) {
    if (isElement(cell) && cell.tagName === "td") { cell.tagName = "th"; cell.nodeName = "th"; }
  }
}

/** Document-order search that never descends into a nested table, whose rows are its own. */
function firstRow({ table }: { table: Element }, _options: Record<string, never> = {}): Element | undefined {
  const pending = [...table.childNodes].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (!isElement(node) || node.tagName === "table") continue;
    if (node.tagName === "tr") return node;
    for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]!);
  }
  return undefined;
}

/** Drop invisible subtrees and images with no usable URL before the bridge sees them. */
function readable(node: Node, base: string): boolean {
  if (node.nodeName === "#comment" || node.nodeName === "#documentType") return false;
  if (!isElement(node)) return true;
  if (SKIPPED.has(node.tagName)) return false;
  return node.tagName !== "img" || absolute({ raw: imageSource({ img: node }), base, protocols: ASSET_PROTOCOLS }) !== undefined;
}

const ATTENTION: ReadonlySet<string> = new Set(["b", "strong", "i", "em"]);

/** Move whitespace outside attention before serialization; empty attention is plain whitespace.
 * Only this newly parsed tree is mutated. Nested inline wrappers retain their formatting.
 */
function attentionChildren(parent: Element): void {
  parent.childNodes = parent.childNodes.flatMap(node => isElement(node) && ATTENTION.has(node.tagName) ? splitAttention({ node, parent }) : [node]);
}

function splitAttention({ node, parent }: { node: Element; parent: Element }, _options: Record<string, never> = {}): Element["childNodes"] {
  const leading = takeEdgeWhitespace({ node, last: false });
  const trailing = takeEdgeWhitespace({ node, last: true });
  const text = (value: string): DefaultTreeAdapterMap["textNode"] => ({ nodeName: "#text", value, parentNode: parent });
  // No marker pair is emitted when whitespace was the entire content.
  const kept = plainText(node).trim() || containsImage({ node }) ? [node] : [];
  return [...(leading ? [text(leading)] : []), ...kept, ...(trailing ? [text(trailing)] : [])];
}

/** Removes and returns the whitespace at one edge of the subtree's first/last text node. */
function takeEdgeWhitespace({ node, last }: { node: Element; last: boolean }, _options: Record<string, never> = {}): string {
  const edge = edgeText({ node, last });
  if (!edge) return "";
  const value = edge.value;
  // trimStart/trimEnd strip exactly the characters `\s` matches.
  const kept = last ? value.trimEnd() : value.trimStart();
  edge.value = kept;
  return last ? value.slice(kept.length) : value.slice(0, value.length - kept.length);
}

/** The first/last leaf of the subtree when it is a text node. */
function edgeText({ node, last }: { node: Element; last: boolean }, _options: Record<string, never> = {}): DefaultTreeAdapterMap["textNode"] | undefined {
  let edge: Node | undefined = node;
  while (edge && isElement(edge)) edge = last ? edge.childNodes.at(-1) : edge.childNodes[0];
  return edge?.nodeName === "#text" && "value" in edge ? edge : undefined;
}

/** Iterative descendant search with early exit. */
function containsImage({ node }: { node: Element }, _options: Record<string, never> = {}): boolean {
  const descendants = [...node.childNodes];
  while (descendants.length) {
    const child = descendants.pop()!;
    if (isElement(child) && child.tagName === "img") return true;
    if ("childNodes" in child) descendants.push(...child.childNodes);
  }
  return false;
}

/** Internal HAST text walk: retain code whitespace before the bridge minifies its cloned tree. */
type ReaderNode = { type: string; value?: string; children?: readonly ReaderNode[]; tagName?: string };
function hastText(root: ReaderNode): string {
  const pending = [root];
  const parts: string[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    // HAST text nodes always carry a value.
    if (node.type === "text") {
      parts.push(node.value!);
      continue;
    }
    if (node.children) for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]!);
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

type PendingNode = { node: Node; depth: number; prepared?: boolean };

/**
 * Bound depth BEFORE the recursive parse5-to-hast bridge and the library's tree walks.
 * O(nodes) time/space; discarded deep subtrees are scanned once for their visible text.
 * The input is a newly allocated parser tree, never caller state.
 */
function prepare(document: DefaultTreeAdapterMap["document"], base: string): void {
  const pending: PendingNode[] = [{ node: document, depth: 0 }];
  while (pending.length) {
    const entry = pending.pop()!;
    // A node's attention is split only after all its children were prepared (post-order).
    if (entry.prepared) {
      if (isElement(entry.node)) attentionChildren(entry.node);
      continue;
    }
    visit({ entry, base, pending });
  }
}

/** Prepares one node and schedules its readable children, or flattens it past the depth bound. */
function visit({ entry: { node, depth }, base, pending }: { entry: PendingNode; base: string; pending: PendingNode[] }, _options: Record<string, never> = {}): void {
  if (isElement(node)) {
    prepareElement(node, base);
    if (depth > MAX_DEPTH) return flattenToText({ element: node });
  }
  if (!("childNodes" in node)) return;
  node.childNodes = node.childNodes.filter(child => readable(child, base));
  pending.push({ node, depth, prepared: true });
  for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push({ node: node.childNodes[i]!, depth: depth + 1 });
}

function flattenToText({ element }: { element: Element }, _options: Record<string, never> = {}): void {
  const text = plainText(element);
  element.tagName = "span";
  element.nodeName = "span";
  element.attrs = [];
  element.childNodes = [{ nodeName: "#text", value: text, parentNode: element }];
}

/** Snapshot code text with its whitespace; the bridge's handlers see a whitespace-minified clone. */
function annotateInlineCode({ hast }: { hast: ReaderNode }, _options: Record<string, never> = {}): void {
  const pending: ReaderNode[] = [hast];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.type === "element" && node.tagName === "code") (node as ReaderNode & { data?: { readerInlineCode: string } }).data = { readerInlineCode: hastText(node) };
    if (node.children) pending.push(...node.children);
  }
}

const READER_HANDLERS: NonNullable<Parameters<typeof toMdast>[1]>["handlers"] = {
  a: (state, node) => node.properties.href && hasVisibleAnchorContent({ node }) ? defaultHandlers.a!(state, node) : state.all(node),
  code: (state, node) => {
    // annotateInlineCode stamped every code element before the bridge ran.
    const result = { type: "inlineCode" as const, value: (node.data as { readerInlineCode?: string } | undefined)!.readerInlineCode! };
    state.patch(node, result);
    return result;
  },
  // Strikethrough was plain text in this reader; no extra GFM serialization extension is needed.
  del: (state, node) => state.all(node),
  s: (state, node) => state.all(node),
  strike: (state, node) => state.all(node),
  audio: (state, node) => state.all(node),
  video: (state, node) => state.all(node),
};

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
  annotateInlineCode({ hast });
  const markdown = toMdast(hast, { document: true, handlers: READER_HANDLERS });
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
