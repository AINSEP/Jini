import { act, renderHook } from '@testing-library/react';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { MentionEntity } from '../../types.js';
import { serializeRichText } from '../../serialize.js';
import { makeLexicalWrapper } from '../test-support/lexical-harness.js';
import { useSeededValue } from './useSeededValue.js';

/** Wraps the harness in `<StrictMode>` so React genuinely double-invokes
 *  this effect once for the same render (mount → effect → cleanup →
 *  effect again) — proves that double invocation doesn't double-seed even
 *  without a `lastSeeded`-style guard, since the first invocation's
 *  discrete update already makes the second invocation's `current` equal
 *  `value` (see `useSeededValue.ts`'s doc comment for the full trace). */
function makeStrictLexicalWrapper() {
  const { wrapper: Base, getEditor } = makeLexicalWrapper();
  return {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <Base>{children}</Base>
      </StrictMode>
    ),
    getEditor,
  };
}

const slack: MentionEntity = { id: 'slack', kind: 'connector', label: 'Slack', token: '@Slack' };

describe('useSeededValue', () => {
  it('seeds the editor from an initial value', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    renderHook(() => useSeededValue('hi @Slack', [slack]), { wrapper });
    const editor = getEditor();
    expect(serializeRichText(editor.getEditorState())).toEqual({
      text: 'hi @Slack',
      mentions: [slack],
    });
  });

  it('reseeds when value changes externally (e.g. a template insert)', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const { rerender } = renderHook(({ value }: { value: string }) => useSeededValue(value, [slack]), {
      wrapper,
      initialProps: { value: 'first' },
    });
    const editor = getEditor();
    expect(serializeRichText(editor.getEditorState()).text).toBe('first');
    rerender({ value: 'second @Slack' });
    expect(serializeRichText(editor.getEditorState()).text).toBe('second @Slack');
  });

  it('does not reseed (preserves caret) when value already equals the live serialized text', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const { rerender } = renderHook(({ value }: { value: string }) => useSeededValue(value, []), {
      wrapper,
      initialProps: { value: 'hello' },
    });
    const editor = getEditor();
    // Simulate the user typing further, past what `value` (still 'hello')
    // knows about.
    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createTextNode('hello world'));
          root.append(p);
        },
        { discrete: true },
      );
    });
    // Re-render with the SAME `value` prop ('hello') — React skips
    // re-running an effect whose every dependency (`value`, `editor`) is
    // unchanged, so this never even re-enters the hook body; the user's
    // typing survives for that reason.
    rerender({ value: 'hello' });
    expect(serializeRichText(editor.getEditorState()).text).toBe('hello world');
  });

  it('skips reseeding when a new `value` happens to already equal the live text', () => {
    const { wrapper, getEditor } = makeLexicalWrapper();
    const { rerender } = renderHook(({ value }: { value: string }) => useSeededValue(value, []), {
      wrapper,
      initialProps: { value: 'hello' },
    });
    const editor = getEditor();
    // The user types further, past what `value` ('hello') knows about —
    // out-of-band, so it doesn't change `value` and doesn't re-run this
    // effect.
    act(() => {
      editor.update(
        () => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createTextNode('hello world'));
          root.append(p);
        },
        { discrete: true },
      );
    });
    // A genuinely NEW `value` (so the effect really re-runs) that happens
    // to already match what the user typed — the common real case being a
    // host echoing the just-emitted `onChange` text back in as `value`.
    rerender({ value: 'hello world' });
    editor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe('hello world');
    });
  });

  it("does not double-seed under StrictMode's double effect invocation", () => {
    const { wrapper, getEditor } = makeStrictLexicalWrapper();
    renderHook(() => useSeededValue('hello @Slack', [slack]), { wrapper });
    const editor = getEditor();
    expect(serializeRichText(editor.getEditorState())).toEqual({
      text: 'hello @Slack',
      mentions: [slack],
    });
  });
});
