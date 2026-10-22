export { InteractiveHtmlEditor } from './react/components/InteractiveHtmlEditor.js';
export type { InteractiveHtmlEditorHandle, InteractiveHtmlEditorProps } from './react/components/InteractiveHtmlEditor.js';

export { useInteractiveHtmlEditor } from './react/hooks/useInteractiveHtmlEditor.js';

export type { CanvasContentWrapperNode, CanvasStyling } from './canvas-style.js';
export type { CanvasEmbedPlaceholderDescriptor } from './canvas-embed-placeholders.js';

export { hasAttributeOnAnyNodeShape } from './dom.js';
export { prettifyCss } from './css.js';
export { detectEditorBlocks, prepareEditorSource, findEditorBlockOpening } from './editor-blocks.js';
export type { EditorHtmlTarget, RequestEditHtml, EditorSourcePlan, PreparedEditorSource } from './editor-blocks.js';
export { EditorSourceError, isEditorSourceError, registerProtectedElementType, protectTextAncestors } from './protected-elements.js';
export { serializeEditorSource } from './editor-serialization.js';
export type { DirtyTextEdit } from './editor-serialization.js';
