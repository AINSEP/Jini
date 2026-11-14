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
  type LexicalCommand,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import {
  hasPlainNavigationIntent,
  mentionAfterCaret,
  mentionBeforeCaret,
  removeMentionAtCaret,
  selectAfterMention,
  selectBeforeMention,
} from '../../rules.js';

/** Registers one caret key at high priority. `act` runs only for a plain (unmodified, not
 *  composing) key on a collapsed range selection and returns whether it handled a mention;
 *  a handled key's default action is prevented. `act` is this helper's own contract (Lexical
 *  fixes only the outer `registerCommand` listener), so it takes `({ selection }, _optional = {})`. */
function registerMentionCaretKey(
  { editor, command, act }: { editor: LexicalEditor; command: LexicalCommand<KeyboardEvent>; act: (requiredArgs: { selection: RangeSelection }, optionalArgs?: Record<string, never>) => boolean },
  _optional: Record<string, never> = {},
): () => void {
  return editor.registerCommand(command, (event) => {
    if (editor.isComposing() || !hasPlainNavigationIntent(event)) return false;
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
    if (!act({ selection })) return false;
    event.preventDefault();
    return true;
  }, COMMAND_PRIORITY_HIGH);
}

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
      registerMentionCaretKey({ editor, command: KEY_ARROW_LEFT_COMMAND, act: ({ selection }, _optional = {}) => {
        const mention = mentionBeforeCaret(selection);
        if (!mention) return false;
        selectBeforeMention(mention);
        return true;
      } }),
      registerMentionCaretKey({ editor, command: KEY_ARROW_RIGHT_COMMAND, act: ({ selection }, _optional = {}) => {
        const mention = mentionAfterCaret(selection);
        if (!mention) return false;
        selectAfterMention(mention);
        return true;
      } }),
      registerMentionCaretKey({ editor, command: KEY_BACKSPACE_COMMAND, act: ({ selection }, _optional = {}) => removeMentionAtCaret(selection, true) }),
      registerMentionCaretKey({ editor, command: KEY_DELETE_COMMAND, act: ({ selection }, _optional = {}) => removeMentionAtCaret(selection, false) }),
    );
  }, [editor]);
}
