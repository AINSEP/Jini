import type { CSSProperties } from 'react';
import 'grapesjs/dist/css/grapes.min.css';
import { useInteractiveHtmlEditor } from '../hooks/useInteractiveHtmlEditor.js';

/**
 * @file A visual, click-into-text editing surface for a bespoke HTML document, built on GrapesJS
 * (MIT). Renders `html` like a live preview but lets the operator click into rendered text and edit
 * it in place, with a small Rich Text Editor toolbar (bold/italic/link) — not a structured-document
 * editor: `html` in, edited `html` out via `onChange`, the same contract as an HTML source
 * `<textarea>`. See `react/hooks/useInteractiveHtmlEditor.ts` for why this is uncontrolled
 * (mount-once) rather than reacting to `html`/`isProtectedElement` prop changes after construction.
 *
 * **Scope, this pass: text editing + basic formatting only.** GrapesJS also does drag/drop block
 * manipulation, a Style Manager, and a Layers panel; none of that chrome is enabled here (`panels:
 * { defaults: [] }`, `blockManager: { blocks: [] }` in the hook) — Gutenberg-style block
 * move/duplicate/lock/group is explicitly deferred, not merely unbuilt.
 *
 * **`GJS_STYLE_VARS` below is a consequence of that same choice, not a separate styling decision.**
 * GrapesJS's own vendor CSS unconditionally reserves layout space for the default chrome this
 * component turns off — `.gjs-cv-canvas`'s width is `calc(100% - var(--gjs-left-width))` (default
 * `15%`, for a left Layers/Blocks column that never renders here) and its top offset is
 * `var(--gjs-canvas-top)` (default `40px`, for a top panel bar that also never renders) — confirmed
 * live by measuring the rendered canvas: it sat 197px narrower than its own wrapper at a 1300px
 * wrapper width, exactly `15%`. Left un-overridden, every host gets a dead gray gap on the canvas's
 * right and top edges. Zeroing both variables, scoped to this component's own wrapper via inline
 * style (cascades to the GrapesJS-owned descendants below it), is this component's responsibility to
 * get right once — not something every host integrating it should have to rediscover and patch in
 * its own stylesheet.
 *
 * **This component has zero knowledge of any host's embed/placeholder conventions.** `isProtectedElement`
 * is an optional predicate the caller supplies to lock specific elements (identified however the
 * caller likes) out of every GrapesJS interaction that could edit, move, or remove them — not
 * editable, draggable, droppable, removable, or selectable. When omitted, no elements are protected.
 * See `@jini-ai/admin/react`'s `InteractiveHtmlEditor` for a worked example: it composes this
 * primitive with a predicate recognizing Tovu's `data-embed-type` placeholder convention.
 *
 * ## Styling contract
 *
 * This component imports GrapesJS's own vendor stylesheet (`grapesjs/dist/css/grapes.min.css`),
 * because GrapesJS's canvas/RTE chrome does not render usably without it. This is not authored
 * product styling a host would want to override — it is a third-party editor's own required CSS, the
 * same category of dependency as shipping a `<video>` element would carry the browser's native
 * controls chrome. The host's own `.interactive-html-editor` wrapper class is still available for
 * layout (sizing, borders) it wants to apply.
 */
export interface InteractiveHtmlEditorProps {
  /** The document to load into the editor. Read once, at mount — see this file's header and
   *  `react/hooks/useInteractiveHtmlEditor.ts` for why. */
  html: string;
  /** Fires with the editor's current serialized HTML on every content edit. Does not persist
   *  anything itself — the caller decides when/whether to save, same as an HTML source textarea's
   *  `onChange`. */
  onChange: (html: string) => void;
  className?: string;
  /** Identifies elements that must never become editable, draggable, removable, or droppable inside
   *  the editor. Read once, at mount, same as `html`. Predicates that check attributes should use
   *  `hasAttributeOnAnyNodeShape` (exported alongside this component) rather than `el.hasAttribute`
   *  directly — see that helper's own doc for why. Omit to protect nothing. */
  isProtectedElement?: (el: Element) => boolean;
}

/** See this file's header for why these exist: they zero out layout space GrapesJS's default CSS
 *  reserves for chrome this component never renders (`panels: { defaults: [] }`). */
const GJS_STYLE_VARS = {
  '--gjs-left-width': '0px',
  '--gjs-canvas-top': '0px',
} as CSSProperties;

export function InteractiveHtmlEditor({ html, onChange, className, isProtectedElement }: InteractiveHtmlEditorProps) {
  const { containerRef } = useInteractiveHtmlEditor(html, onChange, isProtectedElement);
  const wrapperClassName = className ? `interactive-html-editor ${className}` : 'interactive-html-editor';
  return <div ref={containerRef} className={wrapperClassName} style={GJS_STYLE_VARS} />;
}
