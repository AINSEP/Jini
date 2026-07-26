'use client';

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection, $isTextNode } from 'lexical';
import { $isMentionNode } from '../../mention-node.js';
import { buildTriggerMatch, detectActiveTrigger, textBeforeCaretOnLine } from '../../rules.js';
import type { RichTextTriggerConfig, RichTextTriggerMatch } from '../../types.js';

/** Origin: `LexicalComposerInput.tsx`'s `TriggerPlugin`. Reports the active
 *  trigger (if any) + its caret anchor rect on every selection-affecting
 *  editor update. */
export function useTriggerDetection(
  triggers: readonly RichTextTriggerConfig[],
  onTriggerChange: (match: RichTextTriggerMatch | null) => void,
): void {
  const [editor] = useLexicalComposerContext();
  const onTriggerChangeRef = useRef(onTriggerChange);
  onTriggerChangeRef.current = onTriggerChange;
  const triggersRef = useRef(triggers);
  triggersRef.current = triggers;

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) {
          onTriggerChangeRef.current(null);
          return;
        }
        const node = sel.anchor.getNode();
        if (!$isTextNode(node) || $isMentionNode(node)) {
          onTriggerChangeRef.current(null);
          return;
        }
        const before = textBeforeCaretOnLine(node, sel.anchor.offset);
        const detected = detectActiveTrigger(before, triggersRef.current);
        // Only pay for the DOM read when a trigger is live; otherwise the
        // rect is unused. Viewport coords (position:fixed portal) — no
        // scroll offset needed.
        onTriggerChangeRef.current(
          buildTriggerMatch(detected, detected ? editor.getRootElement() : null),
        );
      });
    });
  }, [editor]);
}
