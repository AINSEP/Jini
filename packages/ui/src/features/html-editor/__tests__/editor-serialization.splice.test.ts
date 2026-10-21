import grapesjs, { type Component, type Editor } from 'grapesjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareEditorSource } from '../editor-blocks.js';
import { serializeEditorSource, type DirtyTextEdit } from '../editor-serialization.js';
import { EditorSourceError, registerProtectedElementType } from '../protected-elements.js';
import type { ElementPath } from '../source-splice.js';

const editors: Editor[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(editors.splice(0).map(editor => editor.destroy()));
});

function mount(html: string) {
  const plan = prepareEditorSource({ html }, {});
  if (!plan.ok) throw new Error(plan.problem);
  const editor = grapesjs.init({ headless: true, autorender: false, components: plan.html, storageManager: false,
    parser: { optionsHtml: { allowScripts: false, keepEmptyTextNodes: true } },
    plugins: [e => registerProtectedElementType({ editor: e, sourcePlan: plan }, {})] });
  editors.push(editor);
  return { editor, plan, wrapper: editor.getWrapper()! };
}

const edit = (path: ElementPath, component: Component): DirtyTextEdit => ({ path, tagName: component.tagName, component });

describe('serializeEditorSource splice fallbacks', () => {
  it('splices several edits back into the original bytes, back to front', () => {
    const html = '<p class=a>one</p>\n<p class=b>two</p>';
    const { editor, plan, wrapper } = mount(html);
    const [first, second] = wrapper.components().models.filter(model => model.tagName === 'p');
    first!.components('ONE');
    second!.components('TWO');
    const edits = new Map([['0', edit([0], first!)], ['1', edit([1], second!)]]);
    expect(serializeEditorSource({ editor, html, edits, sourcePlan: plan })).toBe('<p class=a>ONE</p>\n<p class=b>TWO</p>');
  });

  it.each([[[0], [7]], [[7], [0]]])('falls back to the cleaned export, with a warning, when an edit names an element the original never had (order %j, %j)', (pathA, pathB) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = '<p>one</p>';
    const { editor, plan, wrapper } = mount(html);
    const [first] = wrapper.components().models;
    first!.components('ONE');
    const edits = new Map([[String(pathA), edit(pathA, first!)], [String(pathB), edit(pathB, first!)]]);
    expect(serializeEditorSource({ editor, html, edits, sourcePlan: plan })).toBe(wrapper.getInnerHTML());
    expect(warn.mock.calls.flat().join(' ')).toContain('could not be spliced');
  });

  it('falls back to the cleaned export when a text edit spans a protected source region', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = '<section>before <div data-kui="marquee">run</div> after</section>';
    const { editor, plan, wrapper } = mount(html);
    const [section] = wrapper.components().models;
    const output = serializeEditorSource({ editor, html, edits: new Map([['0', edit([0], section!)]]), sourcePlan: plan });
    expect(output).toBe(wrapper.getInnerHTML());
    expect(output).toContain('<div data-kui="marquee">run</div>');
    expect(warn.mock.calls.flat().join(' ')).toContain('overlaps a protected source region');
  });

  it('refuses to export text that would carry the mount-private marker attribute', () => {
    const html = '<p>one</p>';
    const { editor, plan, wrapper } = mount(html);
    const [first] = wrapper.components().models;
    first!.components(`typed ${plan.markerAttribute} by hand`);
    expect(() => serializeEditorSource({ editor, html, edits: new Map([['0', edit([0], first!)]]), sourcePlan: plan }))
      .toThrow(EditorSourceError);
  });
});
