'use client';

import { useEffect, useRef, type RefObject } from 'react';
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
  type LexicalEditor,
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
    const routing: KeyRouting = { editor, popoverOpenRef, onSubmitRef, onPopoverKeyRef };
    const navKey = (key: 'ArrowDown' | 'ArrowUp' | 'Tab') => (event: KeyboardEvent | null) =>
      routeNavKeyToPopover({ ...routing, event, key });
    return mergeRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event: KeyboardEvent | null) => handleEnter({ ...routing, event }),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(KEY_ARROW_DOWN_COMMAND, navKey('ArrowDown'), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, navKey('ArrowUp'), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_TAB_COMMAND, navKey('Tab'), COMMAND_PRIORITY_HIGH),
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

/** Live (ref-held) inputs every key handler reads at dispatch time. */
interface KeyRouting {
  editor: LexicalEditor;
  popoverOpenRef: RefObject<boolean>;
  onSubmitRef: RefObject<() => void>;
  onPopoverKeyRef: RefObject<(key: PopoverNavigationKey) => boolean>;
}

function handleEnter(at: KeyRouting & { event: KeyboardEvent | null }): boolean {
  const { editor, event: e } = at;
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
    at.onSubmitRef.current();
    return true;
  }
  e?.preventDefault();
  if (at.popoverOpenRef.current) return at.onPopoverKeyRef.current('Enter');
  at.onSubmitRef.current();
  return true;
}

/** Arrow-down/up/Tab go to the popover only while it's open and no IME
 *  composition is in progress; otherwise Lexical handles them. */
function routeNavKeyToPopover(
  at: KeyRouting & { event: KeyboardEvent | null; key: 'ArrowDown' | 'ArrowUp' | 'Tab' },
): boolean {
  if (!at.popoverOpenRef.current || at.editor.isComposing()) return false;
  at.event?.preventDefault();
  return at.onPopoverKeyRef.current(at.key);
}
