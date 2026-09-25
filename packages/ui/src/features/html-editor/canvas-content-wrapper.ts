import type { CanvasContentWrapperNode } from './canvas-style.js';

/**
 * @file Wraps the canvas document's existing body content in a host-supplied ancestor DOM chain
 * (`CanvasStyling.contentWrapper`) — e.g. `<main><article class="post-detail wrap"></article></main>`
 * — so a document edited in the canvas is centered/padded/backgrounded the way its real template
 * wraps it, instead of rendering full-bleed against the bare canvas body.
 *
 * **Why this runs on the LIVE canvas DOM, never through GrapesJS's `components` config.** GrapesJS's
 * exported output (`editor.getHtml()`/`editor.getCss()`) is built entirely from its own component
 * model — the tree `components: html` seeds at construction — never by reading the canvas iframe's
 * live DOM (confirmed live by `useInteractiveHtmlEditor.ts`'s own investigation, restated in its
 * `serializeEditorContent` doc). A wrapper folded into the `components` STRING before `grapesjs.init`
 * would become real, exportable components — editable, draggable, deletable, and present in every
 * saved document from then on, nesting deeper on every subsequent save. This module instead runs
 * AFTER the editor has already parsed its initial `components` (see `useInteractiveHtmlEditor.ts`'s
 * `editor.on('load', ...)` call site) and manipulates `editor.Canvas.getBody()` directly — plain DOM
 * nodes GrapesJS's component model has no reference to and never scans when serializing. The wrapper
 * therefore cannot appear in `getHtml()`/`getCss()` by construction, not because of a strip-on-export
 * step that could be forgotten or miss a case — see `__tests__/canvas-content-wrapper.test.ts`'s
 * "never touches componentless internals" framing and `useInteractiveHtmlEditor.test.ts`'s assertion
 * that `components` passed to `grapesjs.init` is the raw, unwrapped host HTML.
 *
 * Existing content nodes are MOVED (native DOM re-parenting via `appendChild` on an already-attached
 * node), never cloned or rebuilt — the same `Node` objects GrapesJS's component views hold `.el`
 * references to keep their identity, so nothing already-initialized loses its live binding.
 */

/** Marks the outermost wrapper element this module inserts, so a second call (defensive — the
 *  caller's `load` handler should fire once per mount, but re-entrancy here would otherwise nest a
 *  second copy around the first) detects the existing wrapper and no-ops instead of double-wrapping. */
const WRAPPER_ROOT_MARKER = 'data-tovu-canvas-wrapper-root';

/**
 * Builds one chain level's element and applies its attributes verbatim via `setAttribute` — plain
 * HTML attribute names/values from the host's own template markup (`class`, `data-reveal`, …), not
 * React props, so `setAttribute` is the correct primitive rather than `className`/camelCase DOM
 * property assignment.
 */
function buildWrapperElement(doc: Document, node: CanvasContentWrapperNode): HTMLElement {
  const el = doc.createElement(node.tagName);
  for (const [name, value] of Object.entries(node.attributes ?? {})) {
    el.setAttribute(name, value);
  }
  return el;
}

/**
 * Wraps every current child node of `body` (elements, text, comments — whatever GrapesJS actually
 * rendered there) in the given ancestor chain, outermost element first, then re-attaches the chain's
 * outermost element to `body`.
 *
 * @param body - The canvas iframe's `<body>` element (`editor.Canvas.getBody()`), already populated
 *   by GrapesJS's initial component render.
 * @param chain - The ancestor chain to wrap with, outermost first — see
 *   {@link CanvasContentWrapperNode}. `undefined` or `[]` is a no-op: the pre-existing "no wrapper"
 *   behavior every caller had before this module existed.
 * @complexity O(d + c) — d = chain depth (elements created), c = body's current child-node count
 *   (each moved once, no copying).
 */
export function applyCanvasContentWrapper(body: HTMLElement, chain: readonly CanvasContentWrapperNode[] | undefined): void {
  if (!chain || chain.length === 0) return;
  // Re-entrancy guard — see WRAPPER_ROOT_MARKER's own doc.
  if (body.querySelector(`[${WRAPPER_ROOT_MARKER}]`)) return;

  const doc = body.ownerDocument;
  // Built innermost-first via `reduceRight` (each level's element wraps the previous result), which
  // also hands back a reference to the innermost level in the same pass — avoids indexing into a
  // built array by position, which `chain`'s `readonly T[]` (not a fixed-length tuple) type cannot
  // statically prove is in bounds even though the length guard above makes it always true here.
  let innermost: HTMLElement | undefined;
  const outermost = chain.reduceRight<HTMLElement | undefined>((child, node) => {
    const el = buildWrapperElement(doc, node);
    if (child) el.appendChild(child);
    innermost ??= el;
    return el;
  }, undefined);
  if (!outermost || !innermost) return; // Unreachable given the `chain.length === 0` guard above.
  outermost.setAttribute(WRAPPER_ROOT_MARKER, '');

  // Move body's existing children into the innermost wrapper level, preserving order. Snapshotted
  // into an array first — `body.childNodes` is a LIVE collection that would shrink out from under a
  // direct iteration as each node is moved.
  for (const child of Array.from(body.childNodes)) {
    innermost.appendChild(child);
  }

  body.appendChild(outermost);
}
