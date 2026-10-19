import grapesjs, { type AddComponentTypeOptions, type Component, type ComponentView, type Editor } from 'grapesjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareEditorSource, type RequestEditHtml } from '../editor-blocks.js';
import {
  assertPreparedSourceModel, assertProtectedSourceMetadata, EditorSourceError, isEditorSourceError, PROTECTED_ELEMENT_TYPE,
  protectedCanvasDescriber, protectTextAncestors, registerProtectedElementType,
} from '../protected-elements.js';
import { serializeEditorSource } from '../editor-serialization.js';

// Headless model/parser tests exercise real GrapesJS serialization without waiting on iframe load.
// Selection, drag/drop, RTE chrome and canvas stylesheet sizing still require the browser check.
const editors: Editor[] = [];
type RegisterOptions = Parameters<typeof registerProtectedElementType>[1];
function mountWith({ html }: { html: string }, options: RegisterOptions = {}) {
  const plan = prepareEditorSource({ html }, {});
  if (!plan.ok) throw new Error(plan.problem);
  const editor = grapesjs.init({ headless: true, autorender: false, components: plan.html, avoidInlineStyle: false, forceClass: false,
    parser: { optionsHtml: { allowScripts: false, keepEmptyTextNodes: true } },
    storageManager: false, plugins: [editor => registerProtectedElementType({ editor, sourcePlan: plan }, options)] });
  editors.push(editor);
  assertPreparedSourceModel({ editor, sourcePlan: plan }, {});
  return { editor, plan, wrapper: editor.getWrapper()! };
}
function mount(html: string, onRequestEditHtml?: RequestEditHtml) {
  return mountWith({ html }, { onRequestEditHtml });
}
afterEach(async () => { await Promise.all(editors.splice(0).map(editor => editor.destroy())); });
// data-editor="block": a phrasing-only span with data-kui alone is an editable text effect.
const raw = `<span data-kui data-editor="block" title='x > y'>😀 &amp;\r\n<b>never render</b></span>`;

describe('same protected type — exact raw model contract', () => {
  it('moving a styled section keeps inline declarations, gaps and raw atoms without synthesized CSS', () => {
    const atoms = `<style>p { color : red; }</style><script>keep()</script>${raw}`;
    const html = `<main>\n\t<section id="a" style="color:red;--ratio:16 / 9;">A</section> \n<section id="b" style="margin-top:2px;">B</section>\n</main>${atoms}`;
    const { editor, plan, wrapper } = mount(html);
    const parent = wrapper.components().at(0);
    parent.components().models.find(component => component.getId() === 'a')!.move(parent, { at: parent.components().length });
    const moved = `<main>\n\t \n<section id="b" style="margin-top:2px;">B</section>\n<section id="a" style="color:red;--ratio:16 / 9;">A</section></main>${atoms}`;
    const output = serializeEditorSource({ editor, html, sourcePlan: plan, edits: new Map() }, { structuralChange: 'move' });
    expect(output).toBe(moved);
    expect(output).not.toMatch(/class="[^"]*\bc\d+\b/);
    for (const atom of plan.instances) expect(output.split(atom.originalHtml).length - 1).toBe(1);
    editor.Css.setRule('.unused::before', { content: '"x"' });
    editor.Css.setRule('.unused', { color: 'blue' }, { atRuleType: 'media', atRuleParams: '(min-width: 500px)' });
    expect(serializeEditorSource({ editor, html, sourcePlan: plan, edits: new Map() }, { structuralChange: 'move' })).toBe(
      '<style>.unused::before {\n  content: "x";\n}\n\n@media (min-width: 500px) {\n  .unused {\n    color: blue;\n  }\n}</style>' + moved,
    );
  });
  it('exports identical bytes directly, through a text parent, a container and wrapper', () => {
    const { wrapper } = mount(`<section><p>before ${raw} after</p></section>`);
    const block = wrapper.findType('protected-element')[0]!;
    expect(block.components().length).toBe(0);
    expect(block.toHTML()).toBe(raw);
    expect(wrapper.components().at(0).getInnerHTML()).toContain(raw);
    expect(wrapper.getInnerHTML()).toBe(`<section><p>before ${raw} after</p></section>`);
    expect(block.getAttributes()).not.toHaveProperty('originalHtml');
    expect(block.get('editable')).toBe(false);
    expect(block.get('droppable')).toBe(false);
    expect(block.get('stylable')).toBe(false);
    expect(block.get('resizable')).toBe(false);
    for (const flag of ['selectable', 'removable', 'draggable', 'copyable']) expect(block.get(flag)).toBe(true);
  });
  it('clone retains metadata, delete omits it, undo/redo restores source', () => {
    const { editor, wrapper } = mount(`<p>neighbour</p>${raw}`);
    const block = wrapper.findType('protected-element')[0]!;
    const clone = block.clone();
    wrapper.append(clone);
    expect(clone.toHTML()).toBe(raw);
    expect(wrapper.getInnerHTML().split(raw).length - 1).toBe(2);
    clone.remove();
    editor.UndoManager.clear();
    block.remove();
    expect(wrapper.getInnerHTML()).toBe('<p>neighbour</p>');
    editor.UndoManager.undo();
    expect(wrapper.getInnerHTML()).toBe(`<p>neighbour</p>${raw}`);
    editor.UndoManager.redo();
    expect(wrapper.getInnerHTML()).toBe('<p>neighbour</p>');
  });
  it('metadata loss errors through every export path, including text splices', () => {
    const html = `<p>x</p>${raw}`;
    const { editor, plan, wrapper } = mount(html);
    const block = wrapper.findType('protected-element')[0]!;
    block.unset('originalHtml');
    expect(() => block.toHTML()).toThrow(EditorSourceError);
    expect(() => wrapper.getInnerHTML()).toThrow(EditorSourceError);
    expect(() => serializeEditorSource({ editor, html, sourcePlan: plan, edits: new Map() }, {})).toThrow(EditorSourceError);
  });
  it('styles/scripts are nonvisual atoms, exported once in authored order, without CssComposer copies', () => {
    const html = `<style>p { color : red; }</style><p>x</p><script>window.__scriptblocks = 1;</script>${raw}`;
    const { editor, plan, wrapper } = mount(html);
    const atoms = wrapper.findType('protected-element');
    expect(atoms.map(c => c.get('sourceTagName'))).toEqual(['style', 'script', 'span']);
    expect(atoms.slice(0, 2).map(c => c.get('sourceNonvisual'))).toEqual([true, true]);
    expect(atoms.every(c => c.components().length === 0)).toBe(true);
    expect(wrapper.getInnerHTML()).toBe(html);
    expect(editor.getCss({ avoidProtected: true })).toBe('');
    expect(serializeEditorSource({ editor, html, sourcePlan: plan, edits: new Map() }, { structuralChange: 'move' })).toBe(html);
    expect((window as unknown as Record<string, unknown>).__scriptblocks).toBeUndefined();
  });
  it('text ancestors cannot capture card chrome', () => {
    const { editor, wrapper } = mount(`<p>hello ${raw}</p>`);
    const parent = wrapper.components().at(0);
    // A plain mixed-text parent may be classified as default by the parser; force the real text
    // model to exercise the unsafe ancestor contract independently of that parser heuristic.
    parent.set('type', 'text');
    protectTextAncestors({ editor }, {});
    expect(parent.get('editable')).toBe(false);
  });
  it('Edit HTML addresses the clicked copy after move and duplicate ids', async () => {
    const targets: unknown[] = [];
    const html = '<div id="same" data-kui></div><p>neighbour</p>';
    const { editor, wrapper } = mount(html, (target, options) => { targets.push([target, options]); });
    const block = wrapper.findType('protected-element')[0]!;
    const clone = block.clone();
    wrapper.append(clone);
    editor.select(clone);
    await editor.Commands.run('jini:protected-edit-html');
    expect(targets).toEqual([[{ occurrenceIndex: 1, tagName: 'div', id: 'same' }, {}]]);
    const toolbar = clone.get('toolbar') as { command: string; attributes?: Record<string, string> }[];
    expect(toolbar.map(item => item.command)).toContain('tlb-clone');
    expect(toolbar.find(item => item.command === 'jini:protected-edit-html')?.attributes?.['aria-label']).toBe('Edit HTML');
    block.move(wrapper, { at: wrapper.components().length });
    editor.select(block);
    await editor.Commands.run('jini:protected-edit-html');
    expect(targets[1]).toEqual([{ occurrenceIndex: 1, tagName: 'div', id: 'same' }, {}]);
  });
});

 it('rejects an initial model whose parser lost a retained source atom', () => {
   const { editor, plan, wrapper } = mount('<script>keep()</script><p>x</p>');
   wrapper.findType('protected-element')[0]!.remove();
   expect(() => assertPreparedSourceModel({ editor, sourcePlan: plan }, {})).toThrow(EditorSourceError);
 });

describe('EditorSourceError', () => {
  it('defaults to the visual-edit refusal message', () => {
    const error = new EditorSourceError();
    expect([error.message, error.name, error.code]).toEqual(["Can't edit this source visually. Use HTML.", 'EditorSourceError', 'EDITOR_SOURCE_INTEGRITY']);
  });
  it('accepts a specific message', () => {
    expect(new EditorSourceError({ message: 'shell lost' }).message).toBe('shell lost');
  });
});

describe('isEditorSourceError', () => {
  it('recognizes an EditorSourceError', () => {
    expect(isEditorSourceError({ error: new EditorSourceError() })).toBe(true);
  });
  it('recognizes any object carrying the integrity code', () => {
    expect(isEditorSourceError({ error: { code: 'EDITOR_SOURCE_INTEGRITY' } }, {})).toBe(true);
  });
  it.each([null, 'EDITOR_SOURCE_INTEGRITY', new Error('x'), { code: 'OTHER' }])('rejects %o', error => {
    expect(isEditorSourceError({ error })).toBe(false);
  });
});

describe('editor without a wrapper', () => {
  const wrapperless = () => {
    const { editor } = mount('<p>x</p>');
    vi.spyOn(editor, 'getWrapper').mockReturnValue(undefined);
    return editor;
  };
  it('refuses the prepared-model check', () => {
    const { plan } = mount('<p>x</p>');
    expect(() => assertPreparedSourceModel({ editor: wrapperless(), sourcePlan: plan })).toThrow(new EditorSourceError());
  });
  it('skips the metadata check', () => {
    expect(() => assertProtectedSourceMetadata({ editor: wrapperless() })).not.toThrow();
  });
  it('skips protecting text ancestors', () => {
    expect(() => protectTextAncestors({ editor: wrapperless() })).not.toThrow();
  });
  it('describes nothing', () => {
    expect(protectedCanvasDescriber({ editor: wrapperless() })(document.createElement('canvas'))).toBeUndefined();
  });
});

it('rejects an initial model whose retained source differs from the plan', () => {
  const { editor, plan, wrapper } = mount('<canvas></canvas>');
  wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!.set('originalHtml', '<canvas id="x"></canvas>');
  expect(() => assertPreparedSourceModel({ editor, sourcePlan: plan })).toThrow(new EditorSourceError());
});

it('leaves non-text ancestors of a protected element editable', () => {
  const { editor, wrapper } = mount('<section><canvas></canvas></section>');
  const section = wrapper.components().at(0);
  section.set('editable', true);
  protectTextAncestors({ editor });
  expect([section.is('text'), section.get('editable')]).toEqual([false, true]);
});

describe('protectedCanvasDescriber', () => {
  it('maps a rendered visual block element to its descriptor, never a nonvisual atom or an unrendered block', () => {
    const { editor, wrapper } = mount('<canvas id="c"></canvas><script>x()</script><canvas></canvas>');
    const [canvas, script, unrendered] = wrapper.findType(PROTECTED_ELEMENT_TYPE) as [Component, Component, Component];
    const canvasEl = document.createElement('canvas');
    const scriptEl = document.createElement('span');
    vi.spyOn(canvas, 'getEl').mockReturnValue(canvasEl);
    vi.spyOn(script, 'getEl').mockReturnValue(scriptEl);
    vi.spyOn(unrendered, 'getEl').mockReturnValue(undefined);
    const describe = protectedCanvasDescriber({ editor });
    expect(describe(canvasEl)).toEqual({ kindLabel: 'Canvas', identityLabel: '#c', presentation: 'runtime', guidanceLabel: 'Locked · Edit in HTML · Preview plays it', inline: false });
    expect(describe(scriptEl)).toBeUndefined();
  });
  it('skips a block without a descriptor', () => {
    const { editor, wrapper } = mount('<canvas></canvas>');
    const block = wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!;
    const el = document.createElement('canvas');
    block.unset('placeholderDescriptor');
    vi.spyOn(block, 'getEl').mockReturnValue(el);
    expect(protectedCanvasDescriber({ editor })(el)).toBeUndefined();
  });
});

describe('protected type registration', () => {
  const typeOf = (editor: Editor) => editor.Components.getType(PROTECTED_ELEMENT_TYPE)!;
  it('resolves a token read from a plain attributes object', () => {
    const { editor, plan } = mount('<canvas></canvas>');
    const isComponent: NonNullable<AddComponentTypeOptions['isComponent']> = typeOf(editor).model.isComponent;
    const node = document.createElement('div');
    Object.defineProperty(node, 'getAttribute', { value: undefined });
    Object.defineProperty(node, 'attributes', { value: { [plan.markerAttribute]: '0' } });
    expect(isComponent(node)).toMatchObject({ type: PROTECTED_ELEMENT_TYPE, originalHtml: '<canvas></canvas>', sourceTagName: 'canvas' });
  });
  it('ignores an element without a token', () => {
    const { editor } = mount('<canvas></canvas>');
    const isComponent: NonNullable<AddComponentTypeOptions['isComponent']> = typeOf(editor).model.isComponent;
    expect(isComponent(document.createElement('div'))).toBeUndefined();
  });
  it.each(['9', '00', '0.0'])('refuses token %s that does not name a planned instance exactly', token => {
    const { editor, plan } = mount('<canvas></canvas>');
    const isComponent: NonNullable<AddComponentTypeOptions['isComponent']> = typeOf(editor).model.isComponent;
    const node = document.createElement('div');
    node.setAttribute(plan.markerAttribute, token);
    expect(() => isComponent(node)).toThrow(new EditorSourceError());
  });
  it('renders a visual block as non-editable', () => {
    const { editor, wrapper } = mount('<canvas></canvas>');
    const View: new (options: { model: Component; config: unknown }) => ComponentView = typeOf(editor).view;
    const view = new View({ model: wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!, config: editor.Components.config }).render();
    expect([view.el.getAttribute('contenteditable'), view.el.style.getPropertyValue('display')]).toEqual(['false', '']);
  });
  it('renders a nonvisual atom hidden', () => {
    const { editor, wrapper } = mount('<script>x()</script>');
    const View: new (options: { model: Component; config: unknown }) => ComponentView = typeOf(editor).view;
    const view = new View({ model: wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!, config: editor.Components.config }).render();
    expect([view.el.style.getPropertyValue('display'), view.el.style.getPropertyPriority('display')]).toEqual(['none', 'important']);
  });
  it('makes a nonvisual atom inert and gives it no Edit HTML action', () => {
    const { wrapper } = mount('<script>x()</script>', () => {});
    const atom = wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!;
    expect(['selectable', 'draggable', 'hoverable', 'copyable'].map(flag => atom.get(flag))).toEqual([false, false, false, false]);
    expect((atom.get('toolbar') as { command: string }[]).map(item => item.command)).not.toContain('jini:protected-edit-html');
  });
  it('labels the Edit HTML action with the host label', () => {
    const { wrapper } = mountWith({ html: '<canvas></canvas>' }, { onRequestEditHtml: () => {}, editHtmlLabel: 'Bearbeiten' });
    const toolbar = wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!.get('toolbar') as { command: string; label?: string; attributes?: Record<string, string> }[];
    expect(toolbar.find(item => item.command === 'jini:protected-edit-html')).toEqual({
      label: 'Bearbeiten', command: 'jini:protected-edit-html',
      attributes: { title: 'Bearbeiten', 'aria-label': 'Bearbeiten', style: 'width:auto;white-space:nowrap;padding:5px 8px' },
    });
  });
  it('registers no Edit HTML command without a host handler', () => {
    const { editor } = mount('<canvas></canvas>');
    expect(editor.Commands.has('jini:protected-edit-html')).toBe(false);
  });
});

describe('Edit HTML command', () => {
  const run = async (editor: Editor) => { await editor.Commands.run('jini:protected-edit-html'); };
  it('waits for the host flush before reading the selection', async () => {
    const calls: string[] = [];
    const { editor, wrapper } = mountWith({ html: '<canvas></canvas>' }, {
      beforeRequestEditHtml: async () => { calls.push('flush'); },
      onRequestEditHtml: target => { calls.push(JSON.stringify(target)); },
    });
    editor.select(wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!);
    await run(editor);
    expect(calls).toEqual(['flush', '{"occurrenceIndex":0,"tagName":"canvas"}']);
  });
  it.each([
    ['nothing selected', () => undefined],
    ['an ordinary component', (wrapper: Component) => wrapper.components().at(0)],
    ['a nonvisual atom', (wrapper: Component) => wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]],
  ])('requests nothing for %s', async (_label, pick) => {
    const onRequestEditHtml = vi.fn<RequestEditHtml>();
    const { editor, wrapper } = mount('<p>x</p><script>x()</script>', onRequestEditHtml);
    const selected = pick(wrapper);
    if (selected) editor.select(selected);
    await run(editor);
    expect(onRequestEditHtml).not.toHaveBeenCalled();
  });
  it('requests nothing when the editor has no wrapper', async () => {
    const onRequestEditHtml = vi.fn<RequestEditHtml>();
    const { editor, wrapper } = mount('<canvas></canvas>', onRequestEditHtml);
    editor.select(wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!);
    vi.spyOn(editor, 'getWrapper').mockReturnValue(undefined);
    await run(editor);
    expect(onRequestEditHtml).not.toHaveBeenCalled();
  });
  it.each([
    ['the exported HTML lacks the block source', ''],
    ['the source appears only inside a comment', '<!--<canvas></canvas>-->'],
    ['the first copy is in a comment before the element', '<!--<canvas></canvas>--><canvas></canvas>'],
  ])('reports an integrity error when %s', async (_label, exported) => {
    const errors: EditorSourceError[] = [];
    const onRequestEditHtml = vi.fn<RequestEditHtml>();
    const { editor, wrapper } = mountWith({ html: '<canvas></canvas>' }, { onRequestEditHtml, onSerializationError: error => { errors.push(error); } });
    editor.select(wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!);
    vi.spyOn(wrapper, 'getInnerHTML').mockReturnValue(exported);
    await run(editor);
    expect(errors).toEqual([new EditorSourceError()]);
    expect(onRequestEditHtml).not.toHaveBeenCalled();
  });
  it('reports a host failure as a generic integrity error', async () => {
    const errors: EditorSourceError[] = [];
    const { editor, wrapper } = mountWith({ html: '<canvas></canvas>' }, {
      onRequestEditHtml: () => { throw new Error('navigation failed'); }, onSerializationError: error => { errors.push(error); },
    });
    editor.select(wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!);
    await run(editor);
    expect(errors.map(error => [error.message, error.cause])).toEqual([["Can't edit this source visually. Use HTML.", undefined]]);
  });
  it('reports an asynchronous host failure', async () => {
    const errors: EditorSourceError[] = [];
    const { editor, wrapper } = mountWith({ html: '<canvas></canvas>' }, {
      onRequestEditHtml: async () => { throw new Error('navigation failed'); }, onSerializationError: error => { errors.push(error); },
    });
    editor.select(wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!);
    await run(editor);
    expect(errors).toEqual([new EditorSourceError()]);
  });
  it('passes an integrity error through unchanged', async () => {
    const errors: EditorSourceError[] = [];
    const lost = new EditorSourceError({ message: 'lost' });
    const { editor, wrapper } = mountWith({ html: '<canvas></canvas>' }, {
      beforeRequestEditHtml: async () => { throw lost; }, onRequestEditHtml: () => {}, onSerializationError: error => { errors.push(error); },
    });
    editor.select(wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!);
    await run(editor);
    expect(errors[0]).toBe(lost);
  });
  it('swallows a failure when the host gave no error handler', async () => {
    const { editor, wrapper } = mount('<canvas></canvas>', () => { throw new Error('navigation failed'); });
    editor.select(wrapper.findType(PROTECTED_ELEMENT_TYPE)[0]!);
    await expect(run(editor)).resolves.toBeUndefined();
  });
});
