import grapesjs, { type Component, type Editor } from 'grapesjs';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareEditorSource } from '../editor-blocks.js';
import { EditorSourceError, isEditorSourceError, PROTECTED_ELEMENT_TYPE, protectedCanvasDescriber, registerProtectedElementType } from '../protected-elements.js';

const editors: Editor[] = [];
afterEach(async () => { await Promise.all(editors.splice(0).map(editor => editor.destroy())); });

function mount(html: string) {
  const plan = prepareEditorSource({ html }, {});
  if (!plan.ok) throw new Error(plan.problem);
  const editor = grapesjs.init({ headless: true, autorender: false, components: plan.html, storageManager: false,
    plugins: [e => registerProtectedElementType({ editor: e, sourcePlan: plan }, {})] });
  editors.push(editor);
  const blocks = editor.getWrapper()!.findType(PROTECTED_ELEMENT_TYPE);
  return { editor, plan, blocks };
}

type ViewCtor = new (options: { model: Component; config: unknown }) => { el: HTMLElement; render: () => unknown };

/** Headless GrapesJS builds no canvas views; render the registered view class directly, as the canvas would. */
function renderView(editor: Editor, model: Component): HTMLElement {
  const View = editor.Components.getType(PROTECTED_ELEMENT_TYPE)!.view as unknown as ViewCtor;
  const view = new View({ model, config: editor.Components.config });
  view.render();
  return view.el;
}

const visualAndNonvisual = '<p>x</p><div data-kui="marquee">a</div><style>p{}</style>';

describe('isEditorSourceError', () => {
  it('recognizes the integrity error by its code, including a copy from another realm', () => {
    expect(isEditorSourceError({ error: new EditorSourceError() })).toBe(true);
    expect(isEditorSourceError({ error: { code: 'EDITOR_SOURCE_INTEGRITY' } })).toBe(true);
  });

  it('rejects ordinary errors, other codes and non-objects', () => {
    expect(isEditorSourceError({ error: new Error('timeout') })).toBe(false);
    expect(isEditorSourceError({ error: { code: 'OTHER' } })).toBe(false);
    expect(isEditorSourceError({ error: 'EDITOR_SOURCE_INTEGRITY' })).toBe(false);
    expect(isEditorSourceError({ error: null })).toBe(false);
  });
});

describe('protected element view', () => {
  it('renders every protected element non-editable and hides only the nonvisual atoms', () => {
    const { editor, blocks } = mount(visualAndNonvisual);
    const [visual, nonvisual] = blocks;
    const visualEl = renderView(editor, visual!);
    const nonvisualEl = renderView(editor, nonvisual!);
    expect(visualEl.getAttribute('contenteditable')).toBe('false');
    expect(visualEl.style.getPropertyValue('display')).toBe('');
    expect(nonvisualEl.getAttribute('contenteditable')).toBe('false');
    expect(nonvisualEl.style.getPropertyValue('display')).toBe('none');
    expect(nonvisualEl.style.getPropertyPriority('display')).toBe('important');
  });
});

describe('protectedCanvasDescriber', () => {
  it('maps a rendered visual block element to its placeholder descriptor and nothing else', () => {
    const { editor, blocks } = mount(visualAndNonvisual);
    const [visual, nonvisual] = blocks;
    const visualEl = renderView(editor, visual!);
    const nonvisualEl = renderView(editor, nonvisual!);
    const describe = protectedCanvasDescriber({ editor }, {});
    expect(describe(visualEl)).toEqual(visual!.get('placeholderDescriptor'));
    expect(describe(visualEl)).toBeDefined();
    expect(describe(nonvisualEl)).toBeUndefined();
    expect(describe(document.createElement('div'))).toBeUndefined();
  });

  it('describes nothing for blocks that have no rendered element yet', () => {
    const { editor } = mount(visualAndNonvisual);
    const describe = protectedCanvasDescriber({ editor }, {});
    expect(describe(document.createElement('div'))).toBeUndefined();
  });
});

describe('protected element recognition', () => {
  type Recognizer = { isComponent: (el: unknown) => { type?: string; originalHtml?: string } | undefined };
  const recognizer = (editor: Editor) => editor.Components.getType(PROTECTED_ELEMENT_TYPE)!.model as unknown as Recognizer;

  it('recognizes GrapesJS parsed-node shapes, whose attributes are a plain object without getAttribute', () => {
    const { editor, plan } = mount(visualAndNonvisual);
    const parsed = recognizer(editor).isComponent({ attributes: { [plan.markerAttribute]: '0' } });
    expect(parsed).toMatchObject({ type: PROTECTED_ELEMENT_TYPE, originalHtml: plan.instances[0]!.originalHtml });
    expect(recognizer(editor).isComponent({ attributes: {} })).toBeUndefined();
    expect(recognizer(editor).isComponent({ tagName: 'p' })).toBeUndefined();
  });

  it('fails closed on a marker token that is not the canonical spelling of an instance index', () => {
    const { editor, plan } = mount(visualAndNonvisual);
    const el = document.createElement('div');
    el.setAttribute(plan.markerAttribute, '00');
    expect(() => recognizer(editor).isComponent(el)).toThrow(EditorSourceError);
  });
});
