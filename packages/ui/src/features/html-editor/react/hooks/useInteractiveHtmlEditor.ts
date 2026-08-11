import { useEffect, useRef } from 'react';
import grapesjs, { type Editor } from 'grapesjs';
import { prettifyCss } from '../../css.js';

/**
 * @file `InteractiveHtmlEditor`'s GrapesJS lifecycle: construct the editor once per mount against
 * the container ref, wire content-change notifications out, and tear the editor down on unmount.
 * Split from the component the same reason `ConfirmDialog.hooks.tsx` is split from `ConfirmDialog.tsx`
 * in `@jini-ai/admin` — the imperative, non-React lifecycle (`grapesjs.init`/`editor.destroy`) stays
 * out of the render path, and a test can drive it independently of the markup.
 *
 * **Uncontrolled by design.** `html` (and `isProtectedElement`) are read once, at construction — this
 * hook does not react to later changes in either argument. GrapesJS owns an internal component tree
 * once initialized; feeding an external string back into a live editor on every parent re-render
 * (which is what a naive `useEffect([html])` would do, since this same hook's own `onChange` callback
 * pushes edits back up into whatever state produced the `html` prop) would either fight the operator's
 * cursor or require diffing GrapesJS's tree against a string to detect "did this change come from us",
 * which is real complexity this component's text-editing-only scope does not need. A host that needs a
 * fresh document only mounts this component while it's active and remounts with fresh `html` — see
 * `@jini-ai/admin/react`'s `InteractiveHtmlEditor` adapter and its caller in Tovu's `PageEditor.tsx`.
 *
 * **This module has zero knowledge of what "protected" means.** It only knows how to register a
 * locked GrapesJS component type for whatever `isProtectedElement` predicate its caller supplies —
 * see this file's `registerProtectedElementType`. The predicate itself (e.g. recognizing a host's own
 * embed-placeholder convention) belongs to the caller, not this primitive.
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
    plugins: isProtectedElement
      ? [(editor: Editor) => registerProtectedElementType(editor, isProtectedElement)]
      : [],
  });
}

/**
 * `editor.getHtml()` and `editor.getCss()` are separate outputs in GrapesJS — the component tree
 * and its CSS rules live in independent models (`CodeManager` vs `CssComposer`). Confirmed live, the
 * hard way: calling `getHtml()` alone silently drops every CSS rule the moment a real edit triggers
 * GrapesJS's component-tree re-sync (before any edit, GrapesJS passes an unparsed `<style>` block
 * through untouched, masking this; after one real edit, `getHtml()`'s output is built fresh from the
 * component model, which has no CSS in it at all — reproduced with a real page's content: one text
 * edit took `getHtml()`'s output from 8215 characters down to 3160, `<style>` block and all rules
 * gone, the typed edit itself the only thing that survived). `keepUnusedStyles: true` on `getCss()`
 * matters here specifically: real documents commonly carry `@media` blocks and `::before`/`::after`
 * rules that don't correspond to any single "matched" component in the tree — GrapesJS's default CSS
 * export can drop rules it doesn't consider currently referenced, which would silently re-lose exactly
 * the kind of rule a real design (dark-mode variants, decorative pseudo-elements) depends on.
 */
function serializeEditorContent(editor: Editor): string {
  const css = editor.getCss({ keepUnusedStyles: true });
  const html = editor.getHtml();
  return css ? `<style>${prettifyCss(css)}</style>${html}` : html;
}

/**
 * Owns one GrapesJS `Editor` instance for the lifetime of the calling component's mount. `onChange`
 * fires with the editor's current serialized content (see `serializeEditorContent`) on every content
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
    const editor = initInteractiveHtmlEditor(mountEl, html, isProtectedElement);
    const handleUpdate = () => onChangeRef.current(serializeEditorContent(editor));
    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
      editor.destroy();
      mountEl.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see file header
  }, []);

  return { containerRef: wrapperRef };
}
