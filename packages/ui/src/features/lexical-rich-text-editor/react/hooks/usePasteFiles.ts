'use client';

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { COMMAND_PRIORITY_LOW, PASTE_COMMAND } from 'lexical';

/** Origin: `LexicalComposerInput.tsx`'s `PastePlugin`. Intercepts a paste
 *  carrying files (images, documents) before Lexical's own paste handling
 *  runs; falls through to plain-text paste when the clipboard has no files. */
export function usePasteFiles(onPasteFiles?: ((files: File[]) => void) | undefined): void {
  const [editor] = useLexicalComposerContext();
  const onPasteFilesRef = useRef(onPasteFiles);
  onPasteFilesRef.current = onPasteFiles;
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0) {
          event.preventDefault();
          onPasteFilesRef.current?.(files);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);
}
