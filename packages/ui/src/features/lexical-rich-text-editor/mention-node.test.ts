import {
  $createParagraphNode,
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  $createMentionNode,
  $isMentionNode,
  MentionNode,
  type SerializedMentionNode,
} from './mention-node.js';

/** The tests below build a single paragraph with one mention as its first
 *  child; this resolves it without a `LexicalNode`-typed intermediate
 *  losing `.getFirstChild()` (only `ElementNode` has children accessors). */
function firstMentionInDoc() {
  const paragraph = $getRoot().getFirstChild();
  return $isElementNode(paragraph) ? paragraph.getFirstChild() : null;
}

function makeEditor(rootEl?: HTMLElement): LexicalEditor {
  const editor = createEditor({
    namespace: 'mention-node-test',
    nodes: [MentionNode],
    onError(e) {
      throw e;
    },
  });
  if (rootEl) editor.setRootElement(rootEl);
  return editor;
}

describe('MentionNode', () => {
  it('is a token node whose text is the literal @token', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = $createMentionNode({
          mentionId: 'slack',
          mentionKind: 'connector',
          token: '@Slack',
          label: 'Slack',
        });
        expect(node.getTextContent()).toBe('@Slack');
        expect(node.isToken()).toBe(true);
        expect($isMentionNode(node)).toBe(true);
      },
      { discrete: true },
    );
  });

  it('$isMentionNode rejects non-mention nodes, null, and undefined', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        expect($isMentionNode($getRoot())).toBe(false);
      },
      { discrete: true },
    );
    expect($isMentionNode(null)).toBe(false);
    expect($isMentionNode(undefined)).toBe(false);
  });

  it('getEntity reflects the constructor payload, omitting an absent title', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = $createMentionNode({
          mentionId: 'slack',
          mentionKind: 'connector',
          token: '@Slack',
          label: 'Slack',
        });
        expect(node.getEntity()).toEqual({
          id: 'slack',
          kind: 'connector',
          label: 'Slack',
          token: '@Slack',
        });
        expect(node.getToken()).toBe('@Slack');
      },
      { discrete: true },
    );
  });

  it('getEntity includes title when present', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = $createMentionNode({
          mentionId: 'slack',
          mentionKind: 'connector',
          token: '@Slack',
          label: 'Slack',
          title: 'Slack workspace',
        });
        expect(node.getEntity()).toEqual({
          id: 'slack',
          kind: 'connector',
          label: 'Slack',
          token: '@Slack',
          title: 'Slack workspace',
        });
      },
      { discrete: true },
    );
  });

  it('exportJSON/importJSON round-trips a mention with a title', () => {
    const editor = makeEditor();
    let json: SerializedMentionNode | undefined;
    editor.update(
      () => {
        const node = $createMentionNode({
          mentionId: 'notion',
          mentionKind: 'connector',
          token: '@Notion',
          label: 'Notion',
          title: 'Notion workspace',
        });
        json = node.exportJSON();
      },
      { discrete: true },
    );
    expect(json).toMatchObject({
      type: 'rich-text-mention',
      version: 1,
      mentionId: 'notion',
      mentionKind: 'connector',
      token: '@Notion',
      label: 'Notion',
      title: 'Notion workspace',
    });
    editor.update(
      () => {
        const restored = MentionNode.importJSON(json!);
        expect(restored.getEntity()).toEqual({
          id: 'notion',
          kind: 'connector',
          label: 'Notion',
          token: '@Notion',
          title: 'Notion workspace',
        });
        expect(restored.isToken()).toBe(true);
      },
      { discrete: true },
    );
  });

  it('exportJSON omits title when absent', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = $createMentionNode({
          mentionId: 'x',
          mentionKind: 'file',
          token: '@readme',
          label: 'readme',
        });
        const json = node.exportJSON();
        expect(json.title).toBeUndefined();
      },
      { discrete: true },
    );
  });

  it('full round-trip through editor state JSON (register + parse)', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        p.append(
          $createMentionNode({
            mentionId: 'slack',
            mentionKind: 'connector',
            token: '@Slack',
            label: 'Slack',
          }),
        );
        root.append(p);
      },
      { discrete: true },
    );
    const stateJSON = editor.getEditorState().toJSON();
    const parsed = editor.parseEditorState(JSON.stringify(stateJSON));
    parsed.read(() => {
      const root = $getRoot();
      const paragraph = root.getFirstChild();
      const mention = $isElementNode(paragraph) ? paragraph.getFirstChild() : null;
      expect($isMentionNode(mention)).toBe(true);
      if ($isMentionNode(mention)) {
        expect(mention.getEntity()).toEqual({
          id: 'slack',
          kind: 'connector',
          label: 'Slack',
          token: '@Slack',
        });
      }
    });
  });

  it('clone preserves the payload and token mode (afterCloneFrom, no constructor recursion)', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = $createMentionNode({
          mentionId: 'slack',
          mentionKind: 'connector',
          token: '@Slack',
          label: 'Slack',
          title: 't',
        });
        const cloned = MentionNode.clone(node);
        expect(cloned.getEntity()).toEqual(node.getEntity());
        expect(cloned.getKey()).toBe(node.getKey());
        expect(cloned.getMode()).toBe('token');
      },
      { discrete: true },
    );
  });

  it('setMode("token") on getWritable does not recurse — inserting/mutating a mounted mention is safe', () => {
    const root = document.createElement('div');
    const editor = makeEditor(root);
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
        $getRoot().append(p);
      },
      { discrete: true },
    );
    // Forces getWritable() on the existing node (clone path), previously a
    // stack-overflow trap if setMode were called from the constructor.
    expect(() => {
      editor.update(
        () => {
          const mention = firstMentionInDoc();
          if ($isMentionNode(mention)) {
            mention.setTextContent('@Slack');
          }
        },
        { discrete: true },
      );
    }).not.toThrow();
  });

  describe('DOM rendering', () => {
    function mountSingleMention(entity: {
      mentionId: string;
      mentionKind: string;
      token: string;
      label: string;
      title?: string;
    }) {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const editor = makeEditor(root);
      editor.update(
        () => {
          const p = $createParagraphNode();
          p.append($createMentionNode(entity));
          $getRoot().append(p);
        },
        { discrete: true },
      );
      const dom = root.querySelector('[data-mention]') as HTMLElement | null;
      return { editor, dom };
    }

    it('createDOM sets className, contenteditable=false, and data attributes', () => {
      const { dom } = mountSingleMention({
        mentionId: 'slack',
        mentionKind: 'connector',
        token: '@Slack',
        label: 'Slack',
      });
      expect(dom).not.toBeNull();
      expect(dom!.className).toBe('rich-text-mention rich-text-mention--connector');
      expect(dom!.getAttribute('contenteditable')).toBe('false');
      expect(dom!.getAttribute('data-mention-id')).toBe('slack');
      expect(dom!.getAttribute('data-mention-kind')).toBe('connector');
      expect(dom!.getAttribute('data-mention-label')).toBe('Slack');
      expect(dom!.hasAttribute('title')).toBe(false);
    });

    it('createDOM sets a title attribute when provided', () => {
      const { dom } = mountSingleMention({
        mentionId: 'slack',
        mentionKind: 'connector',
        token: '@Slack',
        label: 'Slack',
        title: 'Slack workspace',
      });
      expect(dom!.getAttribute('title')).toBe('Slack workspace');
    });

    it('updateDOM reflects a kind change on the mounted element', () => {
      const { editor, dom } = mountSingleMention({
        mentionId: 'slack',
        mentionKind: 'connector',
        token: '@Slack',
        label: 'Slack',
      });
      editor.update(
        () => {
          const mention = firstMentionInDoc();
          if ($isMentionNode(mention)) {
            const writable = mention.getWritable();
            writable.__mentionKind = 'file';
          }
        },
        { discrete: true },
      );
      expect(dom!.className).toBe('rich-text-mention rich-text-mention--file');
      expect(dom!.getAttribute('data-mention-kind')).toBe('file');
    });

    it('updateDOM reflects a label change', () => {
      const { editor, dom } = mountSingleMention({
        mentionId: 'slack',
        mentionKind: 'connector',
        token: '@Slack',
        label: 'Slack',
      });
      editor.update(
        () => {
          const mention = firstMentionInDoc();
          if ($isMentionNode(mention)) {
            mention.getWritable().__label = 'Slack (renamed)';
          }
        },
        { discrete: true },
      );
      expect(dom!.getAttribute('data-mention-label')).toBe('Slack (renamed)');
    });

    it('updateDOM reflects a mentionId change', () => {
      const { editor, dom } = mountSingleMention({
        mentionId: 'slack',
        mentionKind: 'connector',
        token: '@Slack',
        label: 'Slack',
      });
      editor.update(
        () => {
          const mention = firstMentionInDoc();
          if ($isMentionNode(mention)) {
            mention.getWritable().__mentionId = 'slack-2';
          }
        },
        { discrete: true },
      );
      expect(dom!.getAttribute('data-mention-id')).toBe('slack-2');
    });

    it('updateDOM adds, then removes, a title attribute as it changes', () => {
      const { editor, dom } = mountSingleMention({
        mentionId: 'slack',
        mentionKind: 'connector',
        token: '@Slack',
        label: 'Slack',
      });
      editor.update(
        () => {
          const mention = firstMentionInDoc();
          if ($isMentionNode(mention)) {
            mention.getWritable().__title = 'now titled';
          }
        },
        { discrete: true },
      );
      expect(dom!.getAttribute('title')).toBe('now titled');
      editor.update(
        () => {
          const mention = firstMentionInDoc();
          if ($isMentionNode(mention)) {
            mention.getWritable().__title = undefined;
          }
        },
        { discrete: true },
      );
      expect(dom!.hasAttribute('title')).toBe(false);
    });
  });
});
