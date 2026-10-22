import { describe, expect, it } from 'vitest';
import * as HtmlEditor from '../index.js';
import { hasAttributeOnAnyNodeShape } from '../dom.js';
import { prettifyCss } from '../css.js';
import { detectEditorBlocks, findEditorBlockOpening, prepareEditorSource } from '../editor-blocks.js';
import { EditorSourceError, isEditorSourceError, protectTextAncestors, registerProtectedElementType } from '../protected-elements.js';
import { serializeEditorSource } from '../editor-serialization.js';
import { InteractiveHtmlEditor } from '../react/components/InteractiveHtmlEditor.js';
import { useInteractiveHtmlEditor } from '../react/hooks/useInteractiveHtmlEditor.js';

describe('html-editor public entry', () => {
  it('re-exports exactly the implementations the `./html-editor` subpath documents', () => {
    expect(HtmlEditor).toMatchObject({
      InteractiveHtmlEditor, useInteractiveHtmlEditor, hasAttributeOnAnyNodeShape, prettifyCss,
      detectEditorBlocks, prepareEditorSource, findEditorBlockOpening,
      EditorSourceError, isEditorSourceError, registerProtectedElementType, protectTextAncestors, serializeEditorSource,
    });
    expect(Object.keys(HtmlEditor).sort()).toEqual([
      'EditorSourceError', 'InteractiveHtmlEditor', 'detectEditorBlocks', 'findEditorBlockOpening', 'hasAttributeOnAnyNodeShape',
      'isEditorSourceError', 'prepareEditorSource', 'prettifyCss', 'protectTextAncestors', 'registerProtectedElementType',
      'serializeEditorSource', 'useInteractiveHtmlEditor',
    ]);
  });
});
