import grapesjs, { type Editor } from 'grapesjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareEditorSource, type RequestEditHtml } from '../editor-blocks.js';
import { assertPreparedSourceModel, EditorSourceError, protectTextAncestors, registerProtectedElementType } from '../protected-elements.js';
import { serializeEditorSource } from '../editor-serialization.js';

// Headless model/parser tests exercise real GrapesJS serialization without waiting on iframe load.
// Selection, drag/drop, RTE chrome and canvas stylesheet sizing still require the browser check.
const editors: Editor[] = [];
function mount(html: string, onRequestEditHtml?: RequestEditHtml) {
  const plan = prepareEditorSource({ html }, {});
  if (!plan.ok) throw new Error(plan.problem);
  const editor = grapesjs.init({ headless: true, autorender: false, components: plan.html, avoidInlineStyle: false, forceClass: false,
    parser: { optionsHtml: { allowScripts: false, keepEmptyTextNodes: true } },
    storageManager: false, plugins: [editor => registerProtectedElementType({ editor, sourcePlan: plan }, { onRequestEditHtml })] });
  editors.push(editor);
  assertPreparedSourceModel({ editor, sourcePlan: plan }, {});
  return { editor, plan, wrapper: editor.getWrapper()! };
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

it('runs preparation before ignoring ordinary selection and nonvisual atoms', async () => {
  const { editor, plan, wrapper } = mount('<p>x</p><script>keep()</script>');
  const calls: string[] = [];
  registerProtectedElementType({ editor, sourcePlan: plan }, {
    beforeRequestEditHtml: async () => { calls.push('prepare'); },
    onRequestEditHtml: () => { calls.push('navigate'); },
  });
  editor.select(wrapper.components().at(0));
  await editor.Commands.run('jini:protected-edit-html');
  editor.select(wrapper.findType('protected-element')[0]!);
  await editor.Commands.run('jini:protected-edit-html');
  editor.select();
  await editor.Commands.run('jini:protected-edit-html');
  expect(calls).toEqual(['prepare', 'prepare', 'prepare']);
});
it('normalizes preparation and navigation failures while preserving integrity errors', async () => {
  const { editor, plan, wrapper } = mount('<canvas></canvas>');
  const errors: EditorSourceError[] = [];
  const integrity = new EditorSourceError();
  editor.select(wrapper.findType('protected-element')[0]!);
  registerProtectedElementType({ editor, sourcePlan: plan }, {
    beforeRequestEditHtml: async () => { throw integrity; }, onRequestEditHtml: () => { throw new Error('unused'); },
    onSerializationError: error => { errors.push(error); },
  });
  await editor.Commands.run('jini:protected-edit-html');
  expect(errors).toEqual([integrity]);
  registerProtectedElementType({ editor, sourcePlan: plan }, {
    onRequestEditHtml: () => { throw new Error('host'); }, onSerializationError: error => { errors.push(error); },
  });
  await editor.Commands.run('jini:protected-edit-html');
  expect(errors).toHaveLength(2);
  expect(errors[1]).toBeInstanceOf(EditorSourceError);
  expect(errors[1]!.message).toBe("Can't edit this source visually. Use HTML.");
});
it('rejects source targets whose tag or id metadata no longer matches the authored opening', async () => {
  const { editor, plan, wrapper } = mount('<canvas></canvas>');
  const block = wrapper.findType('protected-element')[0]!;
  const errors: EditorSourceError[] = [];
  const targets: unknown[] = [];
  registerProtectedElementType({ editor, sourcePlan: plan }, {
    onRequestEditHtml: target => { targets.push(target); }, onSerializationError: error => { errors.push(error); },
  });
  editor.select(block);
  block.set('sourceTagName', 'video');
  await editor.Commands.run('jini:protected-edit-html');
  expect(targets).toEqual([]);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(EditorSourceError);
});

it('fails closed when wrapper serialization omits the selected original or places its opening later', async () => {
  const { editor, plan, wrapper } = mount('<canvas></canvas>');
  const selected = wrapper.findType('protected-element')[0]!;
  const errors: EditorSourceError[] = [];
  const targets: unknown[] = [];
  registerProtectedElementType({ editor, sourcePlan: plan }, {
    onRequestEditHtml: target => { targets.push(target); }, onSerializationError: error => { errors.push(error); },
  });
  editor.select(selected);
  const serialize = vi.spyOn(wrapper, 'getInnerHTML');
  try {
    serialize.mockReturnValue('');
    await editor.Commands.run('jini:protected-edit-html');
    // The bytes appear in a comment first; the actual opening is later than that untrusted match.
    serialize.mockReturnValue('<!--<canvas></canvas>--><canvas></canvas>');
    await editor.Commands.run('jini:protected-edit-html');
    expect(targets).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors.map(error => error.code)).toEqual(['EDITOR_SOURCE_INTEGRITY', 'EDITOR_SOURCE_INTEGRITY']);
  } finally {
    serialize.mockRestore();
  }
});
