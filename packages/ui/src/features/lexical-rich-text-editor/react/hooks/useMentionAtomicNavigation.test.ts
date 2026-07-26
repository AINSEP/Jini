import { act, renderHook } from '@testing-library/react';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type ElementNode,
  type LexicalEditor,
  type RangeSelection,
  type TextNode,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { $createMentionNode } from '../../mention-node.js';
import { makeLexicalWrapper } from '../test-support/lexical-harness.js';
import { useMentionAtomicNavigation } from './useMentionAtomicNavigation.js';

function key(k: string, overrides: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k, ...overrides });
}

function buildDoc(editor: LexicalEditor) {
  editor.update(
    () => {
      // LexicalComposer seeds one empty paragraph by default (no
      // `initialEditorState` was supplied) — clear it so this doc's own
      // paragraph is the only (first) root child.
      const root = $getRoot();
      root.clear();
      const p = $createParagraphNode();
      p.append(
        $createTextNode('a '),
        $createMentionNode({ mentionId: 'x', mentionKind: 'connector', token: '@x', label: 'x' }),
        $createTextNode(' b'),
      );
      root.append(p);
    },
    { discrete: true },
  );
}

describe('useMentionAtomicNavigation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ArrowLeft steps over a mention immediately before the caret', async () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    act(() => {
      editor.update(
        () => {
          const after = $getRoot().getFirstChild<ElementNode>()!.getLastChild<TextNode>()!;
          after.select(0, 0);
        },
        { discrete: true },
      );
    });
    let handled: boolean | undefined;
    await act(async () => {
      handled = editor.dispatchCommand(KEY_ARROW_LEFT_COMMAND, key('ArrowLeft'));
      await Promise.resolve();
    });
    expect(handled).toBe(true);
    editor.getEditorState().read(() => {
      const sel = $getSelection() as RangeSelection;
      expect(sel.anchor.offset).toBe(1); // before the mention, within the paragraph
    });
  });

  it('ArrowLeft is a no-op when no mention is adjacent', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    act(() => {
      editor.update(
        () => {
          const first = $getRoot().getFirstChild<ElementNode>()!.getFirstChild<TextNode>()!;
          first.select(0, 0);
        },
        { discrete: true },
      );
    });
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_ARROW_LEFT_COMMAND, key('ArrowLeft'));
    });
    expect(handled).toBe(false);
  });

  it('ArrowRight steps over a mention immediately after the caret', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    act(() => {
      editor.update(
        () => {
          const first = $getRoot().getFirstChild<ElementNode>()!.getFirstChild<TextNode>()!;
          first.select(first.getTextContentSize(), first.getTextContentSize());
        },
        { discrete: true },
      );
    });
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_ARROW_RIGHT_COMMAND, key('ArrowRight'));
    });
    expect(handled).toBe(true);
  });

  it('Backspace removes a mention immediately before the caret', async () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    act(() => {
      editor.update(
        () => {
          const after = $getRoot().getFirstChild<ElementNode>()!.getLastChild<TextNode>()!;
          after.select(0, 0);
        },
        { discrete: true },
      );
    });
    let handled: boolean | undefined;
    await act(async () => {
      handled = editor.dispatchCommand(KEY_BACKSPACE_COMMAND, key('Backspace'));
      await Promise.resolve();
    });
    expect(handled).toBe(true);
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('a  b');
    });
  });

  it('Delete removes a mention immediately after the caret', async () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    act(() => {
      editor.update(
        () => {
          const first = $getRoot().getFirstChild<ElementNode>()!.getFirstChild<TextNode>()!;
          first.select(first.getTextContentSize(), first.getTextContentSize());
        },
        { discrete: true },
      );
    });
    let handled: boolean | undefined;
    await act(async () => {
      handled = editor.dispatchCommand(KEY_DELETE_COMMAND, key('Delete'));
      await Promise.resolve();
    });
    expect(handled).toBe(true);
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('a  b');
    });
  });

  it('Backspace/Delete/ArrowLeft/ArrowRight are ignored with a modifier key held', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    act(() => {
      editor.update(
        () => {
          const after = $getRoot().getFirstChild<ElementNode>()!.getLastChild<TextNode>()!;
          after.select(0, 0);
        },
        { discrete: true },
      );
    });
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_BACKSPACE_COMMAND, key('Backspace', { shiftKey: true }));
    });
    expect(handled).toBe(false);
  });

  it('is ignored during IME composition', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    vi.spyOn(editor, 'isComposing').mockReturnValue(true);
    act(() => {
      editor.update(
        () => {
          const after = $getRoot().getFirstChild<ElementNode>()!.getLastChild<TextNode>()!;
          after.select(0, 0);
        },
        { discrete: true },
      );
    });
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_ARROW_LEFT_COMMAND, key('ArrowLeft'));
    });
    expect(handled).toBe(false);
  });

  it('is a no-op when the selection is not collapsed', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    act(() => {
      editor.update(
        () => {
          const p = $getRoot().getFirstChild<ElementNode>()!;
          p.select(0, 2);
        },
        { discrete: true },
      );
    });
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_BACKSPACE_COMMAND, key('Backspace'));
    });
    expect(handled).toBe(false);
  });

  it('ArrowLeft is a no-op when the selection is not collapsed', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    act(() => {
      editor.update(
        () => {
          const p = $getRoot().getFirstChild<ElementNode>()!;
          p.select(0, 2);
        },
        { discrete: true },
      );
    });
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_ARROW_LEFT_COMMAND, key('ArrowLeft'));
    });
    expect(handled).toBe(false);
  });

  // Each of the four registered commands (ArrowLeft/ArrowRight/Backspace/
  // Delete) repeats the same four guard checks (composing, modifier held,
  // non-collapsed selection, no adjacent mention) as its own separate
  // source-level `if`, so v8 branch coverage needs each guard exercised
  // once PER command, not just once overall — the tests above already
  // cover one command's worth of each; these fill in the rest.
  const otherCommands: Array<{
    name: string;
    command: typeof KEY_ARROW_RIGHT_COMMAND;
    keyName: string;
    selectAdjacent: (editor: LexicalEditor) => void;
    selectNonAdjacent: (editor: LexicalEditor) => void;
  }> = [
    {
      name: 'ArrowRight',
      command: KEY_ARROW_RIGHT_COMMAND,
      keyName: 'ArrowRight',
      selectAdjacent: (editor) =>
        editor.update(
          () => {
            const first = $getRoot().getFirstChild<ElementNode>()!.getFirstChild<TextNode>()!;
            first.select(first.getTextContentSize(), first.getTextContentSize());
          },
          { discrete: true },
        ),
      selectNonAdjacent: (editor) =>
        editor.update(
          () => {
            $getRoot().getFirstChild<ElementNode>()!.getFirstChild<TextNode>()!.select(0, 0);
          },
          { discrete: true },
        ),
    },
    {
      name: 'Delete',
      command: KEY_DELETE_COMMAND,
      keyName: 'Delete',
      selectAdjacent: (editor) =>
        editor.update(
          () => {
            const first = $getRoot().getFirstChild<ElementNode>()!.getFirstChild<TextNode>()!;
            first.select(first.getTextContentSize(), first.getTextContentSize());
          },
          { discrete: true },
        ),
      selectNonAdjacent: (editor) =>
        editor.update(
          () => {
            $getRoot().getFirstChild<ElementNode>()!.getFirstChild<TextNode>()!.select(0, 0);
          },
          { discrete: true },
        ),
    },
  ];

  it.each(otherCommands)('$name is a no-op when no mention is adjacent', ({ command, keyName, selectNonAdjacent }) => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    act(() => selectNonAdjacent(editor));
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(command, key(keyName));
    });
    expect(handled).toBe(false);
  });

  it.each(otherCommands)('$name is ignored during IME composition', ({ command, keyName, selectAdjacent }) => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    vi.spyOn(editor, 'isComposing').mockReturnValue(true);
    act(() => selectAdjacent(editor));
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(command, key(keyName));
    });
    expect(handled).toBe(false);
  });

  it.each(otherCommands)('$name is ignored with a modifier key held', ({ command, keyName, selectAdjacent }) => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    act(() => selectAdjacent(editor));
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(command, key(keyName, { shiftKey: true }));
    });
    expect(handled).toBe(false);
  });

  it.each(otherCommands)('$name is a no-op when the selection is not collapsed', ({ command, keyName }) => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    act(() => {
      editor.update(
        () => {
          $getRoot().getFirstChild<ElementNode>()!.select(0, 2);
        },
        { discrete: true },
      );
    });
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(command, key(keyName));
    });
    expect(handled).toBe(false);
  });

  it('Backspace is a no-op when no mention is adjacent to the caret', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    act(() => {
      editor.update(
        () => {
          $getRoot().getFirstChild<ElementNode>()!.getFirstChild<TextNode>()!.select(0, 0);
        },
        { discrete: true },
      );
    });
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_BACKSPACE_COMMAND, key('Backspace'));
    });
    expect(handled).toBe(false);
  });

  it('Backspace is ignored during IME composition', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useMentionAtomicNavigation(), { wrapper });
    const editor = getEditor();
    buildDoc(editor);
    vi.spyOn(editor, 'isComposing').mockReturnValue(true);
    act(() => {
      editor.update(
        () => {
          const after = $getRoot().getFirstChild<ElementNode>()!.getLastChild<TextNode>()!;
          after.select(0, 0);
        },
        { discrete: true },
      );
    });
    let handled: boolean | undefined;
    act(() => {
      handled = editor.dispatchCommand(KEY_BACKSPACE_COMMAND, key('Backspace'));
    });
    expect(handled).toBe(false);
  });
});
