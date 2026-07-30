import { act, renderHook } from '@testing-library/react';
import { $createParagraphNode, $createTextNode, $getRoot, $setSelection } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import { $createMentionNode } from '../../mention-node.js';
import type { RichTextTriggerConfig } from '../../types.js';
import { makeLexicalWrapper } from '../test-support/lexical-harness.js';
import { useTriggerDetection } from './useTriggerDetection.js';

const TRIGGERS: readonly RichTextTriggerConfig[] = [
  { id: 'mention', character: '@', anchor: 'inline' },
  { id: 'command', character: '/', anchor: 'line-start' },
];

describe('useTriggerDetection', () => {
  it('reports null when the selection is not collapsed', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onTriggerChange = vi.fn();
    renderHook(() => useTriggerDetection(TRIGGERS, onTriggerChange), { wrapper });
    const editor = getEditor();
    act(() => {
      editor.update(
        () => {
          const p = $createParagraphNode();
          const t = $createTextNode('hi @sla');
          p.append(t);
          $getRoot().append(p);
          t.select(0, 3); // non-collapsed
        },
        { discrete: true },
      );
    });
    expect(onTriggerChange).toHaveBeenLastCalledWith(null);
  });

  it('reports null when the anchor is a mention node rather than plain text', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onTriggerChange = vi.fn();
    renderHook(() => useTriggerDetection(TRIGGERS, onTriggerChange), { wrapper });
    const editor = getEditor();
    act(() => {
      editor.update(
        () => {
          const p = $createParagraphNode();
          const m = $createMentionNode({
            mentionId: 'x',
            mentionKind: 'connector',
            token: '@x',
            label: 'x',
          });
          p.append(m);
          $getRoot().append(p);
          m.select(1, 1);
        },
        { discrete: true },
      );
    });
    expect(onTriggerChange).toHaveBeenLastCalledWith(null);
  });

  it('reports an active inline mention trigger with its query', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onTriggerChange = vi.fn();
    renderHook(() => useTriggerDetection(TRIGGERS, onTriggerChange), { wrapper });
    const editor = getEditor();
    act(() => {
      editor.update(
        () => {
          const p = $createParagraphNode();
          const t = $createTextNode('hi @sla');
          p.append(t);
          $getRoot().append(p);
          t.select(7, 7);
        },
        { discrete: true },
      );
    });
    expect(onTriggerChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'mention', query: 'sla' }),
    );
  });

  it('reports an active line-start command trigger', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onTriggerChange = vi.fn();
    renderHook(() => useTriggerDetection(TRIGGERS, onTriggerChange), { wrapper });
    const editor = getEditor();
    act(() => {
      editor.update(
        () => {
          const p = $createParagraphNode();
          const t = $createTextNode('/hel');
          p.append(t);
          $getRoot().append(p);
          t.select(4, 4);
        },
        { discrete: true },
      );
    });
    expect(onTriggerChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'command', query: 'hel' }),
    );
  });

  it('reports null when nothing matches', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onTriggerChange = vi.fn();
    renderHook(() => useTriggerDetection(TRIGGERS, onTriggerChange), { wrapper });
    const editor = getEditor();
    act(() => {
      editor.update(
        () => {
          const p = $createParagraphNode();
          const t = $createTextNode('just words');
          p.append(t);
          $getRoot().append(p);
          t.select(10, 10);
        },
        { discrete: true },
      );
    });
    expect(onTriggerChange).toHaveBeenLastCalledWith(null);
  });

  it('reports null when the selection is not a range selection at all', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const onTriggerChange = vi.fn();
    renderHook(() => useTriggerDetection(TRIGGERS, onTriggerChange), { wrapper });
    const editor = getEditor();
    act(() => {
      editor.update(
        () => {
          const p = $createParagraphNode();
          p.append($createTextNode('hi'));
          $getRoot().append(p);
          $setSelection(null);
        },
        { discrete: true },
      );
    });
    expect(onTriggerChange).toHaveBeenLastCalledWith(null);
  });

  it('reads the latest triggers/callback via refs across re-renders', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onChange }: { onChange: (m: unknown) => void }) => useTriggerDetection(TRIGGERS, onChange),
      { wrapper, initialProps: { onChange: first } },
    );
    rerender({ onChange: second });
    const editor = getEditor();
    act(() => {
      editor.update(
        () => {
          const p = $createParagraphNode();
          const t = $createTextNode('@x');
          p.append(t);
          $getRoot().append(p);
          t.select(2, 2);
        },
        { discrete: true },
      );
    });
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'mention' }));
  });
});
