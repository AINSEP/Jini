/** @file Download-only HTML transforms for the backup/share static copy: backend forms are disabled and document bases rebased. */
import type { DroppedReference } from "../../static-export/contracts.js";

/** Byte range of a node, tag or attribute within the original HTML source. */
export interface SourceRange { startOffset: number; endOffset: number }
/** An ancestor of an element; the document root has a node name but no tag. */
export interface HtmlAncestor { nodeName: string; tagName?: string; parentNode?: HtmlAncestor | null }
/** Structural view of a parsed element: only the tag, ancestry and source offsets this file reads. */
export interface Element {
  tagName: string;
  parentNode?: HtmlAncestor | null;
  sourceCodeLocation?: (SourceRange & { startTag?: SourceRange; attrs?: Record<string, SourceRange> }) | null;
}
export type Edit = { startOffset: number; endOffset: number; text: string };
/** Host-owned source-located HTML editor (parse5 with source locations). Injected so the
 * backup package keeps no runtime edge to the HTML owner; edits apply against original offsets,
 * which keeps theme scripts, formatting and root-relative paths byte-for-byte intact. */
export interface DownloadHtmlSourceEdits {
  elements(required: { html: string }, optional?: Record<string, never>): Element[];
  attribute(required: { node: Element; name: string }, optional?: Record<string, never>): string | undefined;
  editedHtml(required: { html: string; edits: Edit[] }, optional?: Record<string, never>): string;
  /** Attribute/text escaping owned by the host, so the backup package imports no text utilities. */
  escapeHtml(required: { text: string }, optional?: Record<string, never>): string;
}
type WithEdits = { sourceEdits: DownloadHtmlSourceEdits };

/** Local form actions address a backend, including empty actions that post to the page itself. */
function serverAction({ action, publicOrigin, page }: { action: string; publicOrigin?: string | undefined; page: string }, _options = {}): URL | undefined {
  const base = publicOrigin ?? "https://static-copy.invalid";
  try {
    const url = new URL(action, base + page);
    return url.origin === base ? url : undefined;
  } catch { return undefined; }
}

/** Mailto comes from an actual page link, never assistant metadata or injected form configuration. */
function emailAlternative({ nodes, sourceEdits }: { nodes: Element[] } & WithEdits, _options = {}): string {
  const link = nodes.find(node => node.tagName === "a" && /^mailto:/i.test(sourceEdits.attribute({ node, name: "href" }) ?? ""));
  if (!link) return "";
  const href = sourceEdits.attribute({ node: link, name: "href" });
  if (href === undefined) throw new Error("Static export email link has no address");
  const address = href.slice(7).split("?")[0]!; // split always returns a first piece
  return ` Email us at <a href="${sourceEdits.escapeHtml({ text: href })}">${sourceEdits.escapeHtml({ text: address })}</a> instead.`;
}

/** Disable one backend-dependent form and disclose the missing server immediately after it. */
function formEdits({ node, alternative }: { node: Element; alternative: string }, _options = {}): Edit[] {
  const location = node.sourceCodeLocation;
  if (!location) throw new Error("Static export form has no source location");
  const attrs = node.sourceCodeLocation?.attrs ?? {};
  const edits: Edit[] = [];
  if (attrs.action) edits.push({ ...attrs.action, text: "" });
  // Removing action/method alone defaults to GET and leaks answers into the URL. The native
  // dialog method performs no network submission while preserving theme form selectors.
  if (attrs.method) edits.push({ ...attrs.method, text: 'method="dialog"' });
  else {
    if (!location.startTag) throw new Error("Static export form has no start tag location");
    const start = location.startTag.endOffset - 1;
    edits.push({ startOffset: start, endOffset: start, text: ' method="dialog"' });
  }
  const end = location.endOffset;
  edits.push({ startOffset: end, endOffset: end, text: `<p>This form needs a server to send messages.${alternative}</p>` });
  return edits;
}

/** Explicit form owners take precedence over ancestors for outside submit controls. */
function submitOwner({ node, ids, disabled, sourceEdits }: { node: Element; ids: Set<string>; disabled: Set<Element> } & WithEdits, _options = {}): boolean {
  const form = sourceEdits.attribute({ node, name: 'form' });
  if (form !== undefined) return ids.has(form);
  let parent: HtmlAncestor | null | undefined = node.parentNode;
  while (parent) {
    if (parent.tagName === 'form') return disabled.has(parent as Element);
    parent = parent.parentNode;
  }
  return false;
}

/** Dialogs and action-less script/search forms have no known backend destination to disable. */
function backendFormTarget({ node, publicOrigin, page, sourceEdits }: { node: Element; publicOrigin: string | undefined; page: string } & WithEdits, _options = {}): URL | undefined {
  if (node.tagName !== 'form' || !node.sourceCodeLocation) return undefined;
  const method = sourceEdits.attribute({ node, name: 'method' })?.toLowerCase();
  if (method === 'dialog') return undefined;
  const action = sourceEdits.attribute({ node, name: 'action' });
  if (action === undefined && method !== 'post' && sourceEdits.attribute({ node, name: 'data-form-slug' }) === undefined) return undefined;
  return serverAction({ action: action ?? '', publicOrigin, page });
}

/** Download-only form policy. Publish retains receiver-enabled actions. Report only removed actions.
 * Theme data attributes remain: themes and the form scripts may use them for styling/validation.
 * Retained sign-in links are reported separately for the download's server-dependency notes.
 * @complexity O(HTML bytes + edits log edits); returned removals are the machine-report evidence.
 */
export function downloadForms({ html, page, publicOrigin, sourceEdits }: { html: string; page: string; publicOrigin?: string | undefined } & WithEdits, _options = {}): { html: string; removed: DroppedReference[]; serverLinks: DroppedReference[] } {
  const nodes = sourceEdits.elements({ html });
  const alternative = emailAlternative({ nodes, sourceEdits });
  const disabled = new Set<Element>();
  const edits: Edit[] = [], removed: DroppedReference[] = [], serverLinks: DroppedReference[] = [];
  for (const node of nodes) {
    const signin = signInReference({ node, page, publicOrigin, sourceEdits });
    if (signin) serverLinks.push(signin);
    const target = backendFormTarget({ node, publicOrigin, page, sourceEdits });
    if (!target) continue;
    disabled.add(node);
    edits.push(...formEdits({ node, alternative }));
    removed.push({ page, url: target.pathname, attribute: "action", reason: "needs-server" });
  }
  const ids = new Set([...disabled].map(node => sourceEdits.attribute({ node, name: 'id' })).filter((id): id is string => id !== undefined));
  for (const node of nodes) {
    const override = node.sourceCodeLocation?.attrs?.formmethod;
    if (override && submitOwner({ node, ids, disabled, sourceEdits })) edits.push({ ...override, text: 'formmethod="dialog"' });
  }
  return { html: sourceEdits.editedHtml({ html, edits }), removed, serverLinks };
}

/** Account entry points need a backend even when their link remains visible in the download. */
function signInReference({ node, page, publicOrigin, sourceEdits }: { node: Element; page: string; publicOrigin?: string | undefined } & WithEdits, _options = {}): DroppedReference | undefined {
  if (node.tagName !== "a") return undefined;
  const href = sourceEdits.attribute({ node, name: "href" });
  if (href === undefined) return undefined;
  const target = serverAction({ action: href, publicOrigin, page });
  if (target?.pathname !== "/signin") return undefined;
  return { page, url: "/signin", attribute: "href", reason: "needs-server" };
}

/** Rebase refresh targets and drop base elements so download links resolve from their own file.
 * @param required HTML and the download owner's URL mapping.
 * @returns HTML with parser-located edits; theme scripts and surrounding formatting stay intact.
 * @complexity O(HTML bytes + edits log edits), no I/O.
 * @example downloadDocumentBase({ html, rewrite: url => url, sourceEdits });
 */
export function downloadDocumentBase({ html, rewrite, sourceEdits }: { html: string; rewrite: (url: string) => string } & WithEdits, _options = {}): string {
  const edits: Edit[] = [];
  for (const node of sourceEdits.elements({ html })) {
    if (node.tagName === "base" && node.sourceCodeLocation) edits.push({ ...node.sourceCodeLocation, text: "" });
    const edit = refreshEdit({ node, rewrite, sourceEdits });
    if (edit) edits.push(edit);
  }
  return sourceEdits.editedHtml({ html, edits });
}

/** Refresh content is a delay plus one URL; HTML structure and quoting remain parser-owned. */
function refreshEdit({ node, rewrite, sourceEdits }: { node: Element; rewrite: (url: string) => string } & WithEdits, _options = {}): Edit | undefined {
  if (node.tagName !== "meta" || sourceEdits.attribute({ node, name: "http-equiv" })?.toLowerCase() !== "refresh") return undefined;
  const location = node.sourceCodeLocation?.attrs?.content;
  const content = refreshContent({ content: sourceEdits.attribute({ node, name: "content" }) ?? "", rewrite });
  if (!location || content === undefined) return undefined;
  return { ...location, text: `content="${sourceEdits.escapeHtml({ text: content })}"` };
}

/** Split the refresh value at its delimiters without overlapping whitespace runs or HTML matching. */
function refreshContent({ content, rewrite }: { content: string; rewrite: (url: string) => string }, _options = {}): string | undefined {
  const match = /^([^;]*;[^=]*=)([\s\S]*)$/.exec(content);
  if (!match) return undefined;
  if (!/;\s*url\s*=$/i.test(match[1]!)) return undefined;
  const url = match[2]!.trim().replace(/^["']|["']$/g, "");
  return match[1] + rewrite(url);
}
