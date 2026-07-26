import { act, renderHook } from '@testing-library/react';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type ElementNode,
  type TextNode,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import type { MentionEntity } from '../../types.js';
import { makeLexicalWrapper } from '../test-support/lexical-harness.js';
import { useSyncedOnChange } from './useSyncedOnChange.js';

const slack: MentionEntity = { id: 'slack', kind: 'connector', label: 'Slack', token: '@Slack' };

describe('useSyncedOnChange', () => {
  it('calls onChange with the serialized text and folded mentions on a real text change', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onChange = vi.fn();
    renderHook(() => useSyncedOnChange([slack], onChange), { wrapper });
    const editor = getEditor();
    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createTextNode('hi @Slack'));
          root.append(p);
        },
        { discrete: true },
      );
    });
    expect(onChange).toHaveBeenCalledWith('hi @Slack', [slack]);
  });

  it('does not call onChange for a selection-only update', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onChange = vi.fn();
    renderHook(() => useSyncedOnChange([], onChange), { wrapper });
    const editor = getEditor();
    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          const t = $createTextNode('hello');
          p.append(t);
          root.append(p);
        },
        { discrete: true },
      );
    });
    onChange.mockClear();
    act(() => {
      editor.update(
        () => {
          const t = $getRoot().getFirstChild<ElementNode>()!.getFirstChild<TextNode>()!;
          t.select(0, 0);
        },
        { discrete: true },
      );
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reads the latest knownMentions/onChange via refs across re-renders', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onChange }: { onChange: (text: string, mentions: MentionEntity[]) => void }) =>
        useSyncedOnChange([slack], onChange),
      { wrapper, initialProps: { onChange: first } },
    );
    rerender({ onChange: second });
    const editor = getEditor();
    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createTextNode('@Slack'));
          root.append(p);
        },
        { discrete: true },
      );
    });
    expect(second).toHaveBeenCalledWith('@Slack', [slack]);
    expect(first).not.toHaveBeenCalled();
  });
});
