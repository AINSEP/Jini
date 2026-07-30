'use client';

import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { mergeRegister } from '@lexical/utils';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
} from 'lexical';
import {
  hasPlainNavigationIntent,
  mentionAfterCaret,
  mentionBeforeCaret,
  removeMentionAtCaret,
  selectAfterMention,
  selectBeforeMention,
} from '../../rules.js';

/** Origin: `LexicalComposerInput.tsx`'s `MentionAtomicNavigationPlugin`.
 *  Lexical token-mode nodes are deleted as one unit but still permit
 *  character-by-character caret navigation by default; this normalizes
 *  arrow-left/right to step over a whole mention pill in one keystroke and
 *  backspace/delete to remove a whole pill in one keystroke, instead of
 *  landing "inside" it. */
export function useMentionAtomicNavigation(): void {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_LEFT_COMMAND,
        (event) => {
          if (editor.isComposing() || !hasPlainNavigationIntent(event)) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          const mention = mentionBeforeCaret(selection);
          if (!mention) return false;
          event.preventDefault();
          selectBeforeMention(mention);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        (event) => {
          if (editor.isComposing() || !hasPlainNavigationIntent(event)) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          const mention = mentionAfterCaret(selection);
          if (!mention) return false;
          event.preventDefault();
          selectAfterMention(mention);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => {
          if (editor.isComposing() || !hasPlainNavigationIntent(event)) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          if (!removeMentionAtCaret(selection, true)) return false;
          event.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        (event) => {
          if (editor.isComposing() || !hasPlainNavigationIntent(event)) return false;
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
          if (!removeMentionAtCaret(selection, false)) return false;
          event.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor]);
}
