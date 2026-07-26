'use client';

import { useEffect, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { setRichTextFromPlainText } from '../../deserialize.js';
import { serializeRichText } from '../../serialize.js';
import type { MentionEntity } from '../../types.js';

/** Origin: `LexicalComposerInput.tsx`'s `SeedingPlugin`. Seeds the editor
 *  from a host-controlled `value` string only on genuine external changes
 *  (initial value, a template insert, a programmatic reset). When `value`
 *  already equals the live serialized text, the change came from the user
 *  typing — bail so the caret is preserved instead of clobbering it with a
 *  full rebuild.
 *
 *  The origin additionally tracked a `lastSeeded` ref to skip a "StrictMode
 *  double-invoke" of this effect for the same `value`. Tracing it through
 *  carefully: `setRichTextFromPlainText` commits its update with
 *  `discrete: true`, so by the time StrictMode's mount-only cleanup+re-run
 *  cycle reaches this effect a second time, `editor.getEditorState()`
 *  already reflects the first run's seed — meaning `current === value`
 *  and the check directly above already bails first. Since this effect's
 *  only dependencies are `[value, editor]` (both otherwise stable), no
 *  other path re-invokes it for an unchanged `value` either. That guard
 *  was therefore unreachable here and was removed rather than kept as
 *  untested dead code (this package's coverage-driven-refactor policy). */
export function useSeededValue(value: string, knownMentions: MentionEntity[]): void {
  const [editor] = useLexicalComposerContext();
  const knownRef = useRef(knownMentions);
  knownRef.current = knownMentions;
  useEffect(() => {
    const current = serializeRichText(editor.getEditorState()).text;
    if (value === current) return; // user-typed → no reseed → caret preserved
    setRichTextFromPlainText(editor, value, knownRef.current);
  }, [value, editor]);
}
