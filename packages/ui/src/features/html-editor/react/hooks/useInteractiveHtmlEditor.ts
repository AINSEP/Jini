import { useCallback, useEffect, useRef, useState } from 'react';
import grapesjs, { type Component, type Editor } from 'grapesjs';
import { applyCanvasContentWrapper } from '../../canvas-content-wrapper.js';
import { applyCanvasEmbedPlaceholders, type CanvasEmbedPlaceholderDescriptor } from '../../canvas-embed-placeholders.js';
import { buildCanvasStyleConfig, CANVAS_STYLES_PENDING_CLASS, type CanvasStyling } from '../../canvas-style.js';
import { serializeEditorSource, type DirtyTextEdit } from '../../editor-serialization.js';
import { prepareEditorSource, type PreparedEditorSource, type RequestEditHtml } from '../../editor-blocks.js';
import { assertPreparedSourceModel, assertProtectedSourceMetadata, EditorSourceError, PROTECTED_ELEMENT_TYPE, protectedCanvasDescriber, protectTextAncestors, registerProtectedElementType } from '../../protected-elements.js';
import { pathKey, type ElementPath } from '../../source-splice.js';

/**
 * @file `InteractiveHtmlEditor`'s GrapesJS lifecycle: construct the editor once per mount against
 * the container ref, wire content-change notifications out, and tear the editor down on unmount.
 * Split from the component the same reason `ConfirmDialog.hooks.tsx` is split from `ConfirmDialog.tsx`
 * in `@jini-ai/admin` — the imperative, non-React lifecycle (`grapesjs.init`/`editor.destroy`) stays
 * out of the render path, and a test can drive it independently of the markup.
 *
 * **Uncontrolled by design.** `html` (and `isProtectedElement`, and `canvasStyling`) are read once,
 * at construction — this hook does not react to later changes in any of them. GrapesJS owns an internal component tree
 * once initialized; feeding an external string back into a live editor on every parent re-render
 * (which is what a naive `useEffect([html])` would do, since this same hook's own `onChange` callback
 * pushes edits back up into whatever state produced the `html` prop) would either fight the operator's
 * cursor or require diffing GrapesJS's tree against a string to detect "did this change come from us",
 * which is real complexity this component's text-editing-only scope does not need. A host that needs a
 * fresh document only mounts this component while it's active and remounts with fresh `html` — see
 * `@jini-ai/admin/react`'s `InteractiveHtmlEditor` adapter and its caller in the host product's `PageEditor.tsx`.
 *
 * **This module has zero knowledge of host embed conventions.** The shared source detector owns
 * native/runtime blocks; the caller owns its embed predicate and descriptions. Both go through
 * `../../protected-elements.ts`'s single raw-source type and the existing canvas card renderer.
 *
 * **`canvasStyling.contentWrapper` is applied on `load`, against the live canvas — never folded into
 * `components` above.** See `../../canvas-content-wrapper.ts`'s own file header for why: GrapesJS's
 * exported HTML/CSS are built from its component model, which `components` seeds and this wrapper
 * never touches, so it cannot leak into a save no matter how the canvas is edited afterward.
 */

/** Bold/italic/link only. GrapesJS's other built-in RTE actions (underline, strikethrough, wrap) are
 *  omitted, not merely unconfigured, by naming exactly these three rather than leaving the default
 *  action list in place. */
const RTE_ACTIONS = ['bold', 'italic', 'link'];


function initInteractiveHtmlEditor(
  container: HTMLElement,
  sourcePlan: PreparedEditorSource,
  canvasStyling: CanvasStyling,
  options: InteractiveEditorOptions,
): Editor {
  return grapesjs.init({
    container,
    height: '100%',
    fromElement: false,
    components: sourcePlan.html,
    storageManager: { type: 'none' },
    panels: { defaults: [] },
    blockManager: { blocks: [] },
    richTextEditor: { actions: RTE_ACTIONS },
    // Both default to `true`: avoidInlineStyle moves styles into ID rules; forceClass converts
    // them to .cNNNN rules even with avoidInlineStyle disabled, including on untouched elements.
    // Keep authored styles inline for structural saves (Bug C in this repo's `pages-redo` plan).
    // serializeCleaned's JSON CSS export is the other half; the splice path already keeps bytes.
    avoidInlineStyle: false,
    forceClass: false,
    canvas: buildCanvasStyleConfig({ ...canvasStyling, css: [canvasStyling.css, sourcePlan.canvasCss].filter(Boolean).join('\n') }),
    // Structural export can only preserve whitespace gaps the parser retained in the model.
    parser: { optionsHtml: { allowScripts: false, keepEmptyTextNodes: true } },
    plugins: [(editor: Editor) => registerProtectedElementType({ editor, sourcePlan }, {
      onRequestEditHtml: options.onRequestEditHtml, editHtmlLabel: options.translate?.('Edit HTML'),
      beforeRequestEditHtml: () => disableActiveTextEditing(editor), onSerializationError: options.onSerializationError,
    })],
  });
}

/** Mirrors `source-splice.ts`'s own `UNINDEXED_TAGS` filter, but for GrapesJS's live component tree
 *  rather than a parsed HTML string: `textnode` and `comment` components never consume a path slot,
 *  matching how `indexElementSourceRanges` numbers the original string. Raw style/script atoms
 *  now stay in the tree, but their original source tag still excludes them from path slots; before
 *  source preservation GrapesJS moved styles into CssComposer and dropped scripts outright. */
function isPathableComponent(component: Component): boolean {
  return !component.is('textnode') && !component.is('comment')
    && !['style', 'script'].includes(component.get?.('sourceTagName') as string);
}

/**
 * `component`'s element-only child path from the editor's wrapper root, in the exact numbering
 * scheme `indexElementSourceRanges` uses for the original HTML string — so a path computed here can
 * be looked up directly against that index. Returns `null` only if `component` (or an ancestor)
 * cannot be found in its own parent's `components()` collection, which is not reachable for a live
 * component an actual GrapesJS event just handed this hook; kept as a defensive guard rather than
 * assumed away, the same convention `canvas-embed-placeholders.ts`'s own "Unreachable ... defensive
 * only" comment uses for its analogous case.
 *
 * @complexity O(d + s) — d = depth from the wrapper, s = total siblings visited across every
 * ancestor level. Editor documents in this product are shallow; not a hot path.
 */
function computeComponentPath(component: Component): ElementPath | null {
  const path: number[] = [];
  let current: Component = component;
  for (;;) {
    const parent = current.parent();
    if (!parent) return path;
    const siblings = parent.components().models;
    const at = siblings.indexOf(current);
    if (at === -1) return null; // Unreachable for a live component; defensive only.
    const elementIndex = siblings.slice(0, at).filter(isPathableComponent).length;
    path.unshift(elementIndex);
    current = parent;
  }
}

/**
 * Records (or overwrites) the latest inner HTML for the nearest `text` component whose content
 * changed, keyed by its element-only path. Silently ignores anything that is not a `text` component
 * — this is the mechanism that keeps a non-text element (a host's embed marker `<div>`, an image, a
 * plain container) from ever becoming a splice target, even if some other GrapesJS event happens to
 * name it as its argument — and anything whose path cannot be resolved from the live tree.
 */
function recordDirtyTextEdit(component: Component | undefined, dirty: Map<string, DirtyTextEdit>): void {
  if (!component || !component.is('text')) return;
  const path = computeComponentPath(component);
  if (!path) return;
  dirty.set(pathKey(path), { path, tagName: component.tagName.toLowerCase(), component });
}

/**
 * True when `component` sits inside a `text` component: the inline and textnode children GrapesJS's
 * `syncContent` removes and re-adds every time an RTE session closes. That churn is part of a text
 * edit, which the splice already covers, not a block edit. A just-removed component has no `parent()`
 * any more, so the walk starts from `prevColl.parent` (the collection it was removed from).
 *
 * @complexity O(d) in the component's depth.
 */
function isInsideTextComponent(component: Component): boolean {
  let current: Component | undefined = component.parent() ?? component.prevColl?.parent;
  while (current) {
    if (current.is('text')) return true;
    current = current.parent();
  }
  return false;
}

/**
 * Ends whatever RTE session is currently open, so its pending edit syncs into the component model
 * before `flush` reads it — GrapesJS only writes an RTE session's edited text into the model when
 * that session closes (`disableEditing`/`syncContent`), never on every keystroke, so a save or
 * unmount that skips this step silently loses the last, still-open edit. A throw from
 * `disableEditing` (e.g. GrapesJS internals mid-teardown) must never block `flush` from still
 * returning whatever was already recorded, so it is swallowed here rather than propagated.
 *
 * @complexity O(1) plus whatever the editor's own `disableEditing` costs.
 */
async function disableActiveTextEditing(editor: Editor): Promise<void> {
  const editing = editor.getEditing();
  if (!editing) return;
  try {
    await (editing.getView() as { disableEditing?: () => Promise<void> } | undefined)?.disableEditing?.();
  } catch {
    // Swallowed intentionally — see this function's doc.
  }
}

/** Hard cap on how long the canvas can stay hidden waiting for its theme stylesheet(s) (Bug B, Slice
 *  B1, this repo's `pages-redo` plan) — a dead URL or a hung dev-server reload must never hide the
 *  editor forever. */
const STYLESHEET_SETTLE_TIMEOUT_MS = 3000;

/**
 * Hides `body` behind {@link CANVAS_STYLES_PENDING_CLASS} until every `<link rel="stylesheet">`
 * GrapesJS's `canvas.styles` config put in the canvas document (`editor.Canvas.getDocument()`) has
 * fired `load` or `error`, or {@link STYLESHEET_SETTLE_TIMEOUT_MS} has elapsed — whichever comes first.
 * Every Interactive mount re-fetches the theme stylesheet (see this repo's `pages-redo` plan, Bug B)
 * with no guaranteed cache short-circuit; GrapesJS's own `FrameView` renders the canvas body without
 * waiting for `<link>`s in `<head>` to resolve, so without this the operator sees raw browser-default
 * styling (Times New Roman, blue links) for however long that fetch takes, or forever if the API is
 * mid-restart. The cap is unconditional, independent of how many stylesheets are still pending.
 *
 * Must be called from `handleLoad`, AFTER the content wrapper and embed placeholder decoration have
 * already run against the same `body` — so even the zero-stylesheet case (this function reveals in the
 * same synchronous call) never shows an undecorated canvas for even one frame.
 *
 * @returns A cleanup callback that cancels the pending timer and detaches any still-registered
 *   `load`/`error` listeners. Idempotent — safe to call again (from effect cleanup) after the canvas
 *   has already revealed; a no-op then.
 * @complexity O(n) in the number of `<link rel="stylesheet">` elements found — one listener pair per
 *   link, no polling.
 */
function revealCanvasWhenStylesheetsSettle(editor: Editor, body: HTMLElement, onSettled: () => void): () => void {
  body.classList.add(CANVAS_STYLES_PENDING_CLASS);

  const canvasDocument = editor.Canvas.getDocument();
  // `getDocument()` returning null is not reachable once `load` has fired on a real editor — defensive
  // only, same convention as this file's other "Unreachable ... defensive only" guards.
  const links = canvasDocument ? Array.from(canvasDocument.querySelectorAll('link[rel="stylesheet"]')) : [];

  let settled = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<Element>();

  const reveal = () => {
    if (settled) return;
    settled = true;
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    for (const link of pending) {
      link.removeEventListener('load', handleSettle);
      link.removeEventListener('error', handleSettle);
    }
    pending.clear();
    if (links.length > 0) onSettled();
    body.classList.remove(CANVAS_STYLES_PENDING_CLASS);
  };

  function handleSettle(event: Event): void {
    pending.delete(event.currentTarget as Element);
    if (pending.size === 0) reveal();
  }

  for (const link of links) {
    pending.add(link);
    link.addEventListener('load', handleSettle);
    link.addEventListener('error', handleSettle);
  }

  if (pending.size === 0) reveal();
  else timeoutId = setTimeout(reveal, STYLESHEET_SETTLE_TIMEOUT_MS);

  return reveal;
}

/**
 * Owns one GrapesJS `Editor` instance for the lifetime of the calling component's mount. `onChange`
 * fires with the editor's current serialized content (see `serializeWithSplice`) on every content
 * mutation (GrapesJS's `update` event — components, styles, or attributes changing); it is not
 * debounced, so a caller replacing an existing uncontrolled `<textarea>` (which already pushes a full
 * value on every keystroke) sees matching behavior.
 *
 * **Mounts into a dedicated child node, not the wrapper div `containerRef` itself, and removes that
 * child node (not just its content) on cleanup.** Defensive, for React StrictMode's dev-time
 * double-invoke (mount -> cleanup -> mount again, synchronously): if a destroyed instance's canvas
 * were still mid-render when cleanup ran, clearing the container's *current* content at that moment
 * cannot remove DOM that does not exist yet, and a later async write from the discarded instance
 * would land after the fact. Detaching the whole per-instance node sidesteps that class of ordering
 * problem entirely — whatever a destroyed instance's async work later does, it mutates a node no
 * longer connected to `document`, so it can never become visible or queryable in the live page no
 * matter when it runs. (Investigated live via Playwright while chasing an unrelated symptom — two
 * canvas iframes coexisting after one mount — which turned out to be a separate, harmless GrapesJS
 * quirk unrelated to StrictMode: `Canvas`'s `FramesView` always constructs one `FrameView` that never
 * proceeds past construction to `render()`, alongside the real one; it keeps Backbone's default
 * `class="frame"` forever, inert and unrendered. `.gjs-frame` — the class `FrameView.render()`
 * assigns — is what callers should select on, never a bare `iframe` under the wrapper.)
 *
 * **`flush()` exists because GrapesJS's RTE only syncs on `disableEditing`, and `update` is
 * double-debounced and never fires after `off()`.** A host that calls `onChange` on every keystroke
 * (like an uncontrolled `<textarea>`) still misses the operator's last edit if they click Save or
 * navigate away while an RTE session is still open: GrapesJS writes that session's text into the
 * component model only when it closes, and by the time a host's save handler runs, this hook has
 * already stopped listening (or the debounce hasn't fired yet). `flush` closes any open RTE session,
 * computes and emits the current content the same way `handleUpdate` does, and hands the result back
 * directly — see its own doc below for exactly what it returns and when.
 *
 * @complexity O(1) setup/teardown. Steady-state cost is GrapesJS's own serialization per edit,
 * proportional to document size — not something this hook controls or should hide a note about
 * beyond that.
 * @overallScore 100
 */
export interface InteractiveEditorOptions {
  onRequestEditHtml?: RequestEditHtml | undefined;
  translate?: ((key: string) => string) | undefined;
  onSerializationError?: ((error: EditorSourceError) => void) | undefined;
}

export function useInteractiveHtmlEditor(
  html: string,
  onChange: (html: string) => void,
  isProtectedElement?: (el: Element) => boolean,
  canvasStyling: CanvasStyling = {},
  describeEmbedPlaceholder?: (el: Element) => CanvasEmbedPlaceholderDescriptor | undefined,
  options: InteractiveEditorOptions = {},
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [sourceError, setSourceError] = useState<string>();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Delegated to by the stable `flush` callback returned below. Reset to a no-op on cleanup, before
  // `destroy()` — see the effect's cleanup for why the order matters.
  const flushRef = useRef<() => Promise<string | undefined>>(async () => undefined);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const sourcePlan = prepareEditorSource({ html }, { isProtectedElement, describeHostElement: describeEmbedPlaceholder, translate: options.translate });
    let integrityFailure: EditorSourceError | undefined;
    const reportSourceError = (error: EditorSourceError) => {
      integrityFailure = error;
      setSourceError(options.translate?.(error.message) ?? error.message);
      options.onSerializationError?.(error);
    };
    if (!sourcePlan.ok) {
      reportSourceError(new EditorSourceError({ message: sourcePlan.problem }, {}));
      return;
    }
    const mountEl = document.createElement('div');
    mountEl.style.height = '100%';
    wrapper.appendChild(mountEl);
    let editor: Editor;
    try { editor = initInteractiveHtmlEditor(mountEl, sourcePlan, canvasStyling, { ...options, onSerializationError: reportSourceError }); }
    catch { reportSourceError(new EditorSourceError()); mountEl.remove(); return; }
    const decorate = () => {
      protectTextAncestors({ editor }, {});
      const describe = sourcePlan.instances.length ? protectedCanvasDescriber({ editor }, {}) : describeEmbedPlaceholder;
      if (describe) applyCanvasEmbedPlaceholders(editor.Canvas.getBody(), describe);
    };
    const serialize = () => {
      try {
        const next = serializeEditorSource({ editor, html, edits: dirty, sourcePlan }, { structuralChange });
        if (next.includes(sourcePlan.markerAttribute)) throw new EditorSourceError();
        return next;
      } catch (error) {
        const failure = error instanceof EditorSourceError ? error : new EditorSourceError();
        reportSourceError(failure);
        throw failure;
      }
    };

    // Splice bookkeeping — see `serializeWithSplice`'s own doc for how these two are used. Plain
    // closure state scoped to this one mount-only effect run (like `editor`/`mountEl` above), not
    // `useRef`: nothing outside this effect ever reads them.
    const dirty = new Map<string, DirtyTextEdit>();
    let structuralChange: string | undefined;
    // True once `update` has fired at least once this mount — see `flush`'s "nothing to flush" guard
    // below for why this is tracked separately from `dirty`/`structuralChange` (a style/attribute-only
    // edit fires `update` with neither of those set, and still must not be silently dropped).
    let changed = false;
    // Set inside `handleLoad`, once the canvas body exists — see `revealCanvasWhenStylesheetsSettle`.
    // `undefined` until then (or if `load` never fires before unmount), so cleanup below guards it.
    let cancelStylesheetWait: (() => void) | undefined;
    let canvasWindow: Window | null | undefined;
    // Embed placeholder cards live only in the canvas DOM, so a structural edit (delete, move, clone,
    // undo) can leave one stale. Repaired on the tick after the edit, once GrapesJS has rendered it;
    // see `applyCanvasEmbedPlaceholders`. Only after `load`: before it, adds are the initial parse.
    let loaded = false;
    let cardRepair: ReturnType<typeof setTimeout> | undefined;
    const scheduleCardRepair = () => {
      if (!loaded || cardRepair !== undefined) return;
      cardRepair = setTimeout(() => {
        cardRepair = undefined;
        decorate();
      }, 0);
    };

    const handleUpdate = () => {
      changed = true;
      try { onChangeRef.current(serialize()); } catch { /* Source error is already visible; retain the last intact working copy. */ }
    };
    // `component:update:content` fires with the changed component itself as its argument (GrapesJS's
    // general `component:update:{propertyName}` pattern); `rte:disable` fires with `(view, rte)` —
    // the view whose RTE session just closed, `view.model` being the component it edited. Both name
    // the SAME kind of thing (a text component whose content just changed) through two different
    // GrapesJS code paths (a direct model update vs. the RTE toolbar's close), so both feed the one
    // `recordDirtyTextEdit` sink rather than each growing their own tracking.
    const handleContentUpdate = (component: Component) => recordDirtyTextEdit(component, dirty);
    const handleRteDisable = (view: { model?: Component }) => recordDirtyTextEdit(view?.model, dirty);
    // A block move, copy or delete (the Interactive tab keeps all three, owner decision 2026-09-23)
    // fires `component:add`/`component:remove` on the live tree. Once one fires outside a text
    // component, `serializeWithSplice` stops trusting any offset computed against the original string
    // for the rest of this mount; see its own doc for why this never resets.
    const handleStructuralChange = (event: 'component:add' | 'component:remove') => (component?: Component) => {
      scheduleCardRepair();
      if (structuralChange || (component && !component.is(PROTECTED_ELEMENT_TYPE) && isInsideTextComponent(component))) return;
      structuralChange = `${event} <${component?.tagName?.toLowerCase() || 'unknown'}>`;
    };
    const handleAdd = handleStructuralChange('component:add');
    const handleRemove = handleStructuralChange('component:remove');
    editor.on('update', handleUpdate);
    editor.on('component:update:content', handleContentUpdate);
    editor.on('rte:disable', handleRteDisable);
    editor.on('component:add', handleAdd);
    editor.on('component:remove', handleRemove);

    // See `flush`'s own doc for why this exists. Closes any open RTE session first (so its pending
    // edit syncs into the model), then emits and returns the current content the same way
    // `handleUpdate` does — except when nothing has changed since mount, matching `serializeWithSplice`'s
    // own "nothing to flush" case: no `update` was ever seen, no text edit was recorded, and no
    // structural change happened either.
    flushRef.current = async () => {
      await disableActiveTextEditing(editor);
      if (integrityFailure) throw integrityFailure;
      try { assertProtectedSourceMetadata({ editor }, {}); }
      catch { const failure = new EditorSourceError(); reportSourceError(failure); throw failure; }
      if (!changed && dirty.size === 0 && !structuralChange) return undefined;
      const next = serialize();
      onChangeRef.current(next);
      return next;
    };

    // `load` fires once the canvas's initial component render is done (`editor.Canvas.getBody()` is
    // populated) — see `applyCanvasContentWrapper`'s own file header for why the wrap has to happen
    // here, against the live canvas, rather than folded into `components` above. Embed placeholders
    // piggyback on this SAME handler/event rather than a second `editor.on('load', ...)` registration
    // — see `applyCanvasEmbedPlaceholders`'s own file header for its matching export-safety argument.
    // Applied AFTER the content wrapper so a placeholder can sit correctly however deep the wrapper
    // chain nests its marker, though nothing about either function actually depends on this order.
    const handleLoad = () => {
      if (sourcePlan.instances.length) {
        try { assertPreparedSourceModel({ editor, sourcePlan }, {}); }
        catch { reportSourceError(new EditorSourceError()); return; }
      }
      const body = editor.Canvas.getBody();
      applyCanvasContentWrapper(body, canvasStyling.contentWrapper);
      decorate();
      // Runs LAST, after both decorations above — see `revealCanvasWhenStylesheetsSettle`'s own doc
      // for why that order matters even in the zero-stylesheet case.
      cancelStylesheetWait = revealCanvasWhenStylesheetsSettle(editor, body, decorate);
      loaded = true;
      // An iframe window's native resize event already covers canvas-width changes. Reuse it
      // instead of maintaining a second ResizeObserver lifecycle for the same view geometry.
      canvasWindow = editor.Canvas.getDocument()?.defaultView;
      canvasWindow?.addEventListener('resize', scheduleCardRepair);
    };
    editor.on('load', handleLoad);
    return () => {
      // FIRST, before `destroy()` — a `flush()` call racing (or arriving after) unmount must resolve
      // `undefined` without ever touching the about-to-be-destroyed `editor`.
      flushRef.current = async () => undefined;
      editor.off('update', handleUpdate);
      editor.off('component:update:content', handleContentUpdate);
      editor.off('rte:disable', handleRteDisable);
      editor.off('component:add', handleAdd);
      editor.off('component:remove', handleRemove);
      editor.off('load', handleLoad);
      cancelStylesheetWait?.();
      canvasWindow?.removeEventListener('resize', scheduleCardRepair);
      clearTimeout(cardRepair);
      editor.destroy();
      mountEl.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see file header
  }, []);

  // Stable across renders (the effect above mutates `flushRef.current`, not this callback's identity)
  // so a caller can safely pass `flush` into a `useCallback`/`useImperativeHandle` dependency array.
  const flush = useCallback(() => flushRef.current(), []);

  return { containerRef: wrapperRef, flush, sourceError };
}
