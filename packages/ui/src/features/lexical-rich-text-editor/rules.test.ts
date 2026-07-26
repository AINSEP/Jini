import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  type ElementNode,
  type LexicalEditor,
  type RangeSelection,
  type TextNode,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { $createMentionNode, MentionNode } from './mention-node.js';
import {
  $collectMentionNodeKeys,
  buildAnyTriggerDeletionRegex,
  buildTriggerDeletionRegex,
  buildTriggerMatch,
  computeCaretFloatingLayerPosition,
  deleteActiveTrigger,
  detectActiveTrigger,
  hasPlainNavigationIntent,
  mentionAfterCaret,
  mentionBeforeCaret,
  readCaretRect,
  removeMentionAtCaret,
  selectAfterMention,
  selectBeforeMention,
  textBeforeCaretOnLine,
} from './rules.js';
import type { RichTextTriggerConfig } from './types.js';

function makeEditor(rootEl?: HTMLElement): LexicalEditor {
  const editor = createEditor({
    namespace: 'rules-test',
    nodes: [MentionNode],
    onError(e) {
      throw e;
    },
  });
  if (rootEl) editor.setRootElement(rootEl);
  return editor;
}

const MENTION_TRIGGER: RichTextTriggerConfig = { id: 'mention', character: '@', anchor: 'inline' };
const COMMAND_TRIGGER: RichTextTriggerConfig = { id: 'command', character: '/', anchor: 'line-start' };
const DEFAULT: readonly RichTextTriggerConfig[] = [MENTION_TRIGGER, COMMAND_TRIGGER];

describe('detectActiveTrigger', () => {
  it('detects an inline mention trigger anywhere after whitespace', () => {
    expect(detectActiveTrigger('hi @sla', DEFAULT)).toEqual({ id: 'mention', query: 'sla' });
  });

  it('detects an inline mention trigger at the start of the line', () => {
    expect(detectActiveTrigger('@sla', DEFAULT)).toEqual({ id: 'mention', query: 'sla' });
  });

  it('detects a line-start command trigger only when it is the whole line', () => {
    expect(detectActiveTrigger('/hel', DEFAULT)).toEqual({ id: 'command', query: 'hel' });
  });

  it('does not detect a command trigger mid-line', () => {
    expect(detectActiveTrigger('hi /hel', DEFAULT)).toBeNull();
  });

  it('does not detect a mention trigger mid-word (no left boundary)', () => {
    expect(detectActiveTrigger('foo@bar', DEFAULT)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(detectActiveTrigger('just some words', DEFAULT)).toBeNull();
  });

  it('returns an empty query right after the trigger character', () => {
    expect(detectActiveTrigger('@', DEFAULT)).toEqual({ id: 'mention', query: '' });
  });

  it('respects trigger config order for tie-breaking', () => {
    const reordered = [COMMAND_TRIGGER, MENTION_TRIGGER];
    // "@x" can only match the mention rule regardless of order (different
    // trigger characters can't both match the same suffix).
    expect(detectActiveTrigger('@x', reordered)).toEqual({ id: 'mention', query: 'x' });
  });

  it('escapes a regex-metacharacter trigger character safely', () => {
    const dollarTrigger: RichTextTriggerConfig = { id: 'money', character: '$', anchor: 'inline' };
    expect(detectActiveTrigger('cost $5', [dollarTrigger])).toEqual({ id: 'money', query: '5' });
    expect(detectActiveTrigger('cost $', [dollarTrigger])).toEqual({ id: 'money', query: '' });
  });

  it('returns null when triggers is empty', () => {
    expect(detectActiveTrigger('@anything', [])).toBeNull();
  });
});

describe('buildTriggerDeletionRegex / buildAnyTriggerDeletionRegex', () => {
  it('matches only the given trigger token at the end of a string', () => {
    const re = buildTriggerDeletionRegex(MENTION_TRIGGER);
    expect(re.test('hi @Slack')).toBe(true);
    expect(re.test('hi /Slack')).toBe(false);
  });

  it('matches any configured trigger token at the end of a string', () => {
    const re = buildAnyTriggerDeletionRegex(DEFAULT);
    expect(re.test('hi @Slack')).toBe(true);
    expect(re.test('/command')).toBe(true);
    expect(re.test('no trigger here')).toBe(false);
  });

  it('escapes metacharacter trigger characters in the class regex', () => {
    const dollarTrigger: RichTextTriggerConfig = { id: 'money', character: '$', anchor: 'inline' };
    const re = buildAnyTriggerDeletionRegex([dollarTrigger]);
    expect(re.test('cost $5')).toBe(true);
  });
});

describe('deleteActiveTrigger + textBeforeCaretOnLine (headless editor)', () => {
  function editorWithText(text: string) {
    const editor = makeEditor();
    editor.update(
      () => {
        const p = $createParagraphNode();
        const textNode = $createTextNode(text);
        p.append(textNode);
        $getRoot().append(p);
        textNode.select(text.length, text.length);
      },
      { discrete: true },
    );
    return editor;
  }

  it('strips the trigger token but not the preceding space', () => {
    const editor = editorWithText('hi @Slack');
    editor.update(
      () => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          deleteActiveTrigger(sel, buildTriggerDeletionRegex(MENTION_TRIGGER));
        }
      },
      { discrete: true },
    );
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('hi ');
    });
  });

  it('is a no-op when the regex does not match', () => {
    const editor = editorWithText('hello');
    editor.update(
      () => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          deleteActiveTrigger(sel, buildTriggerDeletionRegex(MENTION_TRIGGER));
        }
      },
      { discrete: true },
    );
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('hello');
    });
  });

  it('is a no-op when the anchor is a mention node, not plain text', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const p = $createParagraphNode();
        const mention = $createMentionNode({
          mentionId: 'slack',
          mentionKind: 'connector',
          token: '@Slack',
          label: 'Slack',
        });
        p.append(mention);
        $getRoot().append(p);
        mention.select(1, 1);
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          expect(() => deleteActiveTrigger(sel, buildTriggerDeletionRegex(MENTION_TRIGGER))).not.toThrow();
        }
      },
      { discrete: true },
    );
  });

  it('textBeforeCaretOnLine walks back across sibling text nodes but stops at a line break', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const p = $createParagraphNode();
        const first = $createTextNode('before');
        const second = $createTextNode(' after');
        p.append(first, second);
        $getRoot().append(p);
        expect(textBeforeCaretOnLine(second, 6)).toBe('before after');
      },
      { discrete: true },
    );
  });
});

describe('atomic mention navigation (headless editor)', () => {
  function buildDoc() {
    const editor = makeEditor();
    let mentionNode: MentionNode | undefined;
    editor.update(
      () => {
        const p = $createParagraphNode();
        const before = $createTextNode('a ');
        mentionNode = $createMentionNode({
          mentionId: 'slack',
          mentionKind: 'connector',
          token: '@Slack',
          label: 'Slack',
        });
        const after = $createTextNode(' b');
        p.append(before, mentionNode, after);
        $getRoot().append(p);
      },
      { discrete: true },
    );
    return { editor, getMention: () => mentionNode! };
  }

  it('mentionBeforeCaret finds the mention when caret sits in the text node right after it', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        const after = mention.getNextSibling<TextNode>();
        expect(after).not.toBeNull();
        after!.select(0, 0);
        const sel = $getSelection() as RangeSelection;
        expect(mentionBeforeCaret(sel)).toBe(mention);
      },
      { discrete: true },
    );
  });

  it('mentionBeforeCaret is null when the caret is not adjacent to a mention', () => {
    const { editor } = buildDoc();
    editor.update(
      () => {
        const root = $getRoot();
        const p = root.getFirstChild<ElementNode>();
        const before = p?.getFirstChild<TextNode>();
        before?.select(0, 0);
        const sel = $getSelection() as RangeSelection;
        expect(mentionBeforeCaret(sel)).toBeNull();
      },
      { discrete: true },
    );
  });

  it('mentionBeforeCaret is null when the caret sits mid-text (not at offset 0) in the following text node', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        const after = mention.getNextSibling<TextNode>();
        after!.select(1, 1); // ' b' → offset 1 is mid-text, not adjacent to the mention
        const sel = $getSelection() as RangeSelection;
        expect(mentionBeforeCaret(sel)).toBeNull();
      },
      { discrete: true },
    );
  });

  it('mentionBeforeCaret is null when caret is at offset 0 inside the mention itself', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        mention.select(0, 0);
        const sel = $getSelection() as RangeSelection;
        expect(mentionBeforeCaret(sel)).toBeNull();
      },
      { discrete: true },
    );
  });

  it('mentionBeforeCaret finds the mention when caret is inside it past offset 0', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        mention.select(1, 1);
        const sel = $getSelection() as RangeSelection;
        expect(mentionBeforeCaret(sel)).toBe(mention);
      },
      { discrete: true },
    );
  });

  it('mentionAfterCaret finds the mention when caret sits at the end of the text node right before it', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        const before = mention.getPreviousSibling<TextNode>();
        before!.select(before!.getTextContentSize(), before!.getTextContentSize());
        const sel = $getSelection() as RangeSelection;
        expect(mentionAfterCaret(sel)).toBe(mention);
      },
      { discrete: true },
    );
  });

  it('mentionAfterCaret is null when caret is not at the end of the preceding text node', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        const before = mention.getPreviousSibling<TextNode>();
        before!.select(0, 0);
        const sel = $getSelection() as RangeSelection;
        expect(mentionAfterCaret(sel)).toBeNull();
      },
      { discrete: true },
    );
  });

  it('mentionAfterCaret is null when the caret is at the end of a text node followed by another (non-mention) text node', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const p = $createParagraphNode();
        const first = $createTextNode('foo');
        const second = $createTextNode('bar');
        p.append(first, second);
        $getRoot().append(p);
        first.select(first.getTextContentSize(), first.getTextContentSize());
        const sel = $getSelection() as RangeSelection;
        expect(mentionAfterCaret(sel)).toBeNull();
      },
      { discrete: true },
    );
  });

  it('mentionAfterCaret finds the mention when caret sits inside it, before its end', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        mention.select(0, 0);
        const sel = $getSelection() as RangeSelection;
        expect(mentionAfterCaret(sel)).toBe(mention);
      },
      { discrete: true },
    );
  });

  it('mentionAfterCaret is null when caret is at the end of the mention itself', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        const size = mention.getTextContentSize();
        mention.select(size, size);
        const sel = $getSelection() as RangeSelection;
        expect(mentionAfterCaret(sel)).toBeNull();
      },
      { discrete: true },
    );
  });

  it('mentionBeforeCaret handles an element-anchored selection (paragraph.select)', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        const p = mention.getParent()!;
        // Anchor at offset 0 within the paragraph → no previous child.
        p.select(0, 0);
        const sel = $getSelection() as RangeSelection;
        expect(mentionBeforeCaret(sel)).toBeNull();
        // Anchor right after the mention's index → previous child is it.
        const idx = mention.getIndexWithinParent() + 1;
        p.select(idx, idx);
        const sel2 = $getSelection() as RangeSelection;
        expect(mentionBeforeCaret(sel2)).toBe(mention);
        // Anchor right after some other (non-mention) child.
        const before = mention.getPreviousSibling()!;
        const beforeIdx = before.getIndexWithinParent() + 1;
        p.select(beforeIdx, beforeIdx);
        const sel3 = $getSelection() as RangeSelection;
        expect(mentionBeforeCaret(sel3)).toBeNull();
      },
      { discrete: true },
    );
  });

  it('mentionAfterCaret handles an element-anchored selection (paragraph.select)', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        const p = mention.getParent()!;
        const idx = mention.getIndexWithinParent();
        p.select(idx, idx);
        const sel = $getSelection() as RangeSelection;
        expect(mentionAfterCaret(sel)).toBe(mention);
        const otherIdx = mention.getPreviousSibling()!.getIndexWithinParent();
        p.select(otherIdx, otherIdx);
        const sel2 = $getSelection() as RangeSelection;
        expect(mentionAfterCaret(sel2)).toBeNull();
      },
      { discrete: true },
    );
  });

  it('selectBeforeMention / selectAfterMention move the caret to the mention boundary', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        selectBeforeMention(mention);
        const sel = $getSelection() as RangeSelection;
        expect(sel.anchor.getNode()).toBe(mention.getParent());
        expect(sel.anchor.offset).toBe(mention.getIndexWithinParent());
      },
      { discrete: true },
    );
    editor.update(
      () => {
        const mention = getMention();
        selectAfterMention(mention);
        const sel = $getSelection() as RangeSelection;
        expect(sel.anchor.offset).toBe(mention.getIndexWithinParent() + 1);
      },
      { discrete: true },
    );
  });

  it('removeMentionAtCaret removes the preceding mention and re-collapses selection', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        const after = mention.getNextSibling<TextNode>();
        after!.select(0, 0);
        const sel = $getSelection() as RangeSelection;
        expect(removeMentionAtCaret(sel, true)).toBe(true);
      },
      { discrete: true },
    );
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('a  b');
    });
  });

  it('removeMentionAtCaret removes the following mention', () => {
    const { editor, getMention } = buildDoc();
    editor.update(
      () => {
        const mention = getMention();
        const before = mention.getPreviousSibling<TextNode>();
        before!.select(before!.getTextContentSize(), before!.getTextContentSize());
        const sel = $getSelection() as RangeSelection;
        expect(removeMentionAtCaret(sel, false)).toBe(true);
      },
      { discrete: true },
    );
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('a  b');
    });
  });

  it('removeMentionAtCaret returns false when there is no adjacent mention', () => {
    const { editor } = buildDoc();
    editor.update(
      () => {
        const p = $getRoot().getFirstChild<ElementNode>();
        p?.getFirstChild<TextNode>()?.select(0, 0);
        const sel = $getSelection() as RangeSelection;
        expect(removeMentionAtCaret(sel, true)).toBe(false);
        expect(removeMentionAtCaret(sel, false)).toBe(false);
      },
      { discrete: true },
    );
  });
});

describe('hasPlainNavigationIntent', () => {
  it('is true with no modifier keys', () => {
    expect(hasPlainNavigationIntent(new KeyboardEvent('keydown'))).toBe(true);
  });

  it.each(['shiftKey', 'altKey', 'ctrlKey', 'metaKey'] as const)(
    'is false when %s is held',
    (mod) => {
      expect(hasPlainNavigationIntent(new KeyboardEvent('keydown', { [mod]: true }))).toBe(false);
    },
  );
});

describe('$collectMentionNodeKeys', () => {
  it('collects mention node keys in document order, ignoring plain text', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const p = $createParagraphNode();
        const m1 = $createMentionNode({
          mentionId: 'a',
          mentionKind: 'x',
          token: '@a',
          label: 'a',
        });
        const m2 = $createMentionNode({
          mentionId: 'b',
          mentionKind: 'x',
          token: '@b',
          label: 'b',
        });
        p.append($createTextNode('t'), m1, $createTextNode('u'), m2);
        $getRoot().append(p);
      },
      { discrete: true },
    );
    editor.getEditorState().read(() => {
      const keys = $collectMentionNodeKeys();
      expect(keys).toHaveLength(2);
    });
  });

  it('returns an empty array for a document with no mentions', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const p = $createParagraphNode();
        p.append($createTextNode('no mentions'));
        $getRoot().append(p);
      },
      { discrete: true },
    );
    editor.getEditorState().read(() => {
      expect($collectMentionNodeKeys()).toEqual([]);
    });
  });
});

describe('buildTriggerMatch', () => {
  it('returns null when nothing was detected', () => {
    expect(buildTriggerMatch(null, null)).toBeNull();
  });

  it('wraps a detected trigger with a caret rect read from the root element', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const rect = { top: 1, bottom: 2, left: 3, right: 4, width: 1, height: 1, x: 3, y: 1 } as DOMRect;
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(window, 'getSelection').mockReturnValue(null);
    const match = buildTriggerMatch({ id: 'mention', query: 'x' }, root);
    expect(match).toEqual({
      id: 'mention',
      query: 'x',
      anchorRect: { top: 1, bottom: 2, left: 3, right: 3 },
    });
  });
});

describe('readCaretRect', () => {
  const originalRangeGetBoundingClientRect = Range.prototype.getBoundingClientRect;
  const originalRangeGetClientRects = Range.prototype.getClientRects;

  afterEach(() => {
    vi.restoreAllMocks();
    // jsdom's Range doesn't implement geometry at all (that's exactly why
    // the source guards every call with `typeof x === 'function'`) — tests
    // that need the probe range to "succeed" install these directly rather
    // than spying on a method that doesn't exist to spy on.
    Range.prototype.getBoundingClientRect = originalRangeGetBoundingClientRect;
    Range.prototype.getClientRects = originalRangeGetClientRects;
  });

  it('returns null when window is undefined-equivalent (no selection, no root)', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(null);
    expect(readCaretRect(null)).toBeNull();
  });

  it('falls back to the root element rect when there is no selection', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(null);
    const root = document.createElement('div');
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 20,
      left: 30,
      right: 40,
    } as DOMRect);
    expect(readCaretRect(root)).toEqual({ top: 10, bottom: 20, left: 30, right: 30 });
  });

  it('falls back to the root element rect when selection has zero ranges', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ rangeCount: 0 } as unknown as Selection);
    const root = document.createElement('div');
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      top: 1,
      bottom: 2,
      left: 3,
      right: 4,
    } as DOMRect);
    expect(readCaretRect(root)).toEqual({ top: 1, bottom: 2, left: 3, right: 3 });
  });

  it('uses range.getBoundingClientRect when it is usable', () => {
    const fakeRange = {
      getBoundingClientRect: () => ({ top: 5, bottom: 15, left: 25, right: 35, height: 10 }),
      startContainer: document.createElement('div'),
      startOffset: 0,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => fakeRange,
    } as unknown as Selection);
    expect(readCaretRect(null)).toEqual({ top: 5, bottom: 15, left: 25, right: 35 });
  });

  it('treats a rect with top===0 but left!==0 as usable', () => {
    const fakeRange = {
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 7, right: 8, height: 1 }),
      startContainer: document.createElement('div'),
      startOffset: 0,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => fakeRange,
    } as unknown as Selection);
    expect(readCaretRect(null)).toEqual({ top: 0, bottom: 0, left: 7, right: 8 });
  });

  it('treats a rect with top===0 and left===0 but bottom!==0 as usable', () => {
    const fakeRange = {
      getBoundingClientRect: () => ({ top: 0, bottom: 9, left: 0, right: 0, height: 1 }),
      startContainer: document.createElement('div'),
      startOffset: 0,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => fakeRange,
    } as unknown as Selection);
    expect(readCaretRect(null)).toEqual({ top: 0, bottom: 9, left: 0, right: 0 });
  });

  it('falls back to getClientRects()[0] when getBoundingClientRect is unusable', () => {
    const fakeRange = {
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, height: 0 }),
      getClientRects: () => [{ top: 6, bottom: 16, left: 26, right: 36, height: 10 }],
      startContainer: document.createElement('div'),
      startOffset: 0,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => fakeRange,
    } as unknown as Selection);
    expect(readCaretRect(null)).toEqual({ top: 6, bottom: 16, left: 26, right: 36 });
  });

  it('falls back to the anchor element rect when both range geometries are unusable and the anchor is an element', () => {
    const el = document.createElement('span');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 7,
      bottom: 17,
      left: 27,
      right: 37,
      height: 10,
    } as DOMRect);
    const fakeRange = {
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, height: 0 }),
      getClientRects: () => [],
      startContainer: el,
      startOffset: 0,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => fakeRange,
    } as unknown as Selection);
    expect(readCaretRect(null)).toEqual({ top: 7, bottom: 17, left: 27, right: 27 });
  });

  it('uses a zero-width probe range at the text-node anchor offset when the range itself is unusable', () => {
    const container = document.createElement('span');
    document.body.appendChild(container);
    const textNode = document.createTextNode('hello world');
    container.appendChild(textNode);

    const fakeRange = {
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, height: 0 }),
      getClientRects: () => [],
      startContainer: textNode,
      startOffset: 3,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => fakeRange,
    } as unknown as Selection);
    Range.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      top: 8,
      bottom: 18,
      left: 28,
      right: 28,
      height: 10,
    } as DOMRect);
    expect(readCaretRect(null)).toEqual({ top: 8, bottom: 18, left: 28, right: 28 });
  });

  it('falls back to getClientRects()[0] on the probe when the probe bounding rect is unusable', () => {
    const container = document.createElement('span');
    document.body.appendChild(container);
    const textNode = document.createTextNode('hello world');
    container.appendChild(textNode);

    const fakeRange = {
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, height: 0 }),
      getClientRects: () => [],
      startContainer: textNode,
      startOffset: 3,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => fakeRange,
    } as unknown as Selection);
    Range.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      height: 0,
    } as DOMRect);
    Range.prototype.getClientRects = vi.fn().mockReturnValue([
      { top: 9, bottom: 19, left: 29, right: 29, height: 10 },
    ] as unknown as DOMRectList);
    expect(readCaretRect(null)).toEqual({ top: 9, bottom: 19, left: 29, right: 29 });
  });

  it('falls through to the parent-element rect when the probe throws', () => {
    const parent = document.createElement('span');
    document.body.appendChild(parent);
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
      top: 11,
      bottom: 21,
      left: 31,
      right: 41,
      height: 10,
    } as DOMRect);
    const textNode = document.createTextNode('hi');
    parent.appendChild(textNode);

    const fakeRange = {
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, height: 0 }),
      getClientRects: () => [],
      startContainer: textNode,
      startOffset: 0,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => fakeRange,
    } as unknown as Selection);
    vi.spyOn(document, 'createRange').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(readCaretRect(null)).toEqual({ top: 11, bottom: 21, left: 31, right: 31 });
  });

  it('falls back to the root element rect when nothing in the selection resolves', () => {
    const detachedText = document.createTextNode('hi');
    const fakeRange = {
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, height: 0 }),
      getClientRects: () => [],
      startContainer: detachedText,
      startOffset: 0,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => fakeRange,
    } as unknown as Selection);
    Range.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      height: 0,
    } as DOMRect);
    Range.prototype.getClientRects = vi.fn().mockReturnValue([] as unknown as DOMRectList);
    const root = document.createElement('div');
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      top: 99,
      bottom: 100,
      left: 101,
      right: 102,
    } as DOMRect);
    expect(readCaretRect(root)).toEqual({ top: 99, bottom: 100, left: 101, right: 101 });
  });

  it('returns null when nothing resolves and there is no root element', () => {
    const detachedText = document.createTextNode('hi');
    const fakeRange = {
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, height: 0 }),
      getClientRects: () => [],
      startContainer: detachedText,
      startOffset: 0,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => fakeRange,
    } as unknown as Selection);
    Range.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      height: 0,
    } as DOMRect);
    Range.prototype.getClientRects = vi.fn().mockReturnValue([] as unknown as DOMRectList);
    expect(readCaretRect(null)).toBeNull();
  });

  it('handles a range whose getBoundingClientRect/getClientRects are not functions', () => {
    const fakeRange = {
      startContainer: document.createElement('div'),
      startOffset: 0,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => fakeRange,
    } as unknown as Selection);
    expect(readCaretRect(null)).toBeNull();
  });
});

describe('computeCaretFloatingLayerPosition', () => {
  const config = { gap: 8, margin: 8, hardMaxHeight: 460, preferredWidth: 420 };

  beforeEach(() => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('places the popover above the caret when there is enough room above', () => {
    const caret = { top: 400, bottom: 420, left: 100, right: 120 };
    const pos = computeCaretFloatingLayerPosition(caret, { width: 300, height: 200 }, null, config);
    expect(pos.placement).toBe('above');
    expect(pos.top).toBe(400 - 8 - 200);
  });

  it('flips below when there is not enough room above but there is below', () => {
    const caret = { top: 20, bottom: 40, left: 100, right: 120 };
    const pos = computeCaretFloatingLayerPosition(caret, { width: 300, height: 300 }, null, config);
    expect(pos.placement).toBe('below');
    expect(pos.top).toBe(40 + 8);
  });

  it('clamps top to margin when "above" is chosen but does not actually fit', () => {
    // A tiny viewport makes both spaceAbove/spaceBelow small/negative;
    // "above" still wins the tie-break (spaceAbove >= spaceBelow), but its
    // computed top would land above the viewport without the margin clamp.
    vi.stubGlobal('innerHeight', 25);
    const caret = { top: 15, bottom: 20, left: 100, right: 120 };
    const pos = computeCaretFloatingLayerPosition(caret, { width: 100, height: 20 }, null, config);
    expect(pos.placement).toBe('above');
    expect(pos.top).toBe(config.margin);
  });

  it('uses hardMaxHeight as the wanted height when no measured size is given', () => {
    const caret = { top: 500, bottom: 520, left: 100, right: 120 };
    const pos = computeCaretFloatingLayerPosition(caret, null, null, config);
    expect(pos.placement).toBe('above');
  });

  it('clamps width to the boundary when one is supplied', () => {
    const caret = { top: 400, bottom: 420, left: 100, right: 120 };
    const boundary = { left: 50, right: 350, width: 300, top: 0, bottom: 800 } as DOMRect;
    const pos = computeCaretFloatingLayerPosition(caret, { width: 420, height: 100 }, boundary, config);
    expect(pos.width).toBeLessThanOrEqual(300 - config.margin * 2);
  });

  it('clamps left within [minLeft, maxLeft] using the boundary', () => {
    const caret = { top: 400, bottom: 420, left: 340, right: 360 };
    const boundary = { left: 50, right: 350, width: 300, top: 0, bottom: 800 } as DOMRect;
    const pos = computeCaretFloatingLayerPosition(caret, { width: 200, height: 100 }, boundary, config);
    expect(pos.left).toBeLessThanOrEqual(350 - config.margin - pos.width);
  });

  it('clamps left to the viewport minLeft when caret.left is negative', () => {
    const caret = { top: 400, bottom: 420, left: -50, right: -30 };
    const pos = computeCaretFloatingLayerPosition(caret, { width: 100, height: 100 }, null, config);
    expect(pos.left).toBe(config.margin);
  });

  it('never shrinks availableWidth below 240', () => {
    const caret = { top: 400, bottom: 420, left: 100, right: 120 };
    const boundary = { left: 490, right: 510, width: 20, top: 0, bottom: 800 } as DOMRect;
    const pos = computeCaretFloatingLayerPosition(caret, { width: 420, height: 100 }, boundary, config);
    expect(pos.width).toBeGreaterThanOrEqual(Math.min(240, config.preferredWidth));
  });
});
