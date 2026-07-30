import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  ElementNode,
  type LexicalEditor,
  type SerializedElementNode,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { $createMentionNode, MentionNode } from './mention-node.js';
import { serializeRichText } from './serialize.js';

/** A minimal non-paragraph, non-mention ElementNode used only to exercise
 *  `serializeRichText`'s two defensive fallback branches: a stray
 *  non-paragraph block at the root, and a generic ElementNode child inside
 *  a paragraph (neither should occur from this feature's own editor
 *  wiring, since `RichTextInput` forces a single-paragraph model — see
 *  `react/hooks/useKeyboardCommands.ts` — but `serializeRichText` is also
 *  usable standalone against any Lexical editor state). */
class FakeBlockNode extends ElementNode {
  static getType(): string {
    return 'fake-block';
  }

  static clone(node: FakeBlockNode): FakeBlockNode {
    return new FakeBlockNode(node.__key);
  }

  createDOM(): HTMLElement {
    return document.createElement('div');
  }

  updateDOM(): boolean {
    return false;
  }

  static importJSON(): FakeBlockNode {
    return $createFakeBlockNode();
  }

  exportJSON(): SerializedElementNode {
    return { ...super.exportJSON(), type: 'fake-block', version: 1 };
  }
}

function $createFakeBlockNode(): FakeBlockNode {
  return new FakeBlockNode();
}

function makeEditor(extraNodes: ReadonlyArray<typeof MentionNode | typeof FakeBlockNode> = []): LexicalEditor {
  return createEditor({
    namespace: 'serialize-test',
    nodes: [MentionNode, ...extraNodes],
    onError(e) {
      throw e;
    },
  });
}

describe('serializeRichText', () => {
  it('serializes plain text with no mentions', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const p = $createParagraphNode();
        p.append($createTextNode('hello world'));
        $getRoot().append(p);
      },
      { discrete: true },
    );
    const result = serializeRichText(editor.getEditorState());
    expect(result).toEqual({ text: 'hello world', mentions: [] });
  });

  it('serializes a mention node to its literal token and reports its entity', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const p = $createParagraphNode();
        p.append($createTextNode('hi '));
        p.append(
          $createMentionNode({
            mentionId: 'slack',
            mentionKind: 'connector',
            token: '@Slack',
            label: 'Slack',
          }),
        );
        p.append($createTextNode(' there'));
        $getRoot().append(p);
      },
      { discrete: true },
    );
    const result = serializeRichText(editor.getEditorState());
    expect(result.text).toBe('hi @Slack there');
    expect(result.mentions).toEqual([
      { id: 'slack', kind: 'connector', label: 'Slack', token: '@Slack' },
    ]);
  });

  it('joins line breaks within a paragraph as \\n', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const p = $createParagraphNode();
        p.append($createTextNode('line1'));
        p.append($createLineBreakNode());
        p.append($createTextNode('line2'));
        $getRoot().append(p);
      },
      { discrete: true },
    );
    expect(serializeRichText(editor.getEditorState()).text).toBe('line1\nline2');
  });

  it('joins multiple paragraph blocks with a single \\n (defensive fallback)', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p1 = $createParagraphNode();
        p1.append($createTextNode('first'));
        const p2 = $createParagraphNode();
        p2.append($createTextNode('second'));
        root.append(p1, p2);
      },
      { discrete: true },
    );
    expect(serializeRichText(editor.getEditorState()).text).toBe('first\nsecond');
  });

  it('reports mentions in document order across multiple mentions', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const p = $createParagraphNode();
        p.append(
          $createMentionNode({
            mentionId: 'slack',
            mentionKind: 'connector',
            token: '@Slack',
            label: 'Slack',
          }),
        );
        p.append($createTextNode(' and '));
        p.append(
          $createMentionNode({
            mentionId: 'notion',
            mentionKind: 'connector',
            token: '@Notion',
            label: 'Notion',
          }),
        );
        $getRoot().append(p);
      },
      { discrete: true },
    );
    const result = serializeRichText(editor.getEditorState());
    expect(result.text).toBe('@Slack and @Notion');
    expect(result.mentions.map((m) => m.id)).toEqual(['slack', 'notion']);
  });

  it('returns empty text for an empty document', () => {
    const editor = makeEditor();
    expect(serializeRichText(editor.getEditorState())).toEqual({ text: '', mentions: [] });
  });

  it('falls back to a stray non-paragraph root block\'s own text content', () => {
    const editor = makeEditor([FakeBlockNode]);
    editor.update(
      () => {
        const stray = $createFakeBlockNode();
        stray.append($createTextNode('stray block text'));
        $getRoot().append(stray);
      },
      { discrete: true },
    );
    expect(serializeRichText(editor.getEditorState())).toEqual({
      text: 'stray block text',
      mentions: [],
    });
  });

  it('reads a generic ElementNode child within a paragraph via its text content', () => {
    const editor = makeEditor([FakeBlockNode]);
    editor.update(
      () => {
        const p = $createParagraphNode();
        p.append($createTextNode('before '));
        const nested = $createFakeBlockNode();
        nested.append($createTextNode('nested'));
        p.append(nested);
        $getRoot().append(p);
      },
      { discrete: true },
    );
    expect(serializeRichText(editor.getEditorState()).text).toBe('before nested');
  });
});
