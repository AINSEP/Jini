/**
 * Origin: `apps/web/src/components/composer/serialize.ts`. Ported verbatim —
 * no OD-specific surface (it only ever touched the generic `MentionNode`).
 */
import {
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isTextNode,
  type EditorState,
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
    const blocks: string[] = [];
    for (const block of $getRoot().getChildren()) {
      if (!$isParagraphNode(block)) {
        // Stray non-paragraph block (shouldn't happen): fall back to its text.
        blocks.push(block.getTextContent());
        continue;
      }
      let line = '';
      for (const child of block.getChildren()) {
        if ($isMentionNode(child)) {
          line += child.getToken();
          mentions.push(child.getEntity());
        } else if ($isLineBreakNode(child)) {
          line += '\n';
        } else if ($isTextNode(child)) {
          line += child.getTextContent();
        } else if ($isElementNode(child)) {
          line += child.getTextContent();
        }
      }
      blocks.push(line);
    }
    return { text: blocks.join('\n'), mentions };
  });
}
