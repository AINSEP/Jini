import { useEffect, useRef } from 'react';
import grapesjs, { type Component, type Editor } from 'grapesjs';
import { applyCanvasContentWrapper } from '../../canvas-content-wrapper.js';
import { applyCanvasEmbedPlaceholders, type CanvasEmbedPlaceholderDescriptor } from '../../canvas-embed-placeholders.js';
import { buildCanvasStyleConfig, CANVAS_STYLES_PENDING_CLASS, type CanvasStyling } from '../../canvas-style.js';
import { prettifyCss } from '../../css.js';
import { indexElementSourceRanges, pathKey, spliceElementInner, type ElementPath } from '../../source-splice.js';

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
 * **This module has zero knowledge of what "protected" means.** It only knows how to register a
 * locked GrapesJS component type for whatever `isProtectedElement` predicate its caller supplies —
 * see this file's `registerProtectedElementType`. The predicate itself (e.g. recognizing a host's own
 * embed-placeholder convention) belongs to the caller, not this primitive.
 *
 * **`canvasStyling.contentWrapper` is applied on `load`, against the live canvas — never folded into
 * `components` above.** See `../../canvas-content-wrapper.ts`'s own file header for why: GrapesJS's
 * exported HTML/CSS are built from its component model, which `components` seeds and this wrapper
 * never touches, so it cannot leak into a save no matter how the canvas is edited afterward.
 */

const PROTECTED_ELEMENT_TYPE = 'protected-element';

/** Bold/italic/link only. GrapesJS's other built-in RTE actions (underline, strikethrough, wrap) are
 *  omitted, not merely unconfigured, by naming exactly these three rather than leaving the default
 *  action list in place. */
const RTE_ACTIONS = ['bold', 'italic', 'link'];

/**
 * Registers the `protected-element` component type so any parsed element `isProtectedElement`
 * recognizes is locked out of every GrapesJS interaction that could mutate or move it: not editable
 * (excluded from RTE content-editing, including as a nested island inside a `text` component), not
 * draggable/droppable/removable, and hidden from the layers/style/settings panels this component's
 * minimal chrome does not render anyway. Passed as a `plugins` entry so it registers before
 * `editor.setComponents` parses the initial `html` (see `initInteractiveHtmlEditor` below).
 *
 * @complexity O(1) — one type registration; the per-element check GrapesJS then runs during parsing
 * is O(1) per element (whatever `isProtectedElement` costs), not owned by this function.
 * @overallScore 100
 */
function registerProtectedElementType(editor: Editor, isProtectedElement: (el: Element) => boolean): void {
  editor.Components.addType(PROTECTED_ELEMENT_TYPE, {
    isComponent: (el) => (isProtectedElement(el) ? { type: PROTECTED_ELEMENT_TYPE } : undefined),
    model: {
      defaults: {
        editable: false,
        draggable: false,
        droppable: false,
        removable: false,
        selectable: false,
        highlightable: false,
        hoverable: false,
        layerable: false,
        badgable: false,
        stylable: false,
      },
    },
  });
}

function initInteractiveHtmlEditor(
  container: HTMLElement,
  html: string,
  isProtectedElement: ((el: Element) => boolean) | undefined,
  canvasStyling: CanvasStyling,
): Editor {
  return grapesjs.init({
    container,
    height: '100%',
    fromElement: false,
    components: html,
    storageManager: { type: 'none' },
    panels: { defaults: [] },
    blockManager: { blocks: [] },
    richTextEditor: { actions: RTE_ACTIONS },
    // Default `true`. Left `true`, GrapesJS rewrites every inline `style="…"` into a generated
    // `#iXXXX` CSS rule the moment ANY edit triggers a re-sync — including on elements the operator
    // never touched — which is one of Bug C's root-cause symptoms (see this repo's `pages-redo` plan,
    // "Bug C"). `false` here is the editor-wide config half of that fix; `serializeCleaned` below is
    // the other half (the splice path does not depend on this at all, since it never re-serializes
    // untouched elements from the component model in the first place).
    avoidInlineStyle: false,
    canvas: buildCanvasStyleConfig(canvasStyling),
    plugins: isProtectedElement
      ? [(editor: Editor) => registerProtectedElementType(editor, isProtectedElement)]
      : [],
  });
}

/** One accumulated text edit, keyed by `pathKey(path)` in the caller's `dirty` map: the element-only
 *  path and tag name `spliceElementInner` needs to locate and verify the target, plus the new inner
 *  HTML to splice in. See `serializeWithSplice`'s own doc for why the map accumulates across the
 *  whole mount rather than resetting per edit. */
interface DirtyTextEdit {
  readonly path: ElementPath;
  readonly tagName: string;
  readonly inner: string;
}

/** Mirrors `source-splice.ts`'s own `UNINDEXED_TAGS` filter, but for GrapesJS's live component tree
 *  rather than a parsed HTML string: `textnode` and `comment` components never consume a path slot,
 *  matching how `indexElementSourceRanges` numbers the original string. No equivalent check is needed
 *  for `style`/`script` here — GrapesJS never represents either as a tree component in the first
 *  place (moved into `CssComposer`, or dropped outright), so a live sibling list already excludes
 *  them without this hook's help. */
function isPathableComponent(component: Component): boolean {
  return !component.is('textnode') && !component.is('comment');
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
  dirty.set(pathKey(path), { path, tagName: component.tagName.toLowerCase(), inner: component.getInnerHTML() });
}

/** Dev-only, so a fallback is never silent — see `serializeWithSplice` for each trigger this names. */
function warnFallback(reason: string): void {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[useInteractiveHtmlEditor] falling back to full re-serialization: ${reason}`);
  }
}

/**
 * Fallback whole-document serialization for when the lossless splice (see `serializeWithSplice`)
 * cannot be trusted. This is the "cleaned" formula from this repo's `pages-redo` plan ("Bug C"), and
 * differs from the whole-document serialization this hook used before the splice existed:
 * `avoidProtected: true` on `getCss()` drops GrapesJS's own `* { box-sizing: border-box; } body
 * {margin: 0;}` block, which GrapesJS otherwise prepends even to a page with no CSS of its own; and
 * `getWrapper().getInnerHTML()` — the wrapper's INNER content — omits the `<body>` tag `editor.
 * getHtml()` serializes the wrapper component itself as. Combined with `avoidInlineStyle: false` on
 * the editor's own config (see `initInteractiveHtmlEditor`), inline `style="…"` attributes also
 * survive here instead of being rewritten into generated `#iXXXX` CSS rules. Still not a byte-
 * identical round trip — this is a full re-serialization from GrapesJS's component model, which
 * cannot recover the original string's entities or authored formatting — just the least-lossy shape
 * available when a true splice is not possible.
 *
 * `keepUnusedStyles: true` carries over unchanged from the serialization this replaces: real
 * documents commonly carry `@media` blocks and `::before`/`::after` rules that don't correspond to
 * any single "matched" component in the tree, which GrapesJS's default CSS export can otherwise drop.
 */
function serializeCleaned(editor: Editor): string {
  const css = editor.getCss({ avoidProtected: true, keepUnusedStyles: true });
  const wrapper = editor.getWrapper();
  // `wrapper` is undefined only before/without a successful init, which cannot be true once this
  // hook's `editor` has fired `update` — defensive only, mirroring `serializeCleaned`'s own doc.
  const html = wrapper ? wrapper.getInnerHTML() : editor.getHtml();
  return css ? `<style>${prettifyCss(css)}</style>${html}` : html;
}

/**
 * Builds this edit cycle's exported HTML. The default path splices every accumulated dirty text edit
 * (see `recordDirtyTextEdit`) back into the ORIGINAL source string via `spliceElementInner` (see
 * `source-splice.ts`), so every other byte — entities, attribute quoting, an untouched embed marker,
 * unrelated formatting — passes through unchanged instead of being rebuilt from GrapesJS's component
 * model. Falls back to `serializeCleaned` (and warns via `warnFallback`, so it is never silent)
 * whenever that guarantee cannot be trusted:
 *  - `hadStructuralChange` — a component was added or removed since mount (a block move, clone, or
 *    delete fires both: a remove then an add). Every dirty path's offset was computed against the
 *    pristine `original` string; once the LIVE tree's shape has diverged from it, those offsets (and
 *    even the paths themselves) can silently address the wrong element instead of failing loudly, so
 *    this is checked first and unconditionally, regardless of what is or isn't in `dirty`. There is no
 *    path back to `false` once this flips — a later purely-textual edit still cannot trust offsets
 *    computed before the structural change, so the whole rest of the mount stays on the cleaned path.
 *  - `dirty` is empty — `update` fired (a real content/style/attribute mutation happened) but no
 *    text-component edit was ever recorded for it. Nothing addressable means nothing spliceable.
 *  - any individual `spliceElementInner` call returns `null` — that path's element is no longer where
 *    it was, or its tag no longer matches what the live component believes.
 *
 * Dirty edits are applied in descending original-offset order (highest first): a splice at a later
 * offset never shifts the byte positions of anything before it, so replaying strictly back-to-front
 * lets every subsequent `spliceElementInner` call re-locate its own (still-untouched-until-its-turn)
 * range correctly without this function tracking running offset deltas itself.
 *
 * @complexity O(n·k) where n = size of `original` (each of up to k dirty splices re-indexes the
 * current string internally) and k = number of dirty edits accumulated this mount — small in
 * practice (an operator edits a handful of elements per session), never a hot loop here.
 */
function serializeWithSplice(
  editor: Editor,
  original: string,
  dirty: Map<string, DirtyTextEdit>,
  hadStructuralChange: boolean,
): string {
  if (hadStructuralChange) {
    warnFallback('a structural (block) edit — add/remove — happened since mount');
    return serializeCleaned(editor);
  }
  if (dirty.size === 0) {
    warnFallback('no text edit was recorded for this change');
    return serializeCleaned(editor);
  }

  const originalIndex = indexElementSourceRanges(original);
  const ordered = [...dirty.values()].sort((a, b) => {
    const aStart = originalIndex.get(pathKey(a.path))?.start ?? -1;
    const bStart = originalIndex.get(pathKey(b.path))?.start ?? -1;
    return bStart - aStart;
  });

  let result = original;
  for (const edit of ordered) {
    const spliced = spliceElementInner(result, edit.path, edit.tagName, edit.inner);
    if (spliced === null) {
      warnFallback(`element at path "${pathKey(edit.path)}" could not be spliced (removed, or its tag drifted)`);
      return serializeCleaned(editor);
    }
    result = spliced;
  }
  return result;
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
function revealCanvasWhenStylesheetsSettle(editor: Editor, body: HTMLElement): () => void {
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
 * @complexity O(1) setup/teardown. Steady-state cost is GrapesJS's own serialization per edit,
 * proportional to document size — not something this hook controls or should hide a note about
 * beyond that.
 * @overallScore 100
 */
export function useInteractiveHtmlEditor(
  html: string,
  onChange: (html: string) => void,
  isProtectedElement?: (el: Element) => boolean,
  canvasStyling: CanvasStyling = {},
  describeEmbedPlaceholder?: (el: Element) => CanvasEmbedPlaceholderDescriptor | undefined,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const mountEl = document.createElement('div');
    mountEl.style.height = '100%';
    wrapper.appendChild(mountEl);
    const editor = initInteractiveHtmlEditor(mountEl, html, isProtectedElement, canvasStyling);

    // Splice bookkeeping — see `serializeWithSplice`'s own doc for how these two are used. Plain
    // closure state scoped to this one mount-only effect run (like `editor`/`mountEl` above), not
    // `useRef`: nothing outside this effect ever reads them.
    const dirty = new Map<string, DirtyTextEdit>();
    let hadStructuralChange = false;
    // Set inside `handleLoad`, once the canvas body exists — see `revealCanvasWhenStylesheetsSettle`.
    // `undefined` until then (or if `load` never fires before unmount), so cleanup below guards it.
    let cancelStylesheetWait: (() => void) | undefined;

    const handleUpdate = () => onChangeRef.current(serializeWithSplice(editor, html, dirty, hadStructuralChange));
    // `component:update:content` fires with the changed component itself as its argument (GrapesJS's
    // general `component:update:{propertyName}` pattern); `rte:disable` fires with `(view, rte)` —
    // the view whose RTE session just closed, `view.model` being the component it edited. Both name
    // the SAME kind of thing (a text component whose content just changed) through two different
    // GrapesJS code paths (a direct model update vs. the RTE toolbar's close), so both feed the one
    // `recordDirtyTextEdit` sink rather than each growing their own tracking.
    const handleContentUpdate = (component: Component) => recordDirtyTextEdit(component, dirty);
    const handleRteDisable = (view: { model?: Component }) => recordDirtyTextEdit(view?.model, dirty);
    // A block move, clone, or delete — the drag/clone/delete toolbar Interactive scope does not yet
    // turn off (see this repo's `pages-redo` plan, "Bug C" design, Owner question 2) — fires
    // `component:add`/`component:remove` on the live tree. Once either fires, `serializeWithSplice`
    // stops trusting any offset computed against the original string for the rest of this mount; see
    // its own doc for why this never resets back to `false`.
    const handleStructuralChange = () => {
      hadStructuralChange = true;
    };
    editor.on('update', handleUpdate);
    editor.on('component:update:content', handleContentUpdate);
    editor.on('rte:disable', handleRteDisable);
    editor.on('component:add', handleStructuralChange);
    editor.on('component:remove', handleStructuralChange);
    // `load` fires once the canvas's initial component render is done (`editor.Canvas.getBody()` is
    // populated) — see `applyCanvasContentWrapper`'s own file header for why the wrap has to happen
    // here, against the live canvas, rather than folded into `components` above. Embed placeholders
    // piggyback on this SAME handler/event rather than a second `editor.on('load', ...)` registration
    // — see `applyCanvasEmbedPlaceholders`'s own file header for its matching export-safety argument.
    // Applied AFTER the content wrapper so a placeholder can sit correctly however deep the wrapper
    // chain nests its marker, though nothing about either function actually depends on this order.
    const handleLoad = () => {
      const body = editor.Canvas.getBody();
      applyCanvasContentWrapper(body, canvasStyling.contentWrapper);
      if (describeEmbedPlaceholder) applyCanvasEmbedPlaceholders(body, describeEmbedPlaceholder);
      // Runs LAST, after both decorations above — see `revealCanvasWhenStylesheetsSettle`'s own doc
      // for why that order matters even in the zero-stylesheet case.
      cancelStylesheetWait = revealCanvasWhenStylesheetsSettle(editor, body);
    };
    editor.on('load', handleLoad);
    return () => {
      editor.off('update', handleUpdate);
      editor.off('component:update:content', handleContentUpdate);
      editor.off('rte:disable', handleRteDisable);
      editor.off('component:add', handleStructuralChange);
      editor.off('component:remove', handleStructuralChange);
      editor.off('load', handleLoad);
      cancelStylesheetWait?.();
      editor.destroy();
      mountEl.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see file header
  }, []);

  return { containerRef: wrapperRef };
}
