'use client';

import { forwardRef, useImperativeHandle, useRef, type ForwardedRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import type { InitialConfigType } from '@lexical/react/LexicalComposer';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $getSelection, $isRangeSelection, type RangeSelection } from 'lexical';
import { DEFAULT_TEST_ID, DEFAULT_TRIGGERS, EDITOR_THEME } from '../../constants.js';
import { setRichTextFromPlainText } from '../../deserialize.js';
import { $createMentionNode, MentionNode } from '../../mention-node.js';
import {
  buildAnyTriggerDeletionRegex,
  buildTriggerDeletionRegex,
  deleteActiveTrigger,
} from '../../rules.js';
import { serializeRichText } from '../../serialize.js';
import type {
  MentionEntity,
  MentionInsert,
  PopoverNavigationKey,
  RichTextInputHandle,
  RichTextTriggerConfig,
  RichTextTriggerMatch,
} from '../../types.js';
import { useKeyboardCommands } from '../hooks/useKeyboardCommands.js';
import { useMentionAtomicNavigation } from '../hooks/useMentionAtomicNavigation.js';
import { useMentionColorStamping } from '../hooks/useMentionColorStamping.js';
import { usePasteFiles } from '../hooks/usePasteFiles.js';
import { useSeededValue } from '../hooks/useSeededValue.js';
import { useSyncedOnChange } from '../hooks/useSyncedOnChange.js';
import { useTriggerDetection } from '../hooks/useTriggerDetection.js';

const DEFAULT_MENTION_TRIGGER_ID = 'mention';

export interface RichTextInputProps {
  placeholder: string;
  /** Host-controlled value. Reseeded into the editor only when it changes
   *  for a reason other than the user's own typing — see `useSeededValue`. */
  value: string;
  /** Rendered as pills (via `setText`/seeding) and used to fold plain-text
   *  `@token`s into the reported mention list. */
  knownMentions: MentionEntity[];
  /** Fires on every real text change with the serialized plain text + the
   *  mentions currently referenced by it (atomic nodes + matched plain
   *  `@token`s). */
  onChange(text: string, mentions: MentionEntity[]): void;
  /** The trigger (if any) active at the caret, e.g. to drive a popover. */
  onTriggerChange(match: RichTextTriggerMatch | null): void;
  /** Plain Enter with no popover open and no IME composition in progress. */
  onSubmit(): void;
  /** Pasted files/images — omit to fall back to plain-text paste only. */
  onPasteFiles?: ((files: File[]) => void) | undefined;
  /** Whether a popover is open; gates the arrow/tab/enter/escape routing. */
  popoverOpen: boolean;
  /** Routes a popover key to the host; returns true when the host consumed it. */
  onPopoverKey(key: PopoverNavigationKey): boolean;
  /** Optional combobox a11y: announces the active row of a portaled listbox
   *  without moving DOM focus. */
  comboboxAria?: { activeId: string | null; expanded: boolean } | undefined;
  title?: string | undefined;
  testId?: string | undefined;
  /** `aria-controls` target — must match the host's portaled listbox id. */
  mentionListboxId?: string | undefined;
  namespace?: string | undefined;
  /** Which trigger characters are recognized at the caret. Defaults to an
   *  inline `@mention` + a line-start-anchored `/command`, matching the
   *  origin. Pass `[]` to disable trigger detection entirely. */
  triggers?: readonly RichTextTriggerConfig[] | undefined;
  /** Which `triggers` entry's character `insertMention` deletes before
   *  splicing in the picked mention node. Defaults to `'mention'`. */
  mentionTriggerId?: string | undefined;
  /** Resolves a per-mention color, applied as a CSS custom property on that
   *  mention's DOM element — see `useMentionColorStamping`. Omit for
   *  CSS-only (className-driven) mention styling. */
  resolveMentionColor?: ((mention: MentionEntity) => string | undefined) | undefined;
}

function EditorSurface(props: RichTextInputProps, ref: ForwardedRef<RichTextInputHandle>) {
  const {
    placeholder,
    value,
    knownMentions,
    onChange,
    onTriggerChange,
    onSubmit,
    onPasteFiles,
    popoverOpen,
    onPopoverKey,
    comboboxAria,
    title,
    testId = DEFAULT_TEST_ID,
    mentionListboxId = 'rich-text-mention-listbox',
    triggers = DEFAULT_TRIGGERS,
    mentionTriggerId = DEFAULT_MENTION_TRIGGER_ID,
    resolveMentionColor,
  } = props;

  const [editor] = useLexicalComposerContext();

  // `knownMentions`/`triggers`/`mentionTriggerId` can change between renders;
  // the imperative handle below is created once (stable identity, deps
  // `[editor]`) and always reads the latest values through these refs,
  // mirroring the origin's `knownEntitiesRef` pattern.
  const knownMentionsRef = useRef(knownMentions);
  knownMentionsRef.current = knownMentions;
  const triggersRef = useRef(triggers);
  triggersRef.current = triggers;
  const mentionTriggerIdRef = useRef(mentionTriggerId);
  mentionTriggerIdRef.current = mentionTriggerId;

  useSyncedOnChange(knownMentions, onChange);
  useTriggerDetection(triggers, onTriggerChange);
  useMentionAtomicNavigation();
  useKeyboardCommands(popoverOpen, onSubmit, onPopoverKey);
  usePasteFiles(onPasteFiles);
  useSeededValue(value, knownMentions);
  useMentionColorStamping(resolveMentionColor);

  useImperativeHandle(
    ref,
    (): RichTextInputHandle => ({
      getText() {
        // Belt-and-suspenders: collapse any stray \n\n the single-paragraph
        // model should never produce, so the wire format stays byte-stable.
        return serializeRichText(editor.getEditorState()).text.replace(/\n{2,}/g, '\n');
      },
      setText(text: string) {
        setRichTextFromPlainText(editor, text, knownMentionsRef.current);
      },
      clear() {
        setRichTextFromPlainText(editor, '', knownMentionsRef.current);
      },
      focus() {
        editor.focus();
      },
      insertText(text: string) {
        editor.update(
          () => {
            let sel = $getSelection();
            if (!$isRangeSelection(sel)) {
              $getRoot().selectEnd();
              sel = $getSelection();
            }
            if ($isRangeSelection(sel)) sel.insertText(text);
          },
          { discrete: true },
        );
      },
      insertMention(insert: MentionInsert) {
        editor.update(
          () => {
            let sel = $getSelection();
            if (!$isRangeSelection(sel)) {
              $getRoot().selectEnd();
              sel = $getSelection();
            }
            // `$getRoot().selectEnd()` always establishes a collapsed
            // RangeSelection — even an empty root selects at its own
            // boundary — so `sel` is guaranteed to be one by this point.
            // The cast documents that instead of an unreachable
            // early-return branch no real document state can trigger.
            const rangeSel = sel as RangeSelection;
            const mentionTrigger =
              triggersRef.current.find((t) => t.id === mentionTriggerIdRef.current) ??
              triggersRef.current[0];
            if (mentionTrigger) {
              deleteActiveTrigger(rangeSel, buildTriggerDeletionRegex(mentionTrigger));
            }
            const node = $createMentionNode({
              mentionId: insert.entity.id,
              mentionKind: insert.entity.kind,
              token: insert.token,
              label: insert.entity.label,
              title: insert.entity.title,
            });
            const active = $getSelection();
            if ($isRangeSelection(active)) {
              active.insertNodes([node]);
              const after = $getSelection();
              if ($isRangeSelection(after)) after.insertText(' ');
            }
          },
          { discrete: true },
        );
      },
      replaceActiveTrigger(text: string) {
        editor.update(
          () => {
            let sel = $getSelection();
            if (!$isRangeSelection(sel)) {
              $getRoot().selectEnd();
              sel = $getSelection();
            }
            // See the identical `selectEnd()` guarantee noted in
            // `insertMention` above.
            const rangeSel = sel as RangeSelection;
            // Drop whichever trigger's query is active, then insert the
            // plain text (e.g. a Tab-completed slash command's own text).
            deleteActiveTrigger(rangeSel, buildAnyTriggerDeletionRegex(triggersRef.current));
            const active = $getSelection();
            if ($isRangeSelection(active)) active.insertText(text);
          },
          { discrete: true },
        );
      },
    }),
    [editor],
  );

  return (
    <>
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            data-testid={testId}
            className="rich-text-input-editable"
            aria-placeholder={placeholder}
            title={title ?? placeholder}
            role="combobox"
            aria-expanded={comboboxAria?.expanded ? 'true' : 'false'}
            aria-controls={mentionListboxId}
            {...(comboboxAria?.activeId ? { 'aria-activedescendant': comboboxAria.activeId } : {})}
            placeholder={<div className="rich-text-input-placeholder">{placeholder}</div>}
          />
        }
        placeholder={<div className="rich-text-input-placeholder">{placeholder}</div>}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
    </>
  );
}

const EditorSurfaceWithRef = forwardRef<RichTextInputHandle, RichTextInputProps>(EditorSurface);

/**
 * Origin: `apps/web/src/components/composer/LexicalComposerInput.tsx` (OD's
 * chat composer input). A plain-text Lexical editor (not a full block/marks
 * rich text editor) with atomic `@mention`/`/command` trigger tokens, a
 * single-paragraph model (Enter submits, Shift+Enter soft-breaks), and an
 * imperative handle mirroring a controlled `<textarea>`'s usual operations.
 *
 * The origin's `EditorRefPlugin` (a ref-bridging plugin needed because its
 * `forwardRef` component lived OUTSIDE the `LexicalComposer` context) is
 * dropped: `EditorSurface` above is itself inside that context, so its
 * `useImperativeHandle` reads `editor` directly from
 * `useLexicalComposerContext()`.
 */
export const RichTextInput = forwardRef<RichTextInputHandle, RichTextInputProps>(
  function RichTextInput(props, ref) {
    const initialConfig: InitialConfigType = {
      namespace: props.namespace ?? 'rich-text-input',
      editable: true,
      nodes: [MentionNode],
      theme: EDITOR_THEME,
      onError(err) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[rich-text-input]', err);
        }
      },
      // editorState intentionally omitted → empty on first paint (SSR-safe).
    };

    return (
      <div className="rich-text-input">
        <LexicalComposer initialConfig={initialConfig}>
          <EditorSurfaceWithRef {...props} ref={ref} />
        </LexicalComposer>
      </div>
    );
  },
);
