
import {
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
  type EditorState,
  type ParagraphNode,
} from 'lexical';
import { $isMentionNode } from './mention-node.js';
import type { SerializedRichText } from './types.js';

// Walk the tree by hand rather than calling `root.getTextContent()`, which
// joins block-level children with `\n\n`. The editor is constrained to a
// single paragraph (INSERT_PARAGRAPH is rewritten to a line break by
// `react/hooks/useKeyboardCommands.ts`), so the outer block join is
// defensive only — when it does fire it uses a single `\n` so the wire
// format never grows a phantom blank line.
export function serializeRichText(state: EditorState): SerializedRichText {
  return state.read(() => {
    const mentions: SerializedRichText['mentions'] = [];
    const blocks = $getRoot()
      .getChildren()
      .map((block) =>
        $isParagraphNode(block)
          ? serializeParagraph({ paragraph: block, mentions })
          : // Stray non-paragraph block (shouldn't happen): fall back to its text.
            block.getTextContent(),
      );
    return { text: blocks.join('\n'), mentions };
  });
}

/**
 * One paragraph's wire text; appends each atomic mention's entity to
 * `mentions` in document order. A non-mention decorator child contributes
 * nothing.
 */
function serializeParagraph(at: {
  paragraph: ParagraphNode;
  mentions: SerializedRichText['mentions'];
}): string {
  let line = '';
  for (const child of at.paragraph.getChildren()) {
    if ($isMentionNode(child)) {
      line += child.getToken();
      at.mentions.push(child.getEntity());
    } else if ($isLineBreakNode(child)) {
      line += '\n';
    } else if ($isTextNode(child) || $isElementNode(child)) {
      line += child.getTextContent();
    }
  }
  return line;
}
