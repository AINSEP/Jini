// Test-only helper (not part of this feature's public barrel): mounts a
// minimal `<LexicalComposer>` around a `renderHook`/`render` subject and
// hands the test the real `LexicalEditor` instance, since every hook in
// this feature needs `useLexicalComposerContext()` to be available above it
// in the tree.
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import type { InitialConfigType } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { LexicalEditor } from 'lexical';
import type { ReactNode } from 'react';
import { MentionNode } from '../../mention-node.js';

function EditorCapture({ onEditor }: { onEditor: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  onEditor(editor);
  return null;
}

/** Returns a `renderHook`/`render` `wrapper` plus a getter for the captured
 *  editor instance (populated after the first render). */
export function makeLexicalWrapper(namespace = 'rich-text-input-test'): {
  wrapper: (props: { children: ReactNode }) => ReactNode;
  getEditor: () => LexicalEditor;
} {
  let captured: LexicalEditor | null = null;
  const initialConfig: InitialConfigType = {
    namespace,
    nodes: [MentionNode],
    onError(err) {
      throw err;
    },
  };
  return {
    wrapper: ({ children }: { children: ReactNode }) => (
      <LexicalComposer initialConfig={initialConfig}>
        <EditorCapture onEditor={(editor) => (captured = editor)} />
        {children}
      </LexicalComposer>
    ),
    getEditor: () => {
      if (!captured) throw new Error('editor not captured yet — render the wrapper first');
      return captured;
    },
  };
}
