import { act, renderHook } from '@testing-library/react';
import { $createParagraphNode, $getRoot, type ElementNode, type TextNode } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $createMentionNode } from '../../mention-node.js';
import type { MentionEntity } from '../../types.js';
import { makeLexicalWrapper } from '../test-support/lexical-harness.js';
import { MENTION_COLOR_PROPERTY, useMentionColorStamping } from './useMentionColorStamping.js';

function mount() {
  const { wrapper, getEditor } = makeLexicalWrapper();
  const rootEl = document.createElement('div');
  document.body.appendChild(rootEl);
  return { wrapper, getEditor, rootEl };
}

describe('useMentionColorStamping', () => {
  it('does nothing when resolveMentionColor is not supplied', () => {
    const { wrapper, getEditor, rootEl } = mount();
    renderHook(() => useMentionColorStamping(undefined), { wrapper });
    const editor = getEditor();
    editor.setRootElement(rootEl);
    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append(
            $createMentionNode({ mentionId: 'x', mentionKind: 'connector', token: '@x', label: 'x' }),
          );
          root.append(p);
        },
        { discrete: true },
      );
    });
    const dom = rootEl.querySelector('[data-mention]') as HTMLElement;
    expect(dom.style.getPropertyValue(MENTION_COLOR_PROPERTY)).toBe('');
  });

  it('stamps a freshly-created mention node via the mutation listener', () => {
    const { wrapper, getEditor, rootEl } = mount();
    renderHook(() => useMentionColorStamping(() => '#ff0000'), { wrapper });
    const editor = getEditor();
    editor.setRootElement(rootEl);
    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append(
            $createMentionNode({ mentionId: 'x', mentionKind: 'connector', token: '@x', label: 'x' }),
          );
          root.append(p);
        },
        { discrete: true },
      );
    });
    const dom = rootEl.querySelector('[data-mention]') as HTMLElement;
    expect(dom.style.getPropertyValue(MENTION_COLOR_PROPERTY)).toBe('#ff0000');
  });

  it('removes the property when the resolver returns undefined for a given mention', () => {
    const { wrapper, getEditor, rootEl } = mount();
    renderHook(() => useMentionColorStamping(() => undefined), { wrapper });
    const editor = getEditor();
    editor.setRootElement(rootEl);
    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append(
            $createMentionNode({ mentionId: 'x', mentionKind: 'connector', token: '@x', label: 'x' }),
          );
          root.append(p);
        },
        { discrete: true },
      );
    });
    const dom = rootEl.querySelector('[data-mention]') as HTMLElement;
    expect(dom.style.getPropertyValue(MENTION_COLOR_PROPERTY)).toBe('');
  });

  it('restamps already-mounted mentions when resolveMentionColor changes identity', () => {
    const { wrapper, getEditor, rootEl } = mount();
    const { rerender } = renderHook<void, { resolve: ((m: MentionEntity) => string | undefined) | undefined }>(
      ({ resolve }) => useMentionColorStamping(resolve),
      { wrapper, initialProps: { resolve: undefined } },
    );
    const editor = getEditor();
    editor.setRootElement(rootEl);
    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append(
            $createMentionNode({ mentionId: 'x', mentionKind: 'connector', token: '@x', label: 'x' }),
          );
          root.append(p);
        },
        { discrete: true },
      );
    });
    const dom = rootEl.querySelector('[data-mention]') as HTMLElement;
    expect(dom.style.getPropertyValue(MENTION_COLOR_PROPERTY)).toBe('');

    rerender({ resolve: () => '#00ff00' });
    expect(dom.style.getPropertyValue(MENTION_COLOR_PROPERTY)).toBe('#00ff00');
  });

  it('does nothing (via the initial-pass path) when a mention exists but no root element was ever attached', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    // No `editor.setRootElement` call anywhere in this test — the node
    // tree can still gain a mention node, but nothing is ever reconciled
    // to real DOM, so `editor.getElementByKey` can never resolve one.
    const { rerender } = renderHook<void, { resolve: ((m: MentionEntity) => string | undefined) | undefined }>(
      ({ resolve }) => useMentionColorStamping(resolve),
      { wrapper, initialProps: { resolve: undefined } },
    );
    const editor = getEditor();
    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append(
            $createMentionNode({ mentionId: 'x', mentionKind: 'connector', token: '@x', label: 'x' }),
          );
          root.append(p);
        },
        { discrete: true },
      );
    });
    // Supplying a resolver now re-runs the effect's initial restamp pass,
    // which finds the already-existing mention node key via
    // `$collectMentionNodeKeys()` but can't resolve any DOM for it.
    expect(() => {
      act(() => {
        rerender({ resolve: () => '#ff0000' });
      });
    }).not.toThrow();
  });

  it('skips a key reported "destroyed" by the mutation listener', () => {
    const { wrapper, getEditor, rootEl } = mount();
    renderHook(() => useMentionColorStamping(() => '#ff0000'), { wrapper });
    const editor = getEditor();
    editor.setRootElement(rootEl);
    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append(
            $createMentionNode({ mentionId: 'x', mentionKind: 'connector', token: '@x', label: 'x' }),
          );
          root.append(p);
        },
        { discrete: true },
      );
    });
    expect(rootEl.querySelector('[data-mention]')).not.toBeNull();
    // Removed in a SEPARATE update from its creation, so the mutation
    // listener reports this key as genuinely 'destroyed' rather than the
    // create+remove net-zero case (which Lexical doesn't report at all).
    expect(() => {
      act(() => {
        editor.update(
          () => {
            $getRoot().getFirstChild<ElementNode>()!.getFirstChild<TextNode>()!.remove();
          },
          { discrete: true },
        );
      });
    }).not.toThrow();
    expect(rootEl.querySelector('[data-mention]')).toBeNull();
  });

  it('resolves color per-entity (kind/id/label passed through)', () => {
    const { wrapper, getEditor, rootEl } = mount();
    const seen: MentionEntity[] = [];
    renderHook(
      () =>
        useMentionColorStamping((mention) => {
          seen.push(mention);
          return mention.kind === 'connector' ? '#123456' : undefined;
        }),
      { wrapper },
    );
    const editor = getEditor();
    editor.setRootElement(rootEl);
    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append(
            $createMentionNode({ mentionId: 'x', mentionKind: 'connector', token: '@x', label: 'x' }),
            $createMentionNode({ mentionId: 'y', mentionKind: 'file', token: '@y', label: 'y' }),
          );
          root.append(p);
        },
        { discrete: true },
      );
    });
    expect(seen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'x', kind: 'connector' }),
        expect.objectContaining({ id: 'y', kind: 'file' }),
      ]),
    );
    const doms = rootEl.querySelectorAll<HTMLElement>('[data-mention]');
    expect(doms[0]!.style.getPropertyValue(MENTION_COLOR_PROPERTY)).toBe('#123456');
    expect(doms[1]!.style.getPropertyValue(MENTION_COLOR_PROPERTY)).toBe('');
  });
});
