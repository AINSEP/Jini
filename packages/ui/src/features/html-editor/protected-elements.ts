import type { Component, Editor } from 'grapesjs';
import type { CanvasEmbedPlaceholderDescriptor } from './canvas-embed-placeholders.js';
import { findEditorBlockOpening, type PreparedEditorSource, type RequestEditHtml } from './editor-blocks.js';

export const PROTECTED_ELEMENT_TYPE = 'protected-element';

/** Distinguishable from an ordinary best-effort RTE timeout: never persist a damaged raw shell. */
export class EditorSourceError extends Error {
  readonly code = 'EDITOR_SOURCE_INTEGRITY';
  constructor({ message = "Can't edit this source visually. Use HTML." }: { message?: string } = {}, _options: object = {}) { super(message); this.name = 'EditorSourceError'; }
}
export function isEditorSourceError({ error }: { error: unknown }, _options: object = {}): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'EDITOR_SOURCE_INTEGRITY';
}

/** Source lives only on the component model, so clone and undo carry it with ordinary model state. */
export function protectedElementHtml({ component }: { component: Pick<Component, 'get'> }, _options: object = {}): string {
  const original = component.get('originalHtml');
  if (typeof original !== 'string' || original.length === 0) throw new EditorSourceError();
  return original;
}

function visit(component: Component, callback: (component: Component) => void): void {
  callback(component);
  component.components().models.forEach(child => visit(child, callback));
}

/** Check surviving instances before any export or no-op flush; deletion itself is allowed. */
export function assertProtectedSourceMetadata({ editor }: { editor: Editor }, _options: object = {}): void {
  const wrapper = editor.getWrapper();
  if (wrapper) visit(wrapper, component => {
    if (component.is(PROTECTED_ELEMENT_TYPE)) protectedElementHtml({ component }, {});
  });
}

/** Verify initial parser ownership before the first visual edit; recovered/lost shells fail closed. */
export function assertPreparedSourceModel(
  { editor, sourcePlan }: { editor: Editor; sourcePlan: PreparedEditorSource }, _options: object = {},
): void {
  const actual: string[] = [];
  const wrapper = editor.getWrapper();
  if (!wrapper) throw new EditorSourceError();
  visit(wrapper, component => {
    if (component.is(PROTECTED_ELEMENT_TYPE)) actual.push(protectedElementHtml({ component }, {}));
  });
  if (actual.length !== sourcePlan.instances.length || actual.some((html, i) => html !== sourcePlan.instances[i]!.originalHtml)) {
    throw new EditorSourceError();
  }
}

/** Text ancestors must not sync canvas-only card chrome back into a model during RTE close. */
export function protectTextAncestors({ editor }: { editor: Editor }, _options: object = {}): void {
  const wrapper = editor.getWrapper();
  if (!wrapper) return;
  visit(wrapper, component => {
    if (!component.is(PROTECTED_ELEMENT_TYPE)) return;
    for (let parent = component.parent(); parent; parent = parent.parent()) {
      if (parent.is('text')) parent.set('editable', false, { silent: true });
    }
  });
}

/** Same canvas card path, addressed through model metadata rather than authored/public selectors. */
export function protectedCanvasDescriber({ editor }: { editor: Editor }, _options: object = {}):
  (el: Element) => CanvasEmbedPlaceholderDescriptor | undefined {
  const descriptors = new Map<Element, CanvasEmbedPlaceholderDescriptor>();
  const wrapper = editor.getWrapper();
  if (wrapper) visit(wrapper, component => {
    if (!component.is(PROTECTED_ELEMENT_TYPE) || component.get('sourceNonvisual')) return;
    const el = component.getEl();
    const descriptor = component.get('placeholderDescriptor') as CanvasEmbedPlaceholderDescriptor | undefined;
    if (el && descriptor) descriptors.set(el, descriptor);
  });
  return el => descriptors.get(el);
}

/**
 * Registers the `protected-element` component type so any parsed element `isProtectedElement`
 * recognizes becomes one atomic block: its content can never be edited (excluded from RTE
 * content-editing, including as a nested island inside a `text` component), dropped into, or styled,
 * but the element itself is selectable and can be deliberately moved, copied or deleted like any other
 * block. Selectable matters for safety: a non-selectable element hands a click to its nearest
 * selectable ancestor, so clicking an embed selected the block around it and Delete then removed that
 * block together with the embed. Pair it with `applyCanvasEmbedPlaceholders`, which makes the marker
 * the clickable surface of its card. Passed as a `plugins` entry so it registers before
 * `editor.setComponents` parses the initial `html` (see `initInteractiveHtmlEditor` below).
 *
 * @complexity O(1) — one type registration; the per-element check GrapesJS then runs during parsing
 * is O(1) per element (whatever `isProtectedElement` costs), not owned by this function.
 * @overallScore 100
 */
/**
 * One protected type for runtime roots, host embeds and nonvisual atoms. Registration precedes
 * parsing; isComponent resolves mount-private tokens to metadata and supplies empty children.
 */
export function registerProtectedElementType(
  { editor, sourcePlan }: { editor: Editor; sourcePlan: PreparedEditorSource },
  options: { onRequestEditHtml?: RequestEditHtml | undefined; editHtmlLabel?: string | undefined; beforeRequestEditHtml?: () => Promise<void>; onSerializationError?: ((error: EditorSourceError) => void) | undefined } = {},
): void {
  const command = 'jini:protected-edit-html';
  const requestEditHtml = options.onRequestEditHtml;
  if (requestEditHtml) editor.Commands.add(command, {
    async run() {
      try {
        await options.beforeRequestEditHtml?.();
        const selected = editor.getSelected();
        const wrapper = editor.getWrapper();
        if (!selected?.is(PROTECTED_ELEMENT_TYPE) || !wrapper || selected.get('sourceNonvisual')) return;
        const original = protectedElementHtml({ component: selected }, {});
        const html = wrapper.getInnerHTML();
        // Search only exact authored slices. Copies share bytes, so count preceding equal instances
        // in model order; no mapping export mode or persistent source tokens are needed.
        let copiesBefore = 0;
        let reached = false;
        visit(wrapper, component => {
          if (component === selected) reached = true;
          else if (!reached && component.is(PROTECTED_ELEMENT_TYPE) && protectedElementHtml({ component }, {}) === original) copiesBefore++;
        });
        let start = -1;
        for (let i = 0; i <= copiesBefore; i++) start = html.indexOf(original, start + 1);
        if (start < 0) throw new EditorSourceError();
        const tagName = selected.get('sourceTagName') as string;
        const id = selected.get('sourceId') as string | undefined;
        let occurrenceIndex = 0;
        for (;;) {
          const range = findEditorBlockOpening({ html, target: { occurrenceIndex, tagName, ...(id ? { id } : {}) } }, {});
          if (!range || range.start > start) throw new EditorSourceError();
          if (range.start === start) break;
          occurrenceIndex++;
        }
        await requestEditHtml({ occurrenceIndex, tagName, ...(id ? { id } : {}) }, {});
      } catch (error) {
        options.onSerializationError?.(error instanceof EditorSourceError ? error : new EditorSourceError());
      }
    },
  });
  editor.Components.addType(PROTECTED_ELEMENT_TYPE, {
    isComponent(el) {
      const token = typeof el.getAttribute === 'function' ? el.getAttribute(sourcePlan.markerAttribute)
        : (el as unknown as { attributes?: Record<string, string> }).attributes?.[sourcePlan.markerAttribute];
      if (token === null || token === undefined) return undefined;
      const instance = sourcePlan.instances[Number(token)];
      if (!instance || String(Number(token)) !== token) throw new EditorSourceError();
      return {
        type: PROTECTED_ELEMENT_TYPE, originalHtml: instance.originalHtml, sourceTagName: instance.tagName,
        sourceId: instance.id, sourceNonvisual: instance.nonvisual, placeholderDescriptor: instance.descriptor,
        components: [], content: '',
      };
    },
    model: {
      defaults: {
        editable: false, droppable: false, stylable: false, resizable: false, traits: [],
        layerable: false, badgable: false, selectable: true, hoverable: true, highlightable: true,
        removable: true, draggable: true, copyable: true,
      },
      init(this: Component) {
        // Keep default move/copy/delete toolbar commands, then append the host navigation action.
        if (!this.get('sourceNonvisual') && options.onRequestEditHtml) {
          const toolbar = (this.get('toolbar') ?? []) as { command: string }[];
          this.set('toolbar', [...toolbar.filter(item => item.command !== command), {
            label: options.editHtmlLabel ?? 'Edit HTML', command,
            // GrapesJS sizes every toolbar item as a 26px icon square; a text label overflowed past the
            // toolbar (and the canvas edge on full-width blocks), so this item sizes to its label.
            attributes: {
              title: options.editHtmlLabel ?? 'Edit HTML', 'aria-label': options.editHtmlLabel ?? 'Edit HTML',
              style: 'width:auto;white-space:nowrap;padding:5px 8px',
            },
          }], { silent: true });
        }
        if (this.get('sourceNonvisual')) this.set({ selectable: false, draggable: false, hoverable: false, copyable: false }, { silent: true });
      },
      toHTML(this: Component) { return protectedElementHtml({ component: this }, {}); },
    },
    view: {
      onRender(this: { model: Component; el: HTMLElement }) {
        this.el.setAttribute('contenteditable', 'false');
        if (this.model.get('sourceNonvisual')) this.el.style.setProperty('display', 'none', 'important');
      },
    },
  });
}
