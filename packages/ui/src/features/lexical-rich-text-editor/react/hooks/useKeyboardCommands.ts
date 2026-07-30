'use client';

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { mergeRegister } from '@lexical/utils';
import {
  COMMAND_PRIORITY_HIGH,
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
} from 'lexical';
import type { PopoverNavigationKey } from '../../types.js';

/** Origin: `LexicalComposerInput.tsx`'s `KeyboardPlugin`. Routes Enter to
 *  either a soft line break (Shift+Enter), a forced submit (Cmd/Ctrl+Enter,
 *  even with a popover open), a popover-consumed Enter, or a plain submit.
 *  Routes arrow-down/up/Tab/Escape to the popover only while it's open.
 *  Forbids a second paragraph — this editor is a single-paragraph model
 *  (matching the origin, which is a plain-text composer, not a full
 *  block-structured rich text editor), so a hard Enter that survives the
 *  above becomes a line break instead of starting a new paragraph. */
export function useKeyboardCommands(
  popoverOpen: boolean,
  onSubmit: () => void,
  onPopoverKey: (key: PopoverNavigationKey) => boolean,
): void {
  const [editor] = useLexicalComposerContext();
  const popoverOpenRef = useRef(popoverOpen);
  popoverOpenRef.current = popoverOpen;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const onPopoverKeyRef = useRef(onPopoverKey);
  onPopoverKeyRef.current = onPopoverKey;

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e: KeyboardEvent | null) => {
          // IME confirm Enter — let Lexical commit the composition.
          if (editor.isComposing()) return false;
          if (e?.shiftKey) {
            editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
            e.preventDefault();
            return true;
          }
          // Cmd/Ctrl+Enter force-submits even with a popover open.
          if (e?.metaKey || e?.ctrlKey) {
            e.preventDefault();
            onSubmitRef.current();
            return true;
          }
          if (popoverOpenRef.current) {
            e?.preventDefault();
            return onPopoverKeyRef.current('Enter');
          }
          e?.preventDefault();
          onSubmitRef.current();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (e) => {
          if (!popoverOpenRef.current || editor.isComposing()) return false;
          e?.preventDefault();
          return onPopoverKeyRef.current('ArrowDown');
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (e) => {
          if (!popoverOpenRef.current || editor.isComposing()) return false;
          e?.preventDefault();
          return onPopoverKeyRef.current('ArrowUp');
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (e) => {
          if (!popoverOpenRef.current || editor.isComposing()) return false;
          e?.preventDefault();
          return onPopoverKeyRef.current('Tab');
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          if (!popoverOpenRef.current) return false;
          return onPopoverKeyRef.current('Escape');
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        INSERT_PARAGRAPH_COMMAND,
        () => {
          editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor]);
}
