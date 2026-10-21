// @vitest-environment node
import { expect, it } from 'vitest';
import { detectEditorBlocks } from '../editor-blocks.js';

const tags = (html: string) => {
  const result = detectEditorBlocks({ html }, {});
  if (!result.ok) throw new Error(result.problem);
  return result.blocks.map(block => block.tagName);
};

it('locks a bare data-kui text element whose phrasing child hides non-phrasing content deeper down', () => {
  // Phrasing-only must hold at every depth: an `<em>` wrapper does not make the `<div>` inside it editable text.
  expect(tags('<li data-kui><em>wrapped <div>block</div></em></li>')).toEqual(['li']);
  expect(tags('<p data-kui><em>wrapped <b>inline</b></em></p>')).toEqual([]);
});
