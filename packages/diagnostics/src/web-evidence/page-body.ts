import { Buffer } from "node:buffer";
import { ToolInputError } from "@jini-ai/core";
import { parse, type DefaultTreeAdapterMap } from "parse5";

/** t08: shared HTML/text/find projection. Network producers also enforce a raw 1 MB ceiling. */
export const DEFAULT_MAX_BODY_BYTES = 20_000;
export const MAX_MAX_BODY_BYTES = 1_000_000;
export interface PageBodyOptions { maxBytes?: number | undefined; find?: string | undefined; textOnly?: boolean | undefined }
export type ShapedPageBody = { bodyBytes: number; truncated: boolean } & (
  { body: string; matches?: never; matchCount?: never } |
  { matches: Array<{ offset: number; snippet: string }>; matchCount: number; body?: never }
);

/** Validates all shared options at the tool boundary; no implicit coercion or silent defaults. */
export function readPageBodyOptions({ input }: { input: Record<string, unknown> }, _optional: Record<string, never> = {}): PageBodyOptions {
  const { find, textOnly, maxBytes } = input;
  if (find !== undefined && (typeof find !== "string" || find.length < 1 || find.length > 200)) throw new ToolInputError({ message: "find must be a string of 1..200 characters." });
  if (textOnly !== undefined && typeof textOnly !== "boolean") throw new ToolInputError({ message: "textOnly must be a boolean." });
  assertMaxBodyBytes({ maxBytes });
  return { find: find as string | undefined, textOnly: textOnly as boolean | undefined, maxBytes: maxBytes as number | undefined };
}

/** Keeps the numeric budget validation and its boundary error together. */
function assertMaxBodyBytes({ maxBytes }: { maxBytes: unknown }, _options: Record<string, never> = {}): void {
  if (maxBytes === undefined) return;
  if (typeof maxBytes !== "number" || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_MAX_BODY_BYTES) throw new ToolInputError({ message: "maxBytes must be an integer of 1..1000000." });
}

const OMITTED_ELEMENTS: ReadonlySet<string> = new Set(["script", "style", "noscript", "template"]);
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set(["html", "head", "body", "p", "div", "section", "article", "main", "header", "footer", "nav", "br", "li", "ul", "ol", "table", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "pre", "blockquote"]);
/** Iterative traversal avoids stack overflow on deeply nested untrusted HTML. Parser decodes entities. */
function visibleText({ body }: { body: string }, _optional: Record<string, never> = {}): string {
  const pending: Array<DefaultTreeAdapterMap["node"] | string> = [parse(body)];
  const text: string[] = [];
  while (pending.length) {
    appendVisibleNode({ node: pending.pop()!, pending, text });
  }
  return text.join("").replace(/\s+/g, " ").trim();
}

/** Visits one parsed node, scheduling children in document order and spaces around blocks. */
function appendVisibleNode({ node, pending, text }: {
  node: DefaultTreeAdapterMap["node"] | string;
  pending: Array<DefaultTreeAdapterMap["node"] | string>;
  text: string[];
}, _options: Record<string, never> = {}): void {
  if (typeof node === "string") { text.push(node); return; }
  if ("tagName" in node && OMITTED_ELEMENTS.has(node.tagName)) return;
  if (node.nodeName === "#text" && "value" in node) { text.push(node.value); return; }
  scheduleVisibleChildren({ node, pending, text });
}

/** Schedules children in document order, surrounding blocks with deferred closing spaces. */
function scheduleVisibleChildren({ node, pending, text }: {
  node: DefaultTreeAdapterMap["node"];
  pending: Array<DefaultTreeAdapterMap["node"] | string>;
  text: string[];
}, _options: Record<string, never> = {}): void {
  if (!("childNodes" in node)) return;
  const block = "tagName" in node && BLOCK_ELEMENTS.has(node.tagName);
  if (block) { text.push(" "); pending.push(" "); }
  for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]!);
}

/** Cuts at a UTF-8 boundary so shaping does not expand a clipped byte into a replacement character. */
function capText({ body, maxBytes }: { body: string; maxBytes: number }, _optional: Record<string, never> = {}): string {
  const bytes = Buffer.from(body);
  if (bytes.length <= maxBytes) return body;
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}

/** O(body length + matches); counts the full available source, retains at most 20 bounded snippets. */
function findMatches({ body, find, maxBytes }: { body: string; find: string; maxBytes: number }, _optional: Record<string, never> = {}): ShapedPageBody {
  const pattern = new RegExp(RegExp.escape(find), "giu");
  const matches: Array<{ offset: number; snippet: string }> = [];
  let matchCount = 0;
  let bytesLeft = maxBytes;
  let truncated = false;
  for (const match of body.matchAll(pattern)) {
    matchCount++;
    if (matches.length === 20 || bytesLeft === 0) { truncated = true; continue; }
    const offset = match.index;
    const context = body.slice(Math.max(0, offset - 160), offset + match[0].length + 160);
    const snippet = capText({ body: context, maxBytes: bytesLeft });
    if (snippet !== context) truncated = true;
    bytesLeft -= Buffer.byteLength(snippet);
    matches.push({ offset, snippet });
  }
  return { matches, matchCount, bodyBytes: Buffer.byteLength(body), truncated };
}

/**
 * Shapes available page text, stripping before capping. With find, offsets are UTF-16 positions in
 * the shaped source; matchCount counts non-overlapping matches in that source, even after the
 * snippet budget is exhausted. Producers OR their raw-read truncation into this flag.
 * @returns Body or matches (never both), source byte count and an explicit truncation flag.
 */
export function shapePageBody({ body }: { body: string }, options: PageBodyOptions = {}): ShapedPageBody {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BODY_BYTES;
  const source = options.textOnly ? visibleText({ body }) : body;
  if (options.find !== undefined) return findMatches({ body: source, find: options.find, maxBytes });
  // Preserve the existing raw-page decode behavior at a split multibyte character.
  const bytes = Buffer.from(source);
  if (bytes.length <= maxBytes) return { body: source, bodyBytes: bytes.length, truncated: false };
  const capped = options.textOnly ? capText({ body: source, maxBytes }) : bytes.subarray(0, maxBytes).toString("utf8");
  return { body: capped, bodyBytes: options.textOnly ? Buffer.byteLength(capped) : maxBytes, truncated: true };
}
