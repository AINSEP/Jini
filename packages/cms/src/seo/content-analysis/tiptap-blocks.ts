/**
 * @file TipTap `bodyJson` -> `ContentBlock[]` — the only TipTap-aware piece of content analysis.
 *
 * Purpose:
 * Flattens a TipTap/ProseMirror document tree (`{ type, attrs?, text?, content?: [...] }`) into the
 * editor-agnostic `ContentBlock[]` that `analyzeContent` (`./analyze-content.ts`) scores, so the scorer itself never
 * learns what an editor is.
 *
 * Mapping:
 * - `heading` -> heading block (`attrs.level`, an integer 1-6; anything else defaults to 2, the most
 *   common subheading, so a malformed level never fakes a second H1).
 * - `paragraph` / `codeBlock` -> one text block of all descendant text joined WITHOUT a separator
 *   (marks split one sentence into several sibling text nodes); `hardBreak` becomes a space.
 * - `image` / `mediaImage` -> image block (`attrs.alt` when it is a string, else `null`), whether it
 *   sits at block level or inline inside a paragraph (emitted right after that paragraph).
 * - `title` (the admin editor's leading title node) -> skipped; the title is scored separately.
 * - A bare `text` node reached at block level (e.g. a table cell holding text directly) -> text block.
 * - Every other node with a `content` array (doc, lists, list items, blockquotes, tables, unknown
 *   containers) is walked into; everything else is skipped.
 *
 * Defensive by contract: `bodyJson` is author/plugin-controlled data that crossed a structured-clone
 * boundary, so non-object nodes, non-array `content` and non-string `text` are skipped, and the walk
 * stops at `MAX_DEPTH` so a cyclic or absurdly deep tree cannot overflow the stack. Never throws.
 */
import type { ContentBlock, HeadingLevel } from "@jini-ai/core/contracts/site/seo-content-analysis";

/** Far deeper than any real document (nested lists inside quotes inside tables), far shallower
 * than the stack. Anything below it is ignored. */
const MAX_DEPTH = 100;

const TEXT_BLOCK_TYPES = new Set(["paragraph", "codeBlock"]);
const IMAGE_TYPES = new Set(["image", "mediaImage"]);

interface NodeView {
  type: unknown;
  attrs: Record<string, unknown>;
  text: unknown;
  children: readonly unknown[];
}

function view({ node }: { node: unknown }, _optional = {}): NodeView | undefined {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return undefined;
  const { type, attrs, text, content } = node as Record<string, unknown>;
  return {
    type,
    attrs: typeof attrs === "object" && attrs !== null ? (attrs as Record<string, unknown>) : {},
    text,
    children: Array.isArray(content) ? content : [],
  };
}

function headingLevel({ level }: { level: unknown }, _optional = {}): HeadingLevel {
  return Number.isInteger(level) && (level as number) >= 1 && (level as number) <= 6 ? (level as HeadingLevel) : 2;
}

function imageBlock(node: NodeView): ContentBlock {
  return { kind: "image", alt: typeof node.attrs.alt === "string" ? node.attrs.alt : null };
}

/** Collects a block's inline text; inline images found on the way go to `images`. Its depth budget
 * starts fresh at each block (callers pass 0) so a paragraph sitting just above the block-walk cap
 * still yields its text; total recursion stays bounded by 2 x `MAX_DEPTH`. */
function inlineText({ node, images, depth }: { node: NodeView; images: ContentBlock[]; depth: number }, _optional = {}): string {
  if (depth > MAX_DEPTH) return "";
  if (typeof node.text === "string") return node.text;
  if (node.type === "hardBreak") return " ";
  if (IMAGE_TYPES.has(node.type as string)) {
    images.push(imageBlock(node));
    return "";
  }
  let text = "";
  for (const child of node.children) {
    const childView = view({ node: child });
    if (childView) text += inlineText({ node: childView, images, depth: depth + 1 });
  }
  return text;
}

/** A heading or text block, followed by the inline images found in its text. */
function inlineBlock(required: { node: NodeView }): ContentBlock[] {
  const { node } = required;
  const images: ContentBlock[] = [];
  const text = inlineText({ node, images, depth: 0 });
  return [node.type === "heading" ? { kind: "heading", level: headingLevel({ level: node.attrs.level }), text } : { kind: "text", text }, ...images];
}

/** The blocks one block-level node yields, or `undefined` for a container whose children are walked. */
function leafBlocks(required: { node: NodeView }): ContentBlock[] | undefined {
  const { node } = required;
  if (node.type === "heading" || TEXT_BLOCK_TYPES.has(node.type as string)) return inlineBlock({ node });
  if (IMAGE_TYPES.has(node.type as string)) return [imageBlock(node)];
  // The admin editor prepends a `title` node to every bodyJson (a host admin editor's
  // `withTitleNode`-style rule); the title reaches the scorer separately, so counting it here would
  // double it into the body's words.
  if (node.type === "title") return [];
  if (node.type === "text") return typeof node.text === "string" ? [{ kind: "text", text: node.text }] : [];
  return undefined;
}

function walk({ node, out, depth }: { node: unknown; out: ContentBlock[]; depth: number }, _optional = {}): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const child of node) walk({ node: child, out, depth: depth + 1 });
    return;
  }
  const current = view({ node });
  if (!current) return;
  const blocks = leafBlocks({ node: current });
  if (blocks) {
    out.push(...blocks);
    return;
  }
  for (const child of current.children) walk({ node: child, out, depth: depth + 1 });
}

/**
 * Flattens a TipTap document into analyzer blocks, in document order.
 *
 * @param required.bodyJson - A TipTap doc (or a bare array of nodes); any other value yields `[]`.
 * @returns The `ContentBlock[]` for `analyzeContent`. Never throws.
 * @complexity O(nodes), bounded by `MAX_DEPTH` levels.
 */
export function tiptapToBlocks({ bodyJson }: { bodyJson: unknown }, _optional = {}): ContentBlock[] {
  const out: ContentBlock[] = [];
  walk({ node: bodyJson, out, depth: 0 });
  return out;
}
