'use client';

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { foldPresentMentions } from '../../mention-parser.js';
import { serializeRichText } from '../../serialize.js';
import type { MentionEntity } from '../../types.js';

/** Origin: `LexicalComposerInput.tsx`'s `OnChangePlugin`. Skips
 *  selection-only updates (arrow keys, clicks, focus/blur, programmatic
 *  select): they don't change the serialized text, so re-serializing +
 *  re-folding the mention list on every caret move is wasted work. The
 *  controlled-value loop is broken by `useSeededValue`'s `value === current`
 *  guard, NOT by this hook — this hook must still run on every real text
 *  change regardless of what seeded it. */
export function useSyncedOnChange(
  knownMentions: MentionEntity[],
  onChange: (text: string, mentions: MentionEntity[]) => void,
): void {
  const [editor] = useLexicalComposerContext();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const knownRef = useRef(knownMentions);
  knownRef.current = knownMentions;
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      const { text, mentions } = serializeRichText(editorState);
      const folded = foldPresentMentions(text, mentions, knownRef.current);
      onChangeRef.current(text, folded);
    });
  }, [editor]);
}
